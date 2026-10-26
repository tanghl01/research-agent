import { desc, eq } from "drizzle-orm";
import { Document, Packer, Paragraph, TextRun } from "docx";
import * as XLSX from "xlsx";
import { ensureKnowledgeSource, ensureKnowledgeSpace } from "@operator/knowledge-ingestion/ingestion";
import { findKnowledgeTemplates, getKnowledgeItem, getKnowledgeTemplate, searchKnowledge } from "@operator/knowledge-ingestion/search";
import { getDatabase, knowledgeIngestionRuns, knowledgeItems, knowledgeSources } from "@operator/db";
import { createJobQueueFromEnv, type JobQueue } from "@operator/queue";
import { createServerGeneratedArtifactForRequest } from "./artifacts";

export const KNOWLEDGE_QUEUE = "knowledge-ingestion";
export const KNOWLEDGE_SOURCE_RUN_JOB = "knowledge-source-run";

export class ServerKnowledgeError extends Error {
  status: number;
  code: string;

  constructor(message: string, options: { status?: number; code?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "ServerKnowledgeError";
    this.status = options.status ?? 500;
    this.code = options.code ?? "KNOWLEDGE_ERROR";
  }
}

export type KnowledgeSourceRunPayload = Record<string, unknown> & {
  sourceId: string;
  runType?: "manual" | "scheduled" | "full_rescan";
  trigger?: string;
};

export async function ensureDianjiKnowledgeSource() {
  const db = getDatabase();
  await ensureKnowledgeSpace(db, {
    key: "dianji",
    name: "电机百事通",
    domainType: "education",
    visibility: "public",
    config: {
      school: "上海电机学院"
    }
  });
  const source = await ensureKnowledgeSource(db, {
    spaceKey: "dianji",
    baseUrl: "https://www.sdju.edu.cn/",
    type: "full_site",
    rules: {
      allowHosts: ["www.sdju.edu.cn", "*.sdju.edu.cn"],
      denyPatterns: ["/sso/", "/login", "/logout", "/_visitcount", "captcha"],
      maxPages: 20000,
      maxAttachments: 50000
    },
    crawlerConfig: {
      sameHostConcurrency: 2,
      maxRequestsPerCrawl: 20000,
      userAgent: "OperatorKnowledgeCrawler/0.1 (+https://www.suanziai.com)"
    },
    schedule: "0 3 * * *"
  });
  await syncKnowledgeSourceScheduler(source.id).catch(() => undefined);
  return source;
}

export async function enqueueKnowledgeSourceRun(payload: KnowledgeSourceRunPayload, queue: JobQueue = createJobQueueFromEnv()) {
  return queue.enqueue(KNOWLEDGE_QUEUE, KNOWLEDGE_SOURCE_RUN_JOB, payload);
}

export async function syncKnowledgeSourceScheduler(sourceId: string, queue: JobQueue = createJobQueueFromEnv()) {
  const source = await getKnowledgeSource(sourceId);
  if (source.status !== "active" || !source.schedule) return null;
  if (!queue.upsertSchedule) return null;
  return queue.upsertSchedule(
    KNOWLEDGE_QUEUE,
    `knowledge-source-${source.id}`,
    source.schedule,
    KNOWLEDGE_SOURCE_RUN_JOB,
    {
      sourceId: source.id,
      runType: "scheduled",
      trigger: "scheduler"
    }
  );
}

export async function syncActiveKnowledgeSourceSchedulers(queue: JobQueue = createJobQueueFromEnv()) {
  const sources = await getDatabase().select().from(knowledgeSources).where(eq(knowledgeSources.status, "active"));
  const scheduled = [];
  for (const source of sources) {
    const job = await syncKnowledgeSourceScheduler(source.id, queue);
    if (job) scheduled.push(job);
  }
  return scheduled;
}

export async function searchPublicKnowledge(params: { space?: string; query: string; resourceKind?: string; limit?: number }) {
  return searchKnowledge(getDatabase(), params);
}

export async function getPublicKnowledgeItem(itemId: string) {
  const item = await getKnowledgeItem(getDatabase(), itemId);
  if (!item) throw new ServerKnowledgeError("Knowledge item not found.", { status: 404, code: "KNOWLEDGE_ITEM_NOT_FOUND" });
  return item;
}

export async function listKnowledgeTemplates(params: { space?: string; query?: string; outputFormat?: string; limit?: number }) {
  return findKnowledgeTemplates(getDatabase(), params);
}

export async function fillKnowledgeTemplateForRequest(
  request: Request,
  params: { templateId: string; fields: Record<string, unknown>; outputFormat?: string }
) {
  const template = await getKnowledgeTemplate(getDatabase(), params.templateId);
  if (!template) throw new ServerKnowledgeError("Knowledge template not found.", { status: 404, code: "KNOWLEDGE_TEMPLATE_NOT_FOUND" });
  const outputFormat = normalizeDraftFormat(params.outputFormat ?? template.template.templateKind);
  const generatedAt = new Date().toISOString();
  const metadata = {
    template_id: template.template.id,
    template_item_id: template.item.id,
    template_version_id: template.version?.id ?? null,
    template_file_asset_id: template.file?.id ?? null,
    template_url: template.item.canonicalUrl,
    template_kind: template.template.templateKind,
    knowledge_space: template.spaceKey,
    fields: params.fields,
    fields_schema: template.template.fieldsSchema,
    generated_at: generatedAt
  };
  const filename = `${slugFilename(template.item.title || "knowledge-template-draft")}.${outputFormat}`;
  const body =
    outputFormat === "xlsx"
      ? buildXlsxDraft({
          title: template.item.title,
          sourceUrl: template.item.canonicalUrl,
          fields: params.fields,
          generatedAt
        })
      : await buildDocxDraft({
          title: template.item.title,
          sourceUrl: template.item.canonicalUrl,
          fields: params.fields,
          generatedAt
        });
  const registration = await createServerGeneratedArtifactForRequest(request, {
    filename,
    contentType:
      outputFormat === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    body,
    type: outputFormat,
    title: `${template.item.title} 草稿`,
    metadata
  });
  return {
    artifact: {
      artifactId: registration.artifactId,
      href: registration.href,
      downloadHref: registration.downloadHref,
      filename: registration.record.filename,
      contentType: registration.record.content_type,
      sizeBytes: registration.record.size_bytes,
      metadata: registration.record.metadata
    },
    template: {
      id: template.template.id,
      itemId: template.item.id,
      versionId: template.version?.id ?? null,
      title: template.item.title,
      sourceUrl: template.item.canonicalUrl,
      fieldsSchema: template.template.fieldsSchema
    },
    setCookie: registration.setCookie
  };
}

export async function listKnowledgeSources() {
  return getDatabase().select().from(knowledgeSources);
}

export async function createKnowledgeSpace(params: {
  key: string;
  name: string;
  domainType?: string;
  visibility?: "public" | "organization" | "private";
  config?: Record<string, unknown>;
}) {
  return ensureKnowledgeSpace(getDatabase(), {
    key: params.key,
    name: params.name,
    domainType: params.domainType,
    visibility: params.visibility,
    config: params.config
  });
}

export async function createKnowledgeSource(params: {
  spaceKey: string;
  baseUrl: string;
  type?: string;
  rules?: Record<string, unknown>;
  crawlerConfig?: Record<string, unknown>;
  schedule?: string | null;
}) {
  const source = await ensureKnowledgeSource(getDatabase(), {
    spaceKey: params.spaceKey,
    baseUrl: params.baseUrl,
    type: params.type,
    rules: params.rules,
    crawlerConfig: params.crawlerConfig,
    schedule: params.schedule
  });
  await syncKnowledgeSourceScheduler(source.id).catch(() => undefined);
  return source;
}

export async function getKnowledgeSource(sourceId: string) {
  const [source] = await getDatabase().select().from(knowledgeSources).where(eq(knowledgeSources.id, sourceId)).limit(1);
  if (!source) throw new ServerKnowledgeError("Knowledge source not found.", { status: 404, code: "KNOWLEDGE_SOURCE_NOT_FOUND" });
  return source;
}

export async function getKnowledgeRun(runId: string) {
  const [run] = await getDatabase().select().from(knowledgeIngestionRuns).where(eq(knowledgeIngestionRuns.id, runId)).limit(1);
  if (!run) throw new ServerKnowledgeError("Knowledge run not found.", { status: 404, code: "KNOWLEDGE_RUN_NOT_FOUND" });
  return run;
}

export async function listKnowledgeRuns(params: { sourceId?: string; limit?: number }) {
  const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
  const db = getDatabase();
  if (params.sourceId) {
    return db
      .select()
      .from(knowledgeIngestionRuns)
      .where(eq(knowledgeIngestionRuns.sourceId, params.sourceId))
      .orderBy(desc(knowledgeIngestionRuns.createdAt))
      .limit(limit);
  }
  return db.select().from(knowledgeIngestionRuns).orderBy(desc(knowledgeIngestionRuns.createdAt)).limit(limit);
}

export async function patchKnowledgeItem(
  itemId: string,
  patch: { title?: string; resourceKind?: string; category?: string | null; status?: "active" | "paused" | "archived" | "deleted" | "stale"; metadata?: Record<string, unknown> }
) {
  const [existing] = await getDatabase().select().from(knowledgeItems).where(eq(knowledgeItems.id, itemId)).limit(1);
  if (!existing) throw new ServerKnowledgeError("Knowledge item not found.", { status: 404, code: "KNOWLEDGE_ITEM_NOT_FOUND" });
  const [item] = await getDatabase()
    .update(knowledgeItems)
    .set({
      title: patch.title ?? existing.title,
      resourceKind: patch.resourceKind ?? existing.resourceKind,
      category: patch.category === undefined ? existing.category : patch.category,
      status: patch.status ?? existing.status,
      metadata: patch.metadata ? { ...(existing.metadata as Record<string, unknown>), ...patch.metadata, manual_override: true } : existing.metadata,
      updatedAt: new Date()
    })
    .where(eq(knowledgeItems.id, itemId))
    .returning();
  return item;
}

export function knowledgeErrorResponse(error: unknown): Response {
  if (error instanceof ServerKnowledgeError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : String(error), code: "KNOWLEDGE_ERROR" }, { status: 500 });
}

async function buildDocxDraft(params: { title: string; sourceUrl: string; fields: Record<string, unknown>; generatedAt: string }): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ text: params.title, bold: true, size: 32 })] }),
          new Paragraph({ children: [new TextRun({ text: "模板来源：", bold: true }), new TextRun(params.sourceUrl)] }),
          new Paragraph({ children: [new TextRun({ text: "生成时间：", bold: true }), new TextRun(params.generatedAt)] }),
          new Paragraph({ text: "" }),
          ...Object.entries(params.fields).flatMap(([key, value]) => [
            new Paragraph({ children: [new TextRun({ text: key, bold: true })] }),
            new Paragraph({ children: [new TextRun(formatFieldValue(value))] })
          ])
        ]
      }
    ]
  });
  return Packer.toBuffer(doc);
}

function buildXlsxDraft(params: { title: string; sourceUrl: string; fields: Record<string, unknown>; generatedAt: string }): Buffer {
  const workbook = XLSX.utils.book_new();
  const rows = [
    ["模板标题", params.title],
    ["模板来源", params.sourceUrl],
    ["生成时间", params.generatedAt],
    [],
    ["字段", "值"],
    ...Object.entries(params.fields).map(([key, value]) => [key, formatFieldValue(value)])
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 28 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, "草稿");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

function normalizeDraftFormat(value: string): "docx" | "xlsx" {
  const normalized = value.toLowerCase();
  if (normalized === "xls" || normalized === "xlsx") return "xlsx";
  return "docx";
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function slugFilename(value: string): string {
  const safe = value.replace(/[^\w.\-\u4e00-\u9fa5]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 120);
  return safe || "knowledge-template-draft";
}
