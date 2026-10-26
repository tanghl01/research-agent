import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  fileAssets,
  knowledgeChunks,
  knowledgeItemVersions,
  knowledgeItems,
  knowledgeSpaces,
  knowledgeTemplates
} from "@operator/db";
import type { OperatorDatabase } from "@operator/db";
import type { KnowledgeSearchResult } from "./types.js";
import { normalizeText } from "./utils.js";

export async function searchKnowledge(
  db: OperatorDatabase,
  params: {
    space?: string;
    query: string;
    resourceKind?: string;
    limit?: number;
  }
): Promise<KnowledgeSearchResult[]> {
  const query = normalizeText(params.query);
  if (!query) return [];
  const limit = Math.max(1, Math.min(params.limit ?? 10, 50));
  const pattern = `%${query.replace(/[%_]/gu, "\\$&")}%`;
  const rows = await db
    .select({
      item: knowledgeItems,
      version: knowledgeItemVersions,
      chunk: knowledgeChunks,
      spaceKey: knowledgeSpaces.key
    })
    .from(knowledgeItems)
    .innerJoin(knowledgeSpaces, eq(knowledgeItems.spaceId, knowledgeSpaces.id))
    .leftJoin(knowledgeItemVersions, eq(knowledgeItemVersions.itemId, knowledgeItems.id))
    .leftJoin(knowledgeChunks, eq(knowledgeChunks.itemVersionId, knowledgeItemVersions.id))
    .where(
      and(
        eq(knowledgeItems.status, "active"),
        params.space ? eq(knowledgeSpaces.key, params.space) : undefined,
        params.resourceKind ? eq(knowledgeItems.resourceKind, params.resourceKind) : undefined,
        or(ilike(knowledgeItems.title, pattern), ilike(knowledgeItems.canonicalUrl, pattern), ilike(knowledgeChunks.text, pattern))
      )
    )
    .orderBy(desc(knowledgeItemVersions.fetchedAt))
    .limit(limit * 3);

  const deduped = new Map<string, KnowledgeSearchResult>();
  for (const row of rows) {
    if (deduped.has(row.item.id)) continue;
    const text = row.chunk?.text || row.version?.normalizedText || "";
    deduped.set(row.item.id, {
      itemId: row.item.id,
      versionId: row.version?.id ?? null,
      title: row.item.title,
      resourceKind: row.item.resourceKind,
      url: row.item.canonicalUrl,
      sourceUrl: String((row.item.metadata as Record<string, unknown>)?.source_url || row.item.canonicalUrl),
      summary: summarize(text, query),
      fetchedAt: row.version?.fetchedAt?.toISOString() ?? null,
      score: scoreResult(row.item.title, text, query)
    });
    if (deduped.size >= limit) break;
  }
  return [...deduped.values()].sort((a, b) => b.score - a.score);
}

export async function getKnowledgeItem(db: OperatorDatabase, itemId: string) {
  const [row] = await db
    .select({
      item: knowledgeItems,
      version: knowledgeItemVersions,
      file: fileAssets
    })
    .from(knowledgeItems)
    .leftJoin(knowledgeItemVersions, eq(knowledgeItemVersions.itemId, knowledgeItems.id))
    .leftJoin(fileAssets, eq(knowledgeItemVersions.fileAssetId, fileAssets.id))
    .where(eq(knowledgeItems.id, itemId))
    .orderBy(desc(knowledgeItemVersions.fetchedAt))
    .limit(1);
  return row ?? null;
}

export async function findKnowledgeTemplates(
  db: OperatorDatabase,
  params: { space?: string; query?: string; outputFormat?: string; limit?: number }
) {
  const pattern = params.query ? `%${params.query.replace(/[%_]/gu, "\\$&")}%` : undefined;
  return db
    .select({
      template: knowledgeTemplates,
      item: knowledgeItems,
      spaceKey: knowledgeSpaces.key
    })
    .from(knowledgeTemplates)
    .innerJoin(knowledgeItems, eq(knowledgeTemplates.itemId, knowledgeItems.id))
    .innerJoin(knowledgeSpaces, eq(knowledgeItems.spaceId, knowledgeSpaces.id))
    .where(
      and(
        eq(knowledgeTemplates.status, "active"),
        params.space ? eq(knowledgeSpaces.key, params.space) : undefined,
        params.outputFormat ? eq(knowledgeTemplates.templateKind, params.outputFormat) : undefined,
        pattern ? or(ilike(knowledgeItems.title, pattern), sql`${knowledgeTemplates.fieldsSchema}::text ilike ${pattern}`) : undefined
      )
    )
    .limit(Math.max(1, Math.min(params.limit ?? 20, 100)));
}

export async function getKnowledgeTemplate(db: OperatorDatabase, templateId: string) {
  const [row] = await db
    .select({
      template: knowledgeTemplates,
      item: knowledgeItems,
      version: knowledgeItemVersions,
      file: fileAssets,
      spaceKey: knowledgeSpaces.key
    })
    .from(knowledgeTemplates)
    .innerJoin(knowledgeItems, eq(knowledgeTemplates.itemId, knowledgeItems.id))
    .innerJoin(knowledgeSpaces, eq(knowledgeItems.spaceId, knowledgeSpaces.id))
    .leftJoin(knowledgeItemVersions, eq(knowledgeItemVersions.itemId, knowledgeItems.id))
    .leftJoin(fileAssets, eq(knowledgeItemVersions.fileAssetId, fileAssets.id))
    .where(and(eq(knowledgeTemplates.id, templateId), eq(knowledgeTemplates.status, "active")))
    .orderBy(desc(knowledgeItemVersions.fetchedAt))
    .limit(1);
  return row ?? null;
}

function summarize(text: string, query: string): string {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  const index = normalized.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, index - 120);
  const end = Math.min(normalized.length, (index >= 0 ? index : 0) + 260);
  return normalized.slice(start, end);
}

function scoreResult(title: string, text: string, query: string): number {
  const lowerQuery = query.toLowerCase();
  let score = 1;
  if (title.toLowerCase().includes(lowerQuery)) score += 10;
  if (text.toLowerCase().includes(lowerQuery)) score += 3;
  return score;
}
