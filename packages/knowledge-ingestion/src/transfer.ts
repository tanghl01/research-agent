import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray, or } from "drizzle-orm";
import {
  closeDatabase,
  fileAssets,
  getDatabase,
  knowledgeArchiveMembers,
  knowledgeChunks,
  knowledgeIngestionRuns,
  knowledgeItems,
  knowledgeItemVersions,
  knowledgeSources,
  knowledgeSpaces,
  knowledgeTemplates
} from "@operator/db";
import { loadDotenv, repoRoot } from "@operator/core";
import { LocalFsStorageAdapter, S3CompatibleStorageAdapter, type ObjectStorageAdapter } from "@operator/storage";
import { isHtmlResource, parseJsonRecord } from "./utils.js";

export const KNOWLEDGE_TRANSFER_SCHEMA_VERSION = 1;
export const KNOWLEDGE_TRANSFER_DATA_FILE = "data.json";
export const KNOWLEDGE_TRANSFER_MANIFEST_FILE = "manifest.json";
export const KNOWLEDGE_TRANSFER_OBJECTS_DIR = "objects";
export const KNOWLEDGE_TRANSFER_PAGES_FILE = "pages.jsonl";

type Db = ReturnType<typeof getDatabase>;

type KnowledgeSpaceRow = typeof knowledgeSpaces.$inferSelect;
type KnowledgeSourceRow = typeof knowledgeSources.$inferSelect;
type KnowledgeIngestionRunRow = typeof knowledgeIngestionRuns.$inferSelect;
type KnowledgeItemRow = typeof knowledgeItems.$inferSelect;
type KnowledgeItemVersionRow = typeof knowledgeItemVersions.$inferSelect;
type KnowledgeChunkRow = typeof knowledgeChunks.$inferSelect;
type KnowledgeTemplateRow = typeof knowledgeTemplates.$inferSelect;
type KnowledgeArchiveMemberRow = typeof knowledgeArchiveMembers.$inferSelect;
type FileAssetRow = typeof fileAssets.$inferSelect;

export type KnowledgeTransferData = {
  knowledgeSpaces: KnowledgeSpaceRow[];
  knowledgeSources: KnowledgeSourceRow[];
  knowledgeIngestionRuns: KnowledgeIngestionRunRow[];
  knowledgeItems: KnowledgeItemRow[];
  knowledgeItemVersions: KnowledgeItemVersionRow[];
  knowledgeChunks: KnowledgeChunkRow[];
  knowledgeTemplates: KnowledgeTemplateRow[];
  knowledgeArchiveMembers: KnowledgeArchiveMemberRow[];
  fileAssets: FileAssetRow[];
};

export type KnowledgeTransferObject = {
  fileAssetId: string;
  bucket: string;
  objectKey: string;
  bundlePath: string;
  sha256: string;
  sizeBytes: number;
  filename: string;
  contentType: string;
};

export type KnowledgeTransferPage = {
  itemId: string;
  versionId: string;
  title: string;
  url: string;
  sourceUrl: string;
  resourceKind: string;
  contentType: string;
  fetchedAt: string;
  normalizedSha256: string | null;
  normalizedText: string;
  metadata: Record<string, unknown>;
};

export type KnowledgeTransferManifest = {
  schemaVersion: typeof KNOWLEDGE_TRANSFER_SCHEMA_VERSION;
  exporter: "operator-knowledge-transfer";
  exportedAt: string;
  spaceKey: string;
  source: {
    storageProvider: string;
    bucket: string | null;
  };
  counts: Record<keyof KnowledgeTransferData | "objects" | "pages", number>;
  objects: KnowledgeTransferObject[];
};

export type KnowledgeTransferStorageConfig = {
  storage: ObjectStorageAdapter;
  bucket: string;
};

export type ExportKnowledgeBundleOptions = {
  spaceKey: string;
  outDir: string;
  overwrite?: boolean;
  storage?: ObjectStorageAdapter;
  bucket?: string;
  db?: Db;
};

export type ImportKnowledgeBundleOptions = {
  bundleDir: string;
  storage?: ObjectStorageAdapter;
  bucket?: string;
  db?: Db;
};

export type CleanupHtmlPageFileAssetsOptions = {
  spaceKey?: string;
  dryRun?: boolean;
  storage?: ObjectStorageAdapter;
  bucket?: string;
  db?: Db;
};

export type CleanupHtmlPageFileAssetsResult = {
  spaceKey: string;
  dryRun: boolean;
  versionsMatched: number;
  versionsUpdated: number;
  candidateFileAssets: number;
  fileAssetsDeleted: number;
  objectsDeleted: number;
  skippedFileAssets: number;
  deletedBytes: number;
};

export async function exportKnowledgeBundle(options: ExportKnowledgeBundleOptions): Promise<KnowledgeTransferManifest> {
  const db = options.db ?? getDatabase();
  const storageConfig = options.storage
    ? { storage: options.storage, bucket: options.bucket ?? defaultKnowledgeBucket() }
    : createKnowledgeTransferStorageFromEnv(knowledgeTransferEnv(options.bucket));
  const outDir = path.resolve(options.outDir);
  if (options.overwrite) await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, KNOWLEDGE_TRANSFER_OBJECTS_DIR), { recursive: true });

  const data = await collectKnowledgeTransferData(db, options.spaceKey);
  const pages = knowledgeTransferPages(data);
  const manifestObjects: KnowledgeTransferObject[] = [];
  for (const file of data.fileAssets) {
    const object = await exportFileAssetObject({
      storage: storageConfig.storage,
      outDir,
      file
    });
    manifestObjects.push(object);
  }

  const manifest: KnowledgeTransferManifest = {
    schemaVersion: KNOWLEDGE_TRANSFER_SCHEMA_VERSION,
    exporter: "operator-knowledge-transfer",
    exportedAt: new Date().toISOString(),
    spaceKey: options.spaceKey,
    source: {
      storageProvider: storageConfig.storage.provider,
      bucket: storageConfig.bucket
    },
    counts: {
      knowledgeSpaces: data.knowledgeSpaces.length,
      knowledgeSources: data.knowledgeSources.length,
      knowledgeIngestionRuns: data.knowledgeIngestionRuns.length,
      knowledgeItems: data.knowledgeItems.length,
      knowledgeItemVersions: data.knowledgeItemVersions.length,
      knowledgeChunks: data.knowledgeChunks.length,
      knowledgeTemplates: data.knowledgeTemplates.length,
      knowledgeArchiveMembers: data.knowledgeArchiveMembers.length,
      fileAssets: data.fileAssets.length,
      objects: manifestObjects.length,
      pages: pages.length
    },
    objects: manifestObjects
  };

  await writeJson(path.join(outDir, KNOWLEDGE_TRANSFER_DATA_FILE), data);
  await writeJsonLines(path.join(outDir, KNOWLEDGE_TRANSFER_PAGES_FILE), pages);
  await writeJson(path.join(outDir, KNOWLEDGE_TRANSFER_MANIFEST_FILE), manifest);
  return manifest;
}

export async function importKnowledgeBundle(options: ImportKnowledgeBundleOptions): Promise<KnowledgeTransferManifest> {
  const db = options.db ?? getDatabase();
  const storageConfig = options.storage
    ? { storage: options.storage, bucket: options.bucket ?? defaultKnowledgeBucket() }
    : createKnowledgeTransferStorageFromEnv(knowledgeTransferEnv(options.bucket));
  const bundleDir = path.resolve(options.bundleDir);
  const manifest = await readJson<KnowledgeTransferManifest>(path.join(bundleDir, KNOWLEDGE_TRANSFER_MANIFEST_FILE));
  assertManifest(manifest);
  const data = reviveTransferData(await readJson<KnowledgeTransferData>(path.join(bundleDir, KNOWLEDGE_TRANSFER_DATA_FILE)));

  for (const object of manifest.objects) {
    await importFileAssetObject({
      storage: storageConfig.storage,
      targetBucket: storageConfig.bucket,
      bundleDir,
      object
    });
  }

  const targetFileAssets = data.fileAssets.map((file) => ({
    ...file,
    storageProvider: storageConfig.storage.provider,
    bucket: storageConfig.bucket,
    createdBy: null
  }));
  await insertFileAssets(db, targetFileAssets);
  await insertKnowledgeSpaces(db, data.knowledgeSpaces.map((row) => ({ ...row, createdBy: null })));
  await insertKnowledgeSources(db, data.knowledgeSources.map((row) => ({ ...row, createdBy: null })));
  await insertKnowledgeIngestionRuns(db, data.knowledgeIngestionRuns.map((row) => ({ ...row, createdBy: null })));
  await insertKnowledgeItems(db, data.knowledgeItems);
  await insertKnowledgeItemVersions(db, data.knowledgeItemVersions);
  await insertKnowledgeChunks(db, data.knowledgeChunks);
  await insertKnowledgeTemplates(db, data.knowledgeTemplates);
  await insertKnowledgeArchiveMembers(db, data.knowledgeArchiveMembers);

  return {
    ...manifest,
    source: {
      storageProvider: storageConfig.storage.provider,
      bucket: storageConfig.bucket
    }
  };
}

export async function cleanupHtmlPageFileAssets(
  options: CleanupHtmlPageFileAssetsOptions = {}
): Promise<CleanupHtmlPageFileAssetsResult> {
  const db = options.db ?? getDatabase();
  const spaceKey = options.spaceKey ?? "dianji";
  const storageConfig = options.storage
    ? { storage: options.storage, bucket: options.bucket ?? defaultKnowledgeBucket() }
    : createKnowledgeTransferStorageFromEnv(knowledgeTransferEnv(options.bucket));
  const [space] = await db.select().from(knowledgeSpaces).where(eq(knowledgeSpaces.key, spaceKey)).limit(1);
  if (!space) throw new Error(`Knowledge space not found: ${spaceKey}`);
  const rows = await db
    .select({ item: knowledgeItems, version: knowledgeItemVersions, file: fileAssets })
    .from(knowledgeItemVersions)
    .innerJoin(knowledgeItems, eq(knowledgeItemVersions.itemId, knowledgeItems.id))
    .innerJoin(fileAssets, eq(knowledgeItemVersions.fileAssetId, fileAssets.id))
    .where(eq(knowledgeItems.spaceId, space.id));
  const matched = rows.filter(({ item, version, file }) => {
    const itemMetadata = parseJsonRecord(item.metadata);
    const versionMetadata = parseJsonRecord(version.metadata);
    const contentType = String(versionMetadata.content_type || itemMetadata.content_type || file.contentType || "");
    return isKnowledgePage(item.resourceKind, item.canonicalUrl, contentType);
  });
  const result: CleanupHtmlPageFileAssetsResult = {
    spaceKey,
    dryRun: Boolean(options.dryRun),
    versionsMatched: matched.length,
    versionsUpdated: 0,
    candidateFileAssets: uniqueStrings(matched.map(({ file }) => file.id)).length,
    fileAssetsDeleted: 0,
    objectsDeleted: 0,
    skippedFileAssets: 0,
    deletedBytes: 0
  };
  if (options.dryRun) return result;

  for (const { version, file } of matched) {
    await db
      .update(knowledgeItemVersions)
      .set({
        fileAssetId: null,
        metadata: {
          ...parseJsonRecord(version.metadata),
          storage_mode: "text_only",
          removed_file_asset_id: file.id,
          removed_object_key: file.objectKey,
          removed_object_bucket: file.bucket
        }
      })
      .where(eq(knowledgeItemVersions.id, version.id));
    result.versionsUpdated += 1;
  }

  const filesById = new Map(matched.map(({ file }) => [file.id, file]));
  for (const file of filesById.values()) {
    const stillReferenced = await fileAssetStillReferenced(db, file.id);
    if (stillReferenced) {
      result.skippedFileAssets += 1;
      continue;
    }
    try {
      await db.delete(fileAssets).where(eq(fileAssets.id, file.id));
      result.fileAssetsDeleted += 1;
      result.deletedBytes += Number(file.sizeBytes);
    } catch {
      result.skippedFileAssets += 1;
      continue;
    }
    await storageConfig.storage.deleteObject(file.bucket, file.objectKey).then(
      () => {
        result.objectsDeleted += 1;
      },
      () => undefined
    );
  }
  return result;
}

export function createKnowledgeTransferStorageFromEnv(env: Record<string, string | undefined> = process.env): KnowledgeTransferStorageConfig {
  const provider = storageProvider(env);
  const bucket = env.OPERATOR_STORAGE_KNOWLEDGE_BUCKET?.trim() || defaultKnowledgeBucket();
  if (provider === "s3") {
    const region = env.OPERATOR_S3_REGION?.trim();
    if (!region) throw new Error("OPERATOR_S3_REGION is required when OPERATOR_STORAGE_PROVIDER=s3.");
    const accessKeyId = env.OPERATOR_S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.OPERATOR_S3_SECRET_ACCESS_KEY?.trim();
    if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
      throw new Error("OPERATOR_S3_ACCESS_KEY_ID and OPERATOR_S3_SECRET_ACCESS_KEY must be configured together.");
    }
    return {
      bucket,
      storage: new S3CompatibleStorageAdapter({
        endpoint: env.OPERATOR_S3_ENDPOINT?.trim() || undefined,
        region,
        accessKeyId: accessKeyId || undefined,
        secretAccessKey: secretAccessKey || undefined,
        forcePathStyle: booleanEnv(env.OPERATOR_S3_FORCE_PATH_STYLE) ?? Boolean(env.OPERATOR_S3_ENDPOINT?.trim())
      })
    };
  }
  return {
    bucket,
    storage: new LocalFsStorageAdapter(storageRoot(env))
  };
}

export function defaultKnowledgeBucket(): string {
  return "operator-knowledge";
}

export function loadKnowledgeTransferEnv(): void {
  loadDotenv();
}

export async function closeKnowledgeTransferDatabase(): Promise<void> {
  await closeDatabase();
}

async function collectKnowledgeTransferData(db: Db, spaceKey: string): Promise<KnowledgeTransferData> {
  const [space] = await db.select().from(knowledgeSpaces).where(eq(knowledgeSpaces.key, spaceKey)).limit(1);
  if (!space) throw new Error(`Knowledge space not found: ${spaceKey}`);

  const sources = await db.select().from(knowledgeSources).where(eq(knowledgeSources.spaceId, space.id));
  const items = await db.select().from(knowledgeItems).where(eq(knowledgeItems.spaceId, space.id));
  const itemIds = items.map((item) => item.id);
  const sourceIds = sources.map((source) => source.id);
  const versions = await selectKnowledgeItemVersions(db, itemIds);
  const versionIds = versions.map((version) => version.id);
  const chunks = await selectKnowledgeChunks(db, versionIds);
  const templates = await selectKnowledgeTemplates(db, itemIds);
  const archiveMembers = await selectArchiveMembers(db, versionIds);
  const runIds = uniqueStrings(versions.map((version) => version.ingestionRunId).filter(isString));
  const runs = await selectRuns(db, sourceIds, runIds);
  const fileAssetIds = uniqueStrings([
    ...versions.map((version) => version.fileAssetId).filter(isString),
    ...archiveMembers.map((member) => member.fileAssetId).filter(isString)
  ]);
  const files = await selectFileAssets(db, fileAssetIds);

  return {
    knowledgeSpaces: [space],
    knowledgeSources: sources,
    knowledgeIngestionRuns: runs,
    knowledgeItems: items,
    knowledgeItemVersions: versions,
    knowledgeChunks: chunks,
    knowledgeTemplates: templates,
    knowledgeArchiveMembers: archiveMembers,
    fileAssets: files
  };
}

async function exportFileAssetObject(params: {
  storage: ObjectStorageAdapter;
  outDir: string;
  file: FileAssetRow;
}): Promise<KnowledgeTransferObject> {
  const body = await params.storage.getObject(params.file.bucket, params.file.objectKey);
  const sha256 = sha256Buffer(body);
  if (sha256 !== params.file.sha256) {
    throw new Error(`File asset ${params.file.id} checksum mismatch: expected ${params.file.sha256}, got ${sha256}.`);
  }
  const relativePath = path.join(KNOWLEDGE_TRANSFER_OBJECTS_DIR, `${params.file.id}.bin`);
  const target = path.join(params.outDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
  return {
    fileAssetId: params.file.id,
    bucket: params.file.bucket,
    objectKey: params.file.objectKey,
    bundlePath: relativePath.split(path.sep).join("/"),
    sha256,
    sizeBytes: body.byteLength,
    filename: params.file.filename,
    contentType: params.file.contentType
  };
}

function knowledgeTransferPages(data: KnowledgeTransferData): KnowledgeTransferPage[] {
  const itemsById = new Map(data.knowledgeItems.map((item) => [item.id, item]));
  const pages: KnowledgeTransferPage[] = [];
  for (const version of data.knowledgeItemVersions) {
    const item = itemsById.get(version.itemId);
    if (!item) continue;
    const versionMetadata = parseJsonRecord(version.metadata);
    const itemMetadata = parseJsonRecord(item.metadata);
    const contentType = String(versionMetadata.content_type || itemMetadata.content_type || "");
    const sourceUrl = String(versionMetadata.source_url || itemMetadata.source_url || item.canonicalUrl);
    if (!isKnowledgePage(item.resourceKind, item.canonicalUrl, contentType)) continue;
    pages.push({
      itemId: item.id,
      versionId: version.id,
      title: item.title,
      url: item.canonicalUrl,
      sourceUrl,
      resourceKind: item.resourceKind,
      contentType,
      fetchedAt: version.fetchedAt.toISOString(),
      normalizedSha256: version.normalizedSha256,
      normalizedText: version.normalizedText ?? "",
      metadata: {
        item: itemMetadata,
        version: versionMetadata
      }
    });
  }
  return pages;
}

function isKnowledgePage(resourceKind: string, url: string, contentType: string): boolean {
  return ["page", "news", "notice", "policy", "faq"].includes(resourceKind) || isHtmlResource(url, contentType);
}

async function importFileAssetObject(params: {
  storage: ObjectStorageAdapter;
  targetBucket: string;
  bundleDir: string;
  object: KnowledgeTransferObject;
}): Promise<void> {
  const source = path.join(params.bundleDir, params.object.bundlePath);
  const body = await readFile(source);
  const sha256 = sha256Buffer(body);
  if (sha256 !== params.object.sha256) {
    throw new Error(`Bundle object ${params.object.bundlePath} checksum mismatch: expected ${params.object.sha256}, got ${sha256}.`);
  }
  const stats = await stat(source);
  if (stats.size !== params.object.sizeBytes) {
    throw new Error(`Bundle object ${params.object.bundlePath} size mismatch: expected ${params.object.sizeBytes}, got ${stats.size}.`);
  }
  await params.storage.putObject({
    bucket: params.targetBucket,
    key: params.object.objectKey,
    body,
    contentType: params.object.contentType,
    metadata: {
      source: "knowledge_transfer",
      file_asset_id: params.object.fileAssetId,
      original_bucket: params.object.bucket
    }
  });
}

async function selectArchiveMembers(db: Db, versionIds: string[]): Promise<KnowledgeArchiveMemberRow[]> {
  const rows: KnowledgeArchiveMemberRow[] = [];
  for (const ids of chunksOf(versionIds, 1000)) {
    rows.push(
      ...(await db
        .select()
        .from(knowledgeArchiveMembers)
        .where(or(inArray(knowledgeArchiveMembers.parentVersionId, ids), inArray(knowledgeArchiveMembers.itemVersionId, ids))))
    );
  }
  return uniqueRowsById(rows);
}

async function fileAssetStillReferenced(db: Db, fileAssetId: string): Promise<boolean> {
  const [version] = await db
    .select({ id: knowledgeItemVersions.id })
    .from(knowledgeItemVersions)
    .where(eq(knowledgeItemVersions.fileAssetId, fileAssetId))
    .limit(1);
  if (version) return true;
  const [archiveMember] = await db
    .select({ id: knowledgeArchiveMembers.id })
    .from(knowledgeArchiveMembers)
    .where(eq(knowledgeArchiveMembers.fileAssetId, fileAssetId))
    .limit(1);
  return Boolean(archiveMember);
}

async function selectRuns(db: Db, sourceIds: string[], runIds: string[]): Promise<KnowledgeIngestionRunRow[]> {
  const rows: KnowledgeIngestionRunRow[] = [];
  for (const ids of chunksOf(sourceIds, 1000)) {
    rows.push(...(await db.select().from(knowledgeIngestionRuns).where(inArray(knowledgeIngestionRuns.sourceId, ids))));
  }
  for (const ids of chunksOf(runIds, 1000)) {
    rows.push(...(await db.select().from(knowledgeIngestionRuns).where(inArray(knowledgeIngestionRuns.id, ids))));
  }
  return uniqueRowsById(rows);
}

async function selectKnowledgeItemVersions(db: Db, itemIds: string[]): Promise<KnowledgeItemVersionRow[]> {
  const rows: KnowledgeItemVersionRow[] = [];
  for (const ids of chunksOf(itemIds, 1000)) {
    rows.push(...(await db.select().from(knowledgeItemVersions).where(inArray(knowledgeItemVersions.itemId, ids))));
  }
  return rows;
}

async function selectKnowledgeChunks(db: Db, versionIds: string[]): Promise<KnowledgeChunkRow[]> {
  const rows: KnowledgeChunkRow[] = [];
  for (const ids of chunksOf(versionIds, 1000)) {
    rows.push(...(await db.select().from(knowledgeChunks).where(inArray(knowledgeChunks.itemVersionId, ids))));
  }
  return rows;
}

async function selectKnowledgeTemplates(db: Db, itemIds: string[]): Promise<KnowledgeTemplateRow[]> {
  const rows: KnowledgeTemplateRow[] = [];
  for (const ids of chunksOf(itemIds, 1000)) {
    rows.push(...(await db.select().from(knowledgeTemplates).where(inArray(knowledgeTemplates.itemId, ids))));
  }
  return rows;
}

async function selectFileAssets(db: Db, fileAssetIds: string[]): Promise<FileAssetRow[]> {
  const rows: FileAssetRow[] = [];
  for (const ids of chunksOf(fileAssetIds, 1000)) {
    rows.push(...(await db.select().from(fileAssets).where(inArray(fileAssets.id, ids))));
  }
  return rows;
}

async function insertFileAssets(db: Db, rows: FileAssetRow[]): Promise<void> {
  for (const batch of chunksOf(rows, 500)) {
    await db.insert(fileAssets).values(batch).onConflictDoNothing({ target: fileAssets.id });
  }
}

async function insertKnowledgeSpaces(db: Db, rows: KnowledgeSpaceRow[]): Promise<void> {
  for (const batch of chunksOf(rows, 500)) {
    await db.insert(knowledgeSpaces).values(batch).onConflictDoNothing({ target: knowledgeSpaces.id });
  }
}

async function insertKnowledgeSources(db: Db, rows: KnowledgeSourceRow[]): Promise<void> {
  for (const batch of chunksOf(rows, 500)) {
    await db.insert(knowledgeSources).values(batch).onConflictDoNothing({ target: knowledgeSources.id });
  }
}

async function insertKnowledgeIngestionRuns(db: Db, rows: KnowledgeIngestionRunRow[]): Promise<void> {
  for (const batch of chunksOf(rows, 500)) {
    await db.insert(knowledgeIngestionRuns).values(batch).onConflictDoNothing({ target: knowledgeIngestionRuns.id });
  }
}

async function insertKnowledgeItems(db: Db, rows: KnowledgeItemRow[]): Promise<void> {
  for (const batch of chunksOf(rows, 500)) {
    await db.insert(knowledgeItems).values(batch).onConflictDoNothing({ target: knowledgeItems.id });
  }
}

async function insertKnowledgeItemVersions(db: Db, rows: KnowledgeItemVersionRow[]): Promise<void> {
  for (const batch of chunksOf(rows, 500)) {
    await db.insert(knowledgeItemVersions).values(batch).onConflictDoNothing({ target: knowledgeItemVersions.id });
  }
}

async function insertKnowledgeChunks(db: Db, rows: KnowledgeChunkRow[]): Promise<void> {
  for (const batch of chunksOf(rows, 500)) {
    await db.insert(knowledgeChunks).values(batch).onConflictDoNothing({ target: knowledgeChunks.id });
  }
}

async function insertKnowledgeTemplates(db: Db, rows: KnowledgeTemplateRow[]): Promise<void> {
  for (const batch of chunksOf(rows, 500)) {
    await db.insert(knowledgeTemplates).values(batch).onConflictDoNothing({ target: knowledgeTemplates.id });
  }
}

async function insertKnowledgeArchiveMembers(db: Db, rows: KnowledgeArchiveMemberRow[]): Promise<void> {
  for (const batch of chunksOf(rows, 500)) {
    await db.insert(knowledgeArchiveMembers).values(batch).onConflictDoNothing({ target: knowledgeArchiveMembers.id });
  }
}

function reviveTransferData(data: KnowledgeTransferData): KnowledgeTransferData {
  return {
    knowledgeSpaces: reviveDateColumns(data.knowledgeSpaces, ["createdAt", "updatedAt"]),
    knowledgeSources: reviveDateColumns(data.knowledgeSources, ["createdAt", "updatedAt"]),
    knowledgeIngestionRuns: reviveDateColumns(data.knowledgeIngestionRuns, ["startedAt", "finishedAt", "createdAt", "updatedAt"]),
    knowledgeItems: reviveDateColumns(data.knowledgeItems, ["publishedAt", "createdAt", "updatedAt"]),
    knowledgeItemVersions: reviveDateColumns(data.knowledgeItemVersions, ["fetchedAt"]),
    knowledgeChunks: data.knowledgeChunks,
    knowledgeTemplates: reviveDateColumns(data.knowledgeTemplates, ["createdAt", "updatedAt"]),
    knowledgeArchiveMembers: reviveDateColumns(data.knowledgeArchiveMembers, ["createdAt"]),
    fileAssets: reviveDateColumns(data.fileAssets, ["createdAt", "deletedAt"])
  };
}

function reviveDateColumns<T extends Record<string, unknown>>(rows: T[], columns: string[]): T[] {
  return rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const column of columns) {
      if (typeof next[column] === "string") next[column] = new Date(next[column]);
    }
    return next as T;
  });
}

function assertManifest(manifest: KnowledgeTransferManifest): void {
  if (manifest.schemaVersion !== KNOWLEDGE_TRANSFER_SCHEMA_VERSION) {
    throw new Error(`Unsupported knowledge transfer schema version: ${manifest.schemaVersion}.`);
  }
  if (manifest.exporter !== "operator-knowledge-transfer") {
    throw new Error(`Unsupported knowledge transfer exporter: ${manifest.exporter}.`);
  }
}

function storageProvider(env: Record<string, string | undefined>): "local" | "s3" {
  const explicit = env.OPERATOR_STORAGE_PROVIDER?.trim().toLowerCase();
  if (explicit === "local" || explicit === "s3") return explicit;
  return env.OPERATOR_S3_ENDPOINT?.trim() || env.OPERATOR_S3_REGION?.trim() ? "s3" : "local";
}

function storageRoot(env: Record<string, string | undefined>): string {
  const configured = env.OPERATOR_STORAGE_ROOT?.trim();
  if (!configured) return path.join(repoRoot(), "tmp/object-storage");
  return path.isAbsolute(configured) ? configured : path.join(repoRoot(), configured);
}

function knowledgeTransferEnv(bucket: string | undefined): Record<string, string | undefined> {
  return {
    ...process.env,
    ...(bucket ? { OPERATOR_STORAGE_KNOWLEDGE_BUCKET: bucket } : {})
  };
}

function booleanEnv(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function sha256Buffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonLines(filePath: string, values: unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${values.map((value) => JSON.stringify(value)).join("\n")}${values.length ? "\n" : ""}`, "utf8");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function chunksOf<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueRowsById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }
  return unique;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
