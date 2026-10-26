import { createHash, randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { workspacePath, type ArtifactRecord } from "@operator/core";
import { safeFilename } from "@operator/storage";
import { artifacts, fileAssets, getDatabase, organizationMemberships, projectEvents, projects } from "@operator/db";
import type { LegacyOperatorChatAttachment } from "../operator-application/legacy-mastra-chat-result";
import { recordOperatorException } from "../operator-application/observability";
import { createServerConversationSession, getServerConversationContext } from "./conversations";
import { getOperatorBackendRuntimeStatus } from "./config";
import { getObjectStorage } from "./object-storage";

export type ServerArtifactRecord = {
  id: string;
  project_id: string;
  agent_run_id: string | null;
  job_id: string | null;
  type: string;
  file_asset_id: string;
  bucket_id: string;
  object_path: string;
  filename: string;
  content_type: string;
  sha256: string;
  size_bytes: number;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

export type ServerArtifactRegistration = {
  artifactId: string;
  localPath: string;
  href: string;
  downloadHref: string;
  record: ServerArtifactRecord;
};

export type ServerDownloadedArtifact = {
  record: ServerArtifactRecord;
  body: Buffer;
};

export class ServerArtifactError extends Error {
  status: number;
  code?: string;

  constructor(message: string, options?: { status?: number; code?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "ServerArtifactError";
    this.status = options?.status ?? 500;
    this.code = options?.code;
  }
}

export async function uploadServerUserAttachments(params: {
  projectId: string;
  createdBy: string;
  attachments: LegacyOperatorChatAttachment[];
}): Promise<ServerArtifactRegistration[]> {
  if (!getOperatorBackendRuntimeStatus().enabled || !params.attachments.length) return [];

  const registrations: ServerArtifactRegistration[] = [];
  for (const attachment of params.attachments) {
    const body = Buffer.from(attachment.contentBase64, "base64");
    const sha256 = attachment.sha256 ?? createHash("sha256").update(body).digest("hex");
    const artifactId = randomUUID();
    const filename = safeFilename(attachment.filename, "attachment");
    const objectPath = `projects/${params.projectId}/uploads/${artifactId}/${filename}`;
    const record = await uploadAndInsertArtifact({
      artifactId,
      projectId: params.projectId,
      agentRunId: null,
      jobId: "user_upload",
      type: "upload",
      bucketId: getOperatorBackendRuntimeStatus().buckets.artifacts,
      objectPath,
      filename,
      contentType: attachment.mimeType ?? "application/octet-stream",
      body,
      sha256,
      createdBy: params.createdBy,
      metadata: {
        source: "user_attachment",
        workspace_path: attachment.path
      }
    });
    registrations.push(registrationFromRecord(record, attachment.path));
  }
  return registrations;
}

export async function registerServerRunArtifacts(params: {
  projectId: string;
  agentRunId: string;
  workspace: string;
  artifacts: ArtifactRecord[];
  createdBy: string;
}): Promise<ServerArtifactRegistration[]> {
  if (!getOperatorBackendRuntimeStatus().enabled || !params.artifacts.length) return [];

  const registrations: ServerArtifactRegistration[] = [];
  for (const artifact of params.artifacts) {
    const filePath = workspacePath(params.workspace, artifact.path);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) continue;
    const body = await readFile(filePath);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const artifactId = randomUUID();
    const filename = safeFilename(path.basename(artifact.path) || artifact.name, "artifact");
    const objectPath = `projects/${params.projectId}/agent-runs/${params.agentRunId}/artifacts/${artifactId}/${filename}`;
    const record = await uploadAndInsertArtifact({
      artifactId,
      projectId: params.projectId,
      agentRunId: params.agentRunId,
      jobId: artifact.step_id,
      type: artifact.type,
      bucketId: getOperatorBackendRuntimeStatus().buckets.artifacts,
      objectPath,
      filename,
      contentType: artifact.mime_type,
      body,
      sha256,
      createdBy: params.createdBy,
      metadata: {
        ...artifact.metadata,
        source: "agent_run",
        workspace_path: artifact.path,
        manifest_sha256: artifact.sha256,
        manifest_size_bytes: artifact.size_bytes,
        step_id: artifact.step_id,
        name: artifact.name
      }
    });
    registrations.push(registrationFromRecord(record, artifact.path));
  }
  return registrations;
}

export async function createServerGeneratedArtifactForRequest(
  request: Request,
  params: {
    filename: string;
    contentType: string;
    body: Buffer;
    type: string;
    title?: string;
    metadata: Record<string, unknown>;
  }
): Promise<ServerArtifactRegistration & { setCookie?: string | null }> {
  const session = await createServerConversationSession({
    request,
    title: params.title ?? "知识库模板填充"
  });
  if (!session) {
    throw new ServerArtifactError("Operator artifact storage is not configured.", { status: 503, code: "ARTIFACT_STORAGE_NOT_CONFIGURED" });
  }
  const artifactId = randomUUID();
  const filename = safeFilename(params.filename, "knowledge-draft");
  const sha256 = createHash("sha256").update(params.body).digest("hex");
  const objectPath = `projects/${session.project.id}/generated/knowledge-template-fill/${artifactId}/${filename}`;
  const record = await uploadAndInsertArtifact({
    artifactId,
    projectId: session.project.id,
    agentRunId: null,
    jobId: "knowledge_template_fill",
    type: params.type,
    bucketId: getOperatorBackendRuntimeStatus().buckets.artifacts,
    objectPath,
    filename,
    contentType: params.contentType,
    body: params.body,
    sha256,
    createdBy: session.userId,
    metadata: {
      ...params.metadata,
      source: "knowledge_template_fill",
      name: params.title ?? filename
    }
  });
  return {
    ...registrationFromRecord(record, `knowledge-template-fill/${filename}`),
    setCookie: session.setCookie
  };
}

export async function downloadServerArtifactForSession(artifactId: string): Promise<ServerDownloadedArtifact> {
  const row = await readServerArtifactForSession(artifactId);
  const body = await getObjectStorage().getObject(row.bucket_id, row.object_path);
  verifyArtifactBytes(row, body);
  return { record: row, body };
}

export async function readServerArtifactForSession(artifactId: string): Promise<ServerArtifactRecord> {
  if (!isUuid(artifactId)) {
    throw new ServerArtifactError("Invalid artifact id.", { status: 400, code: "INVALID_ARTIFACT_ID" });
  }

  const context = await getServerConversationContext();
  if (!context) {
    throw new ServerArtifactError("Authentication is required.", { status: 401, code: "AUTH_REQUIRED" });
  }

  const row = await readArtifactRecord(artifactId);
  if (!row) throw new ServerArtifactError("Artifact not found.", { status: 404, code: "ARTIFACT_NOT_FOUND" });

  await assertProjectAccess(row.project_id, context.user.id);
  return row;
}

export function rewriteRegisteredArtifactLinks(text: string, registrations: ServerArtifactRegistration[]): string {
  if (!registrations.length) return text;
  return text.replace(/\/api\/operator\/artifact\?[^)\s"']+/gu, (href) => {
    const localPath = localPathFromLegacyHref(href);
    if (!localPath) return href;
    const registration = registrations.find((candidate) => candidate.localPath === localPath);
    if (!registration) return href;
    return isLegacyDownloadHref(href) ? registration.downloadHref : registration.href;
  });
}

export async function readArtifactRecord(artifactId: string): Promise<ServerArtifactRecord | null> {
  const [row] = await getDatabase()
    .select({ artifact: artifacts, file: fileAssets })
    .from(artifacts)
    .innerJoin(fileAssets, eq(artifacts.fileAssetId, fileAssets.id))
    .where(eq(artifacts.id, artifactId))
    .limit(1);
  return row ? artifactFromRows(row.artifact, row.file) : null;
}

function registrationFromRecord(record: ServerArtifactRecord, localPath: string): ServerArtifactRegistration {
  return {
    artifactId: record.id,
    localPath,
    href: `/api/operator/artifacts/${record.id}/download`,
    downloadHref: `/api/operator/artifacts/${record.id}/download?download=1`,
    record
  };
}

function isLegacyDownloadHref(href: string): boolean {
  try {
    return new URL(href, "http://operator.local").searchParams.get("download") === "1";
  } catch {
    return /[?&]download=1(?:&|$)/u.test(href);
  }
}

async function uploadAndInsertArtifact(params: {
  artifactId: string;
  projectId: string;
  agentRunId: string | null;
  jobId: string | null;
  type: string;
  bucketId: string;
  objectPath: string;
  filename: string;
  contentType: string;
  body: Buffer;
  sha256: string;
  createdBy: string;
  metadata: Record<string, unknown>;
}): Promise<ServerArtifactRecord> {
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
      sizeBytes: params.body.byteLength,
      metadata: params.metadata,
      createdBy: params.createdBy
    })
    .returning();
  if (!file) throw new ServerArtifactError("Failed to insert artifact file metadata.");

  const [artifact] = await db
    .insert(artifacts)
    .values({
      id: params.artifactId,
      projectId: params.projectId,
      agentRunId: params.agentRunId,
      fileAssetId: file.id,
      jobId: params.jobId,
      type: params.type,
      name: stringValue(params.metadata.name) ?? params.filename,
      metadata: params.metadata,
      createdBy: params.createdBy
    })
    .returning();
  if (!artifact) throw new ServerArtifactError("Failed to insert artifact metadata.");

  await appendProjectEvent({
    projectId: params.projectId,
    actorUserId: params.createdBy,
    kind: params.agentRunId ? "artifact.registered" : "artifact.uploaded",
    payload: {
      artifact_id: artifact.id,
      agent_run_id: params.agentRunId,
      bucket_id: params.bucketId,
      object_path: params.objectPath,
      filename: params.filename,
      size_bytes: params.body.byteLength,
      sha256: params.sha256
    }
  }).catch((error) => {
    recordOperatorException(
      "operator.artifact.project_event_append_failed",
      {
        "operator.project_id": params.projectId,
        "operator.artifact_id": artifact.id,
        "operator.agent_run_id": params.agentRunId ?? "",
        "operator.event_kind": params.agentRunId ? "artifact.registered" : "artifact.uploaded"
      },
      error
    );
  });
  return artifactFromRows(artifact, file);
}

async function appendProjectEvent(params: { projectId: string; actorUserId: string; kind: string; payload: Record<string, unknown> }) {
  await getDatabase().insert(projectEvents).values({
    projectId: params.projectId,
    actorUserId: params.actorUserId,
    kind: params.kind,
    payload: params.payload
  });
}

async function assertProjectAccess(projectId: string, userId: string): Promise<void> {
  const [project] = await getDatabase().select({ orgId: projects.orgId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    throw new ServerArtifactError("Artifact project not found.", { status: 404, code: "ARTIFACT_PROJECT_NOT_FOUND" });
  }

  const [membership] = await getDatabase()
    .select({ orgId: organizationMemberships.orgId })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.orgId, project.orgId),
        eq(organizationMemberships.status, "active")
      )
    )
    .limit(1);
  if (!membership) {
    throw new ServerArtifactError("Artifact access denied.", { status: 403, code: "ARTIFACT_ACCESS_DENIED" });
  }
}

function verifyArtifactBytes(record: ServerArtifactRecord, body: Buffer) {
  if (body.byteLength !== Number(record.size_bytes)) {
    throw new ServerArtifactError("Artifact size validation failed.", { status: 502, code: "ARTIFACT_SIZE_MISMATCH" });
  }
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (sha256 !== record.sha256) {
    throw new ServerArtifactError("Artifact hash validation failed.", { status: 502, code: "ARTIFACT_HASH_MISMATCH" });
  }
}

function artifactFromRows(artifact: typeof artifacts.$inferSelect, file: typeof fileAssets.$inferSelect): ServerArtifactRecord {
  return {
    id: artifact.id,
    project_id: artifact.projectId,
    agent_run_id: artifact.agentRunId ?? null,
    job_id: artifact.jobId ?? null,
    type: artifact.type,
    file_asset_id: file.id,
    bucket_id: file.bucket,
    object_path: file.objectKey,
    filename: file.filename,
    content_type: file.contentType,
    sha256: file.sha256,
    size_bytes: file.sizeBytes,
    metadata: artifact.metadata,
    created_by: artifact.createdBy ?? null,
    created_at: artifact.createdAt.toISOString()
  };
}

function localPathFromLegacyHref(href: string): string | undefined {
  try {
    const url = new URL(href, "http://operator.local");
    if (url.pathname !== "/api/operator/artifact") return undefined;
    return url.searchParams.get("path") ?? undefined;
  } catch {
    return undefined;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
