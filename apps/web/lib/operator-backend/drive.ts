import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { safeFilename } from "@operator/storage";
import { artifactDriveLinks, driveObjects, driveSpaces, fileAssets, getDatabase, projectEvents } from "@operator/db";
import { readServerArtifactForSession, type ServerArtifactRecord } from "./artifacts";
import { getServerConversationContext } from "./conversations";
import { getOperatorBackendRuntimeStatus } from "./config";
import { getObjectStorage } from "./object-storage";
import { recordOperatorException } from "../operator-application/observability";

export type ServerDriveSpaceRecord = {
  id: string;
  owner_type: "user" | "organization";
  owner_user_id: string | null;
  owner_org_id: string | null;
  quota_bytes: number;
  used_bytes: number;
  plan: string;
};

export type ServerDriveObjectRecord = {
  id: string;
  drive_space_id: string;
  parent_id: string | null;
  name: string;
  bucket_id: string;
  object_path: string;
  size_bytes: number;
  sha256: string;
  content_type: string;
  visibility: "private" | "organization" | "project";
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
};

export type DriveObjectView = {
  id: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  createdAt: string;
  visibility: ServerDriveObjectRecord["visibility"];
};

export class ServerDriveError extends Error {
  status: number;
  code?: string;

  constructor(message: string, options?: { status?: number; code?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "ServerDriveError";
    this.status = options?.status ?? 500;
    this.code = options?.code;
  }
}

export async function listDriveObjectsForSession(): Promise<{
  quotaBytes: number;
  usedBytes: number;
  objects: DriveObjectView[];
}> {
  const { drive } = await requireDriveContext();
  const rows = await getDatabase()
    .select({ object: driveObjects, file: fileAssets })
    .from(driveObjects)
    .innerJoin(fileAssets, eq(driveObjects.fileAssetId, fileAssets.id))
    .where(and(eq(driveObjects.driveSpaceId, drive.id), isNull(driveObjects.deletedAt)))
    .orderBy(desc(driveObjects.createdAt));

  return {
    quotaBytes: Number(drive.quota_bytes),
    usedBytes: Number(drive.used_bytes),
    objects: rows.map(({ object, file }) => toDriveObjectView(driveObjectFromRows(object, file)))
  };
}

export async function uploadDriveObjectForSession(params: {
  filename: string;
  contentType: string;
  body: Buffer;
}): Promise<DriveObjectView> {
  const { userId, drive } = await requireDriveContext();
  const objectId = randomUUID();
  const filename = safeFilename(params.filename, "drive-object");
  const objectPath = `users/${userId}/drive/${objectId}/${filename}`;
  const sha256 = createHash("sha256").update(params.body).digest("hex");
  await reserveDriveQuota(drive, params.body.byteLength);
  const record = await uploadAndInsertDriveObject({
    driveSpaceId: drive.id,
    objectId,
    bucketId: getOperatorBackendRuntimeStatus().buckets.drive,
    objectPath,
    filename,
    contentType: params.contentType || "application/octet-stream",
    body: params.body,
    sha256,
    sizeBytes: params.body.byteLength,
    createdBy: userId
  });
  return toDriveObjectView(record);
}

export async function deleteDriveObjectForSession(objectId: string): Promise<{ deleted: true }> {
  if (!isUuid(objectId)) throw new ServerDriveError("Invalid drive object id.", { status: 400, code: "INVALID_OBJECT_ID" });
  const { drive } = await requireDriveContext();
  const [row] = await getDatabase()
    .select({ object: driveObjects, file: fileAssets })
    .from(driveObjects)
    .innerJoin(fileAssets, eq(driveObjects.fileAssetId, fileAssets.id))
    .where(and(eq(driveObjects.id, objectId), eq(driveObjects.driveSpaceId, drive.id)))
    .limit(1);
  if (!row || row.object.deletedAt) {
    throw new ServerDriveError("Drive object not found.", { status: 404, code: "DRIVE_OBJECT_NOT_FOUND" });
  }

  await getDatabase().update(driveObjects).set({ deletedAt: new Date() }).where(eq(driveObjects.id, objectId));
  await setDriveUsedBytes(drive.id, Math.max(0, Number(drive.used_bytes) - Number(row.file.sizeBytes)));
  return { deleted: true };
}

export async function saveArtifactToDriveForSession(artifactId: string): Promise<DriveObjectView> {
  const [{ userId, drive }, artifact] = await Promise.all([requireDriveContext(), readServerArtifactForSession(artifactId)]);
  const objectId = randomUUID();
  const filename = safeFilename(artifact.filename, "artifact");
  await reserveDriveQuota(drive, artifact.size_bytes);
  const driveObject = await insertDriveObjectReference({
    driveSpaceId: drive.id,
    objectId,
    artifact,
    filename,
    createdBy: userId
  });
  await linkArtifactToDrive(artifact, driveObject.id);
  await appendProjectEvent({
    projectId: artifact.project_id,
    actorUserId: userId,
    kind: "drive.artifact_saved",
    payload: {
      artifact_id: artifact.id,
      drive_object_id: driveObject.id,
      filename,
      size_bytes: artifact.size_bytes,
      storage_mode: "reference"
    }
  }).catch((error) => {
    recordOperatorException(
      "operator.drive.project_event_append_failed",
      {
        "operator.project_id": artifact.project_id,
        "operator.artifact_id": artifact.id,
        "operator.drive_object_id": driveObject.id
      },
      error
    );
  });
  return toDriveObjectView(driveObject);
}

async function requireDriveContext(): Promise<{ userId: string; drive: ServerDriveSpaceRecord }> {
  const status = getOperatorBackendRuntimeStatus();
  if (!status.enabled || !status.serviceConfigured) {
    throw new ServerDriveError("Operator Drive is not configured.", { status: 503, code: "DRIVE_NOT_CONFIGURED" });
  }
  const context = await getServerConversationContext();
  if (!context) throw new ServerDriveError("Authentication is required.", { status: 401, code: "AUTH_REQUIRED" });
  return {
    userId: context.user.id,
    drive: context.bootstrap.drive as ServerDriveSpaceRecord
  };
}

async function reserveDriveQuota(drive: ServerDriveSpaceRecord, sizeBytes: number) {
  const nextUsed = Number(drive.used_bytes) + sizeBytes;
  if (nextUsed > Number(drive.quota_bytes)) {
    throw new ServerDriveError("Drive quota exceeded.", { status: 413, code: "DRIVE_QUOTA_EXCEEDED" });
  }
  await setDriveUsedBytes(drive.id, nextUsed);
}

async function setDriveUsedBytes(driveSpaceId: string, usedBytes: number) {
  await getDatabase().update(driveSpaces).set({ usedBytes, updatedAt: new Date() }).where(eq(driveSpaces.id, driveSpaceId));
}

async function uploadAndInsertDriveObject(params: {
  driveSpaceId: string;
  objectId: string;
  bucketId: string;
  objectPath: string;
  filename: string;
  contentType: string;
  body: Buffer;
  sha256: string;
  sizeBytes: number;
  createdBy: string;
}): Promise<ServerDriveObjectRecord> {
  const storage = getObjectStorage();
  await storage.putObject({
    bucket: params.bucketId,
    key: params.objectPath,
    body: params.body,
    contentType: params.contentType,
    metadata: {
      sha256: params.sha256,
      createdBy: params.createdBy
    }
  });

  const db = getDatabase();
  const [file] = await db
    .insert(fileAssets)
    .values({
      storageProvider: storage.provider,
      bucket: params.bucketId,
      objectKey: params.objectPath,
      filename: params.filename,
      contentType: params.contentType,
      sha256: params.sha256,
      sizeBytes: params.sizeBytes,
      metadata: { source: "drive" },
      createdBy: params.createdBy
    })
    .returning();
  if (!file) throw new ServerDriveError("Failed to insert drive file metadata.");

  const [object] = await db
    .insert(driveObjects)
    .values({
      id: params.objectId,
      driveSpaceId: params.driveSpaceId,
      fileAssetId: file.id,
      name: params.filename,
      visibility: "private",
      createdBy: params.createdBy
    })
    .returning();
  if (!object) throw new ServerDriveError("Failed to insert drive object metadata.");
  return driveObjectFromRows(object, file);
}

async function insertDriveObjectReference(params: {
  driveSpaceId: string;
  objectId: string;
  artifact: ServerArtifactRecord;
  filename: string;
  createdBy: string;
}): Promise<ServerDriveObjectRecord> {
  const [object] = await getDatabase()
    .insert(driveObjects)
    .values({
      id: params.objectId,
      driveSpaceId: params.driveSpaceId,
      fileAssetId: params.artifact.file_asset_id,
      name: params.filename,
      visibility: "private",
      createdBy: params.createdBy
    })
    .returning();
  if (!object) throw new ServerDriveError("Failed to insert drive object metadata.");
  return driveObjectFromArtifactRecord(object, params.artifact);
}

async function linkArtifactToDrive(artifact: ServerArtifactRecord, driveObjectId: string) {
  await getDatabase().insert(artifactDriveLinks).values({
    artifactId: artifact.id,
    driveObjectId,
    linkType: "reference"
  });
}

async function appendProjectEvent(params: { projectId: string; actorUserId: string; kind: string; payload: Record<string, unknown> }) {
  await getDatabase().insert(projectEvents).values({
    projectId: params.projectId,
    actorUserId: params.actorUserId,
    kind: params.kind,
    payload: params.payload
  });
}

function toDriveObjectView(record: ServerDriveObjectRecord): DriveObjectView {
  return {
    id: record.id,
    name: record.name,
    sizeBytes: Number(record.size_bytes),
    contentType: record.content_type,
    createdAt: record.created_at,
    visibility: record.visibility
  };
}

function driveObjectFromRows(object: typeof driveObjects.$inferSelect, file: typeof fileAssets.$inferSelect): ServerDriveObjectRecord {
  return {
    id: object.id,
    drive_space_id: object.driveSpaceId,
    parent_id: object.parentId ?? null,
    name: object.name,
    bucket_id: file.bucket,
    object_path: file.objectKey,
    size_bytes: file.sizeBytes,
    sha256: file.sha256,
    content_type: file.contentType,
    visibility: object.visibility,
    created_by: object.createdBy ?? null,
    created_at: object.createdAt.toISOString(),
    deleted_at: object.deletedAt?.toISOString() ?? null
  };
}

function driveObjectFromArtifactRecord(object: typeof driveObjects.$inferSelect, artifact: ServerArtifactRecord): ServerDriveObjectRecord {
  return {
    id: object.id,
    drive_space_id: object.driveSpaceId,
    parent_id: object.parentId ?? null,
    name: object.name,
    bucket_id: artifact.bucket_id,
    object_path: artifact.object_path,
    size_bytes: artifact.size_bytes,
    sha256: artifact.sha256,
    content_type: artifact.content_type,
    visibility: object.visibility,
    created_by: object.createdBy ?? null,
    created_at: object.createdAt.toISOString(),
    deleted_at: object.deletedAt?.toISOString() ?? null
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
