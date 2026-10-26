import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  fileAssets,
  knowledgeArchiveMembers,
  knowledgeChunks,
  knowledgeIngestionRuns,
  knowledgeItemVersions,
  knowledgeItems,
  knowledgeTemplates,
  knowledgeSources,
  knowledgeSpaces
} from "@operator/db";
import type { OperatorDatabase } from "@operator/db";
import type { ObjectStorageAdapter } from "@operator/storage";
import { expandArchive } from "./archive.js";
import { parseResource, PARSER_VERSION } from "./parsing.js";
import type {
  FetchedResource,
  KnowledgeIngestionOptions,
  KnowledgeRunStats,
  KnowledgeSourceRules,
  ParsedResource,
  StoredFileAsset
} from "./types.js";
import {
  chunkText,
  classifyResource,
  emptyRunStats,
  extensionOfUrl,
  filenameFromUrl,
  incrementFailure,
  isArchiveUrl,
  isHtmlResource,
  normalizeText,
  parseJsonRecord,
  sha256Buffer
} from "./utils.js";

export type KnowledgeIngestionRunResult = {
  runId: string;
  status: "succeeded" | "failed";
  stats: KnowledgeRunStats;
};

type Db = OperatorDatabase;

export async function ensureKnowledgeSpace(
  db: Db,
  params: {
    key: string;
    name: string;
    domainType?: string;
    visibility?: "public" | "organization" | "private";
    config?: Record<string, unknown>;
  }
) {
  const [existing] = await db.select().from(knowledgeSpaces).where(eq(knowledgeSpaces.key, params.key)).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(knowledgeSpaces)
    .values({
      key: params.key,
      name: params.name,
      domainType: params.domainType ?? "education",
      visibility: params.visibility ?? "public",
      config: params.config ?? {},
      status: "active"
    })
    .returning();
  if (!created) throw new Error("Failed to create knowledge space.");
  return created;
}

export async function ensureKnowledgeSource(
  db: Db,
  params: {
    spaceKey: string;
    baseUrl: string;
    type?: string;
    rules?: KnowledgeSourceRules;
    crawlerConfig?: Record<string, unknown>;
    schedule?: string | null;
  }
) {
  const space = await ensureKnowledgeSpace(db, {
    key: params.spaceKey,
    name: params.spaceKey === "dianji" ? "电机百事通" : params.spaceKey
  });
  const [existing] = await db
    .select()
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.spaceId, space.id), eq(knowledgeSources.baseUrl, params.baseUrl)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(knowledgeSources)
    .values({
      spaceId: space.id,
      type: params.type ?? "full_site",
      baseUrl: params.baseUrl,
      rules: params.rules ?? {},
      crawlerAdapter: "crawlee",
      crawlerConfig: params.crawlerConfig ?? {},
      schedule: params.schedule ?? null,
      scheduleTimezone: "Asia/Shanghai",
      status: "active"
    })
    .returning();
  if (!created) throw new Error("Failed to create knowledge source.");
  return created;
}

export async function runKnowledgeSourceIngestion(
  options: KnowledgeIngestionOptions & {
    resources?: FetchedResource[];
    crawl?: (source: typeof knowledgeSources.$inferSelect, runId: string) => Promise<FetchedResource[]>;
  }
): Promise<KnowledgeIngestionRunResult> {
  const db = options.db;
  const now = options.now ?? (() => new Date());
  const [source] = await db.select().from(knowledgeSources).where(eq(knowledgeSources.id, options.sourceId)).limit(1);
  if (!source) throw new Error(`Knowledge source not found: ${options.sourceId}`);
  const [run] = await db
    .insert(knowledgeIngestionRuns)
    .values({
      sourceId: source.id,
      runType: options.runType ?? "manual",
      trigger: options.trigger ?? "manual",
      status: "running",
      startedAt: now(),
      createdBy: options.createdBy ?? null
    })
    .returning();
  if (!run) throw new Error("Failed to create ingestion run.");

  const stats = emptyRunStats();
  try {
    const resources = options.resources ?? (options.crawl ? await options.crawl(source, run.id) : []);
    stats.discovered_urls = resources.length;
    for (const resource of resources) {
      await ingestResource({ ...options, db, source, runId: run.id, resource, stats });
    }
    await db
      .update(knowledgeIngestionRuns)
      .set({ status: "succeeded", stats, finishedAt: now(), updatedAt: now() })
      .where(eq(knowledgeIngestionRuns.id, run.id));
    return { runId: run.id, status: "succeeded", stats };
  } catch (error) {
    await db
      .update(knowledgeIngestionRuns)
      .set({
        status: "failed",
        stats,
        error: { message: error instanceof Error ? error.message : String(error) },
        finishedAt: now(),
        updatedAt: now()
      })
      .where(eq(knowledgeIngestionRuns.id, run.id));
    return { runId: run.id, status: "failed", stats };
  }
}

export async function ingestResource(params: {
  db: Db;
  storage: ObjectStorageAdapter;
  bucket: string;
  source: typeof knowledgeSources.$inferSelect;
  runId: string;
  resource: FetchedResource;
  stats: KnowledgeRunStats;
  tikaUrl?: string;
  archiveTempDir?: string;
}): Promise<void> {
  const { db, resource, stats, source } = params;
  try {
    const rawSha = sha256Buffer(resource.body);
    const filename = resource.filename ?? filenameFromUrl(resource.url, resource.contentType);
    const parsed = await parseResource(resource, { tikaUrl: params.tikaUrl });
    if (parsed.parseStatus === "failed") incrementFailure(stats, resource.contentType || "unknown");
    const storeOriginalFile = !isHtmlResource(resource.filename || resource.url, resource.contentType);
    const file = storeOriginalFile
      ? await storeFileAsset(params.storage, db, {
          bucket: params.bucket,
          body: resource.body,
          filename,
          contentType: resource.contentType,
          sha256: rawSha,
          metadata: {
            source: "knowledge",
            source_url: resource.url,
            parent_source_url: resource.sourceUrl ?? resource.url
          }
        })
      : null;
    if (file?.deduped) stats.deduped_file_assets += 1;
    else if (file) stats.stored_bytes += file.sizeBytes;

    const version = await upsertKnowledgeItemVersion({
      db,
      source,
      runId: params.runId,
      resource,
      file,
      parsed,
      rawSha
    });
    stats.fetched_items += 1;
    if (version.created) stats.new_items += 1;
    else stats.unchanged_items += 1;

    if (file && isArchiveUrl(resource.url)) {
      const archive = await expandArchive({ url: resource.url, body: resource.body }, { tempDir: params.archiveTempDir });
      stats.archive_members_found += archive.members.length;
      if (archive.status !== "expanded") {
        await db
          .insert(knowledgeArchiveMembers)
          .values({
            parentVersionId: version.versionId,
            memberPath: "__archive__",
            parseStatus: archive.status === "failed" ? "failed" : "skipped",
            metadata: archive.metadata
          })
          .onConflictDoNothing();
        return;
      }
      for (const member of archive.members) {
        const memberUrl = `${resource.url}#${encodeURIComponent(member.memberPath)}`;
        const memberResource: FetchedResource = {
          url: memberUrl,
          sourceUrl: resource.url,
          title: member.filename,
          body: member.body,
          contentType: member.contentType,
          filename: member.filename
        };
        const memberFile = await storeFileAsset(params.storage, db, {
          bucket: params.bucket,
          body: member.body,
          filename: member.filename,
          contentType: member.contentType,
          sha256: member.sha256,
          metadata: {
            source: "knowledge_archive_member",
            source_url: memberUrl,
            archive_url: resource.url,
            member_path: member.memberPath
          }
        });
        if (memberFile.deduped) stats.deduped_file_assets += 1;
        else stats.stored_bytes += memberFile.sizeBytes;
        const memberParsed = await parseResource(memberResource, { tikaUrl: params.tikaUrl });
        const memberVersion = await upsertKnowledgeItemVersion({
          db,
          source,
          runId: params.runId,
          resource: memberResource,
          file: memberFile,
          parsed: memberParsed,
          rawSha: member.sha256,
          archiveMetadata: {
            archive_url: resource.url,
            archive_version_id: version.versionId,
            archive_file_asset_id: file.id,
            member_path: member.memberPath
          }
        });
        await db
          .insert(knowledgeArchiveMembers)
          .values({
            parentVersionId: version.versionId,
            itemVersionId: memberVersion.versionId,
            fileAssetId: memberFile.id,
            memberPath: member.memberPath,
            memberSha256: member.sha256,
            sizeBytes: member.sizeBytes,
            contentType: member.contentType,
            parseStatus: memberParsed.parseStatus === "failed" ? "failed" : "parsed",
            metadata: {
              archive_url: resource.url,
              source_url: memberUrl
            }
          })
          .onConflictDoNothing();
      }
    }
  } catch (error) {
    stats.failed_items += 1;
    incrementFailure(stats, error instanceof Error ? error.name : "unknown");
  }
}

async function storeFileAsset(
  storage: ObjectStorageAdapter,
  db: Db,
  params: {
    bucket: string;
    body: Buffer;
    filename: string;
    contentType: string;
    sha256: string;
    metadata: Record<string, string>;
  }
): Promise<StoredFileAsset> {
  const [existing] = await db
    .select()
    .from(fileAssets)
    .where(eq(fileAssets.sha256, params.sha256))
    .orderBy(desc(fileAssets.createdAt))
    .limit(1);
  if (existing) {
    return {
      id: existing.id,
      sha256: existing.sha256,
      sizeBytes: Number(existing.sizeBytes),
      deduped: true
    };
  }
  const key = `knowledge/${params.sha256.slice(0, 2)}/${params.sha256}/${safeFilename(params.filename)}`;
  await storage.putObject({
    bucket: params.bucket,
    key,
    body: params.body,
    contentType: params.contentType,
    metadata: params.metadata
  });
  const [created] = await db
    .insert(fileAssets)
    .values({
      storageProvider: storage.provider,
      bucket: params.bucket,
      objectKey: key,
      filename: params.filename,
      contentType: params.contentType,
      sha256: params.sha256,
      sizeBytes: params.body.byteLength,
      metadata: params.metadata
    })
    .returning();
  if (!created) throw new Error("Failed to create file asset.");
  return { id: created.id, sha256: created.sha256, sizeBytes: Number(created.sizeBytes), deduped: false };
}

async function upsertKnowledgeItemVersion(params: {
  db: Db;
  source: typeof knowledgeSources.$inferSelect;
  runId: string;
  resource: FetchedResource;
  file: StoredFileAsset | null;
  parsed: ParsedResource;
  rawSha: string;
  archiveMetadata?: Record<string, unknown>;
}): Promise<{ versionId: string; created: boolean }> {
  const db = params.db;
  const title = normalizeText(
    params.parsed.title || params.resource.title || filenameFromUrl(params.resource.url, params.resource.contentType)
  );
  const kind = classifyResource(params.resource.url, params.resource.contentType, title);
  const [sourceSpace] = await db
    .select({ spaceId: knowledgeSources.spaceId })
    .from(knowledgeSources)
    .where(eq(knowledgeSources.id, params.source.id))
    .limit(1);
  if (!sourceSpace) throw new Error(`Knowledge source not found: ${params.source.id}`);

  const [existingItem] = await db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.spaceId, sourceSpace.spaceId), eq(knowledgeItems.canonicalUrl, params.resource.url)))
    .limit(1);
  const item =
    existingItem ??
    (
      await db
        .insert(knowledgeItems)
        .values({
          spaceId: sourceSpace.spaceId,
          sourceId: params.source.id,
          canonicalUrl: params.resource.url,
          title,
          resourceKind: kind,
          visibility: "public",
          status: "active",
          metadata: {
            content_type: params.resource.contentType,
            source_url: params.resource.sourceUrl ?? params.resource.url,
            ...(params.archiveMetadata ?? {})
          }
        })
        .returning()
    )[0];
  if (!item) throw new Error("Failed to create knowledge item.");

  if (existingItem) {
    await db
      .update(knowledgeItems)
      .set({
        title,
        resourceKind: kind,
        status: "active",
        updatedAt: new Date(),
        metadata: {
          ...parseJsonRecord(existingItem.metadata),
          content_type: params.resource.contentType,
          source_url: params.resource.sourceUrl ?? params.resource.url,
          ...(params.archiveMetadata ?? {})
        }
      })
      .where(eq(knowledgeItems.id, existingItem.id));
  }

  const [existingVersion] = await db
    .select()
    .from(knowledgeItemVersions)
    .where(and(eq(knowledgeItemVersions.itemId, item.id), eq(knowledgeItemVersions.rawSha256, params.rawSha)))
    .limit(1);
  if (existingVersion) {
    if (params.file) {
      await ensureKnowledgeTemplateCandidate({
        db,
        itemId: item.id,
        versionId: existingVersion.id,
        fileAssetId: params.file.id,
        resource: params.resource,
        resourceKind: kind
      });
    }
    return { versionId: existingVersion.id, created: false };
  }
  const normalizedSha = params.parsed.normalizedText ? sha256Buffer(params.parsed.normalizedText) : null;
  const [version] = await db
    .insert(knowledgeItemVersions)
    .values({
      itemId: item.id,
      ingestionRunId: params.runId,
      fileAssetId: params.file?.id ?? null,
      rawSha256: params.rawSha,
      normalizedSha256: normalizedSha,
      extractedText: params.parsed.text,
      normalizedText: params.parsed.normalizedText,
      parserVersion: PARSER_VERSION,
      metadata: {
        ...params.parsed.metadata,
        ...(params.archiveMetadata ?? {}),
        ...(params.file
          ? { file_asset_id: params.file.id, storage_mode: "original_file" }
          : { storage_mode: "text_only", raw_resource_sha256: params.rawSha, source_url: params.resource.url })
      }
    })
    .returning();
  if (!version) throw new Error("Failed to create knowledge item version.");

  const chunks = chunkText(params.parsed.normalizedText);
  if (chunks.length) {
    await db.insert(knowledgeChunks).values(
      chunks.map((chunk) => ({
        itemVersionId: version.id,
        ordinal: chunk.ordinal,
        text: chunk.text,
        metadata: {
          source_url: params.resource.url
        }
      }))
    );
  }
  if (params.file) {
    await ensureKnowledgeTemplateCandidate({
      db,
      itemId: item.id,
      versionId: version.id,
      fileAssetId: params.file.id,
      resource: params.resource,
      resourceKind: kind
    });
  }
  return { versionId: version.id, created: true };
}

async function ensureKnowledgeTemplateCandidate(params: {
  db: Db;
  itemId: string;
  versionId: string;
  fileAssetId: string;
  resource: FetchedResource;
  resourceKind: string;
}): Promise<void> {
  const templateKind = templateKindForResource(params.resource, params.resourceKind);
  if (!templateKind) return;
  await params.db
    .insert(knowledgeTemplates)
    .values({
      itemId: params.itemId,
      templateKind,
      fieldsSchema: {
        type: "object",
        additionalProperties: true,
        fields: [],
        source: "auto_template_candidate"
      },
      instructions: {
        source: "auto_template_candidate",
        source_url: params.resource.sourceUrl ?? params.resource.url,
        template_url: params.resource.url,
        template_version_id: params.versionId,
        file_asset_id: params.fileAssetId
      },
      status: "active"
    })
    .onConflictDoNothing({ target: [knowledgeTemplates.itemId, knowledgeTemplates.templateKind] });
}

function templateKindForResource(resource: FetchedResource, resourceKind: string): string | null {
  const ext = extensionOfUrl(resource.filename || resource.url).replace(/^\./u, "");
  if (["doc", "docx", "xls", "xlsx", "pdf"].includes(ext)) {
    const text = `${resource.url} ${resource.title ?? ""} ${resource.filename ?? ""}`.toLowerCase();
    if (resourceKind === "template" || resourceKind === "form" || /模板|表格|申请表|登记表|form/u.test(text)) return ext;
  }
  return null;
}

function safeFilename(filename: string): string {
  return filename.replace(/[^\w.\-\u4e00-\u9fa5]+/gu, "_").replace(/^_+|_+$/gu, "") || randomUUID();
}
