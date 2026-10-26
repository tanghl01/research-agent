import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { load } from "cheerio";
import type { KnowledgeResourceKind, KnowledgeRunStats, KnowledgeSourceRules } from "./types.js";

export const DEFAULT_USER_AGENT = "OperatorKnowledgeCrawler/0.1 (+https://www.suanziai.com)";

const ARCHIVE_EXTENSIONS = new Set([".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz"]);
const OFFICE_EXTENSIONS = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".wps", ".et", ".dps"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".txt", ".csv", ".rtf", ".ofd", ...OFFICE_EXTENSIONS]);
const SITE_ASSET_EXTENSIONS = new Set([".css", ".js", ".gif", ".jpg", ".jpeg", ".png", ".webp", ".svg", ".ico", ".woff", ".woff2", ".ttf"]);

export function emptyRunStats(): KnowledgeRunStats {
  return {
    discovered_urls: 0,
    fetched_items: 0,
    unchanged_items: 0,
    new_items: 0,
    updated_items: 0,
    failed_items: 0,
    stored_bytes: 0,
    parse_failures_by_type: {},
    archive_members_found: 0,
    deduped_file_assets: 0,
    scheduled_runs: 0
  };
}

export function sha256Buffer(buffer: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function normalizeUrl(input: string, baseUrl?: string): string | null {
  if (!input.trim() || /^(javascript|mailto|tel):/iu.test(input.trim())) return null;
  try {
    const parsed = new URL(input, baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/{2,}/gu, "/") || "/";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function hostAllowed(url: string, allowHosts: readonly string[] = []): boolean {
  if (!allowHosts.length) return true;
  const hostname = new URL(url).hostname.toLowerCase();
  return allowHosts.some((host) => {
    const normalized = host.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.startsWith("*.")) return hostname === normalized.slice(2) || hostname.endsWith(normalized.slice(1));
    return hostname === normalized;
  });
}

export function deniedByPattern(url: string, patterns: readonly string[] = []): boolean {
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, "iu").test(url);
    } catch {
      return url.includes(pattern);
    }
  });
}

export function shouldCrawlUrl(url: string, rules: KnowledgeSourceRules): boolean {
  return hostAllowed(url, rules.allowHosts) && !deniedByPattern(url, rules.denyPatterns);
}

export function extensionOfUrl(urlOrPath: string): string {
  const pathname = urlOrPath.includes("://") ? new URL(urlOrPath).pathname : urlOrPath;
  return path.extname(decodeURIComponent(pathname)).toLowerCase();
}

export function isArchiveUrl(urlOrPath: string): boolean {
  return ARCHIVE_EXTENSIONS.has(extensionOfUrl(urlOrPath));
}

export function isHtmlResource(urlOrPath: string, contentType = ""): boolean {
  const ext = extensionOfUrl(urlOrPath);
  const normalizedContentType = contentType.toLowerCase();
  return normalizedContentType.includes("html") || [".html", ".htm", ".shtml"].includes(ext);
}

export function isDownloadUrl(url: string): boolean {
  const ext = extensionOfUrl(url);
  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase();
  const downloadHint = `${pathname}${parsed.search}`.toLowerCase();
  if (pathname.includes("/_upload/article/files/")) return true;
  if (pathname.includes("/_redirect") && parsed.searchParams.has("articleId")) return true;
  if (ARCHIVE_EXTENSIONS.has(ext) || DOCUMENT_EXTENSIONS.has(ext)) return true;
  return /(download|attach|file)/iu.test(downloadHint) && !SITE_ASSET_EXTENSIONS.has(ext);
}

export function isLikelyHtmlPage(url: string): boolean {
  const ext = extensionOfUrl(url);
  if (!ext) return true;
  if (SITE_ASSET_EXTENSIONS.has(ext) || DOCUMENT_EXTENSIONS.has(ext) || ARCHIVE_EXTENSIONS.has(ext)) return false;
  return [".htm", ".html", ".shtml", ".jsp", ".php", ".asp", ".aspx"].includes(ext);
}

export function classifyResource(url: string, contentType: string, title?: string): KnowledgeResourceKind {
  const ext = extensionOfUrl(url);
  const text = `${url} ${title ?? ""}`.toLowerCase();
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (/\bnotice\b|通知|公告/u.test(text)) return "notice";
  if (/新闻|news/u.test(text)) return "news";
  if (/政策|policy|办法|规定/u.test(text)) return "policy";
  if (/模板|表格|申请表|登记表|form/u.test(text))
    return ext === ".docx" || ext === ".xlsx" || ext === ".doc" || ext === ".xls" ? "template" : "form";
  if (contentType.includes("html")) return "page";
  return "document";
}

export function filenameFromUrl(url: string, contentType = "application/octet-stream"): string {
  const decoded = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  const safe = decoded.replace(/[^\w.\-\u4e00-\u9fa5]+/gu, "_").replace(/^_+|_+$/gu, "");
  if (safe) return safe.slice(0, 180);
  const ext = contentType.includes("html") ? ".html" : "";
  return `${randomUUID()}${ext}`;
}

export function htmlTitle(html: string): string | undefined {
  const $ = load(html);
  return $("title").first().text().trim() || $("h1").first().text().trim() || undefined;
}

export function htmlToReadableText(html: string): string {
  const $ = load(html);
  $("script,style,noscript,svg,iframe,nav,footer").remove();
  return normalizeText($("body").text() || $.root().text());
}

export function normalizeText(text: string): string {
  return text
    .split(String.fromCharCode(0))
    .join("")
    .replace(/\r/gu, "\n")
    .replace(/[ \t\f\v]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function chunkText(text: string, maxChars = 3200): Array<{ ordinal: number; text: string }> {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const chunks: Array<{ ordinal: number; text: string }> = [];
  let offset = 0;
  while (offset < normalized.length) {
    const end = Math.min(normalized.length, offset + maxChars);
    const slice = normalized.slice(offset, end).trim();
    if (slice) chunks.push({ ordinal: chunks.length, text: slice });
    offset = end;
  }
  return chunks;
}

export function parseJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function incrementFailure(stats: KnowledgeRunStats, key: string): void {
  stats.parse_failures_by_type[key] = (stats.parse_failures_by_type[key] ?? 0) + 1;
}
