import type { OperatorDatabase } from "@operator/db";
import type { ObjectStorageAdapter } from "@operator/storage";

export type KnowledgeVisibility = "public" | "organization" | "private";
export type KnowledgeRunType = "manual" | "scheduled" | "full_rescan";
export type KnowledgeResourceKind = "news" | "notice" | "policy" | "document" | "template" | "form" | "download" | "archive" | "page" | "faq";

export type KnowledgeSourceRules = {
  allowHosts?: string[];
  denyPatterns?: string[];
  includePatterns?: string[];
  maxPages?: number;
  maxAttachments?: number;
  maxFileBytes?: number;
};

export type KnowledgeCrawlerConfig = {
  sameHostConcurrency?: number;
  maxRequestsPerCrawl?: number;
  maxDepth?: number;
  requestHandlerTimeoutSecs?: number;
  attachmentDownloadTimeoutMs?: number;
  userAgent?: string;
  renderFallback?: "none" | "playwright";
  respectRobotsTxt?: boolean;
};

export type KnowledgeIngestionOptions = {
  db: OperatorDatabase;
  storage: ObjectStorageAdapter;
  bucket: string;
  sourceId: string;
  runType?: KnowledgeRunType;
  trigger?: string;
  createdBy?: string | null;
  now?: () => Date;
  tikaUrl?: string;
  archiveTempDir?: string;
};

export type KnowledgeRunStats = {
  discovered_urls: number;
  fetched_items: number;
  unchanged_items: number;
  new_items: number;
  updated_items: number;
  failed_items: number;
  stored_bytes: number;
  parse_failures_by_type: Record<string, number>;
  archive_members_found: number;
  deduped_file_assets: number;
  scheduled_runs: number;
};

export type FetchedResource = {
  url: string;
  sourceUrl?: string;
  title?: string;
  body: Buffer;
  contentType: string;
  filename?: string;
  status?: number;
  headers?: Record<string, string>;
};

export type ParsedResource = {
  title?: string;
  text: string;
  normalizedText: string;
  metadata: Record<string, unknown>;
  parseStatus: "parsed" | "skipped" | "failed";
};

export type StoredFileAsset = {
  id: string;
  sha256: string;
  sizeBytes: number;
  deduped: boolean;
};

export type KnowledgeSearchResult = {
  itemId: string;
  versionId: string | null;
  title: string;
  resourceKind: string;
  url: string;
  summary: string;
  sourceUrl: string;
  fetchedAt: string | null;
  score: number;
};
