import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { load } from "cheerio";
import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";
import { resolveWorkspace, sha256File, workspacePath } from "@operator/core";

const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string().optional(),
  source: z.string()
});

const webSearchOutputSchema = z.object({
  query: z.string(),
  provider: z.string(),
  results: z.array(searchResultSchema)
});

const webFetchOutputSchema = z.object({
  url: z.string(),
  finalUrl: z.string(),
  status: z.number(),
  contentType: z.string(),
  title: z.string().optional(),
  text: z.string(),
  truncated: z.boolean()
});

const webDownloadOutputSchema = z.object({
  url: z.string(),
  finalUrl: z.string(),
  workspace: z.string(),
  path: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  sha256: z.string()
});

export const webSearchTool = createTool({
  id: "operator.web.search",
  description:
    "Search the public web for current information. Use this before answering questions involving latest/current facts, exams, news, prices, laws, product specs, or download locations.",
  inputSchema: z.object({
    query: z.string().min(1),
    maxResults: z.number().int().positive().max(20).optional()
  }),
  outputSchema: webSearchOutputSchema,
  execute: async ({ query, maxResults = 8 }) => {
    const providers = [searchBrave, searchTavily, searchSerper, searchBingApi, searchDuckDuckGo, searchBing];
    const errors: string[] = [];
    for (const provider of providers) {
      try {
        const results = await provider(query, maxResults);
        if (results.length > 0) {
          return {
            query,
            provider: provider.name,
            results
          };
        }
      } catch (error) {
        errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      query,
      provider: `none${errors.length ? ` (${errors.join("; ")})` : ""}`,
      results: []
    };
  }
});

export const webFetchTool = createTool({
  id: "operator.web.fetch_url",
  description:
    "Fetch a URL and return readable text. Use it to inspect search results, verify source pages, or read small HTML/text documents.",
  inputSchema: z.object({
    url: z.string().url(),
    maxChars: z.number().int().positive().max(60_000).optional()
  }),
  outputSchema: webFetchOutputSchema,
  execute: async ({ url, maxChars = 12_000 }) => {
    const response = await fetchBytesWithFallback(url);
    const contentType = response.contentType;
    const text = response.bytes.toString("utf8");
    const readable = contentType.includes("html") ? htmlToText(text) : text;
    return {
      url,
      finalUrl: response.finalUrl || url,
      status: response.status,
      contentType,
      title: contentType.includes("html") ? htmlTitle(text) : undefined,
      text: readable.slice(0, maxChars),
      truncated: readable.length > maxChars
    };
  }
});

export const webDownloadTool = createTool({
  id: "operator.web.download_file",
  description:
    "Download a URL to the Operator task workspace and return file path, size, MIME type, and sha256. Use this for PDFs, images, archives, Office documents, datasets, and other downloadable artifacts.",
  inputSchema: z.object({
    url: z.string().url(),
    workspace: z.string().optional(),
    path: z.string().optional(),
    filename: z.string().optional(),
    overwrite: z.boolean().optional()
  }),
  outputSchema: webDownloadOutputSchema,
  execute: async ({ url, workspace, path: outputPath, filename, overwrite = true }) => {
    const targetWorkspace = resolveWorkspace(workspace?.trim() || "tmp/runs/web-downloads", "web-downloads");
    const response = await fetchBytesWithFallback(url);
    if (response.status >= 400) {
      throw new Error(`Download failed with HTTP ${response.status}: ${response.statusText}`);
    }
    const bytes = response.bytes;
    const mimeType = response.contentType.split(";")[0]?.trim() || "application/octet-stream";
    const relativePath = resolveDownloadOutputPath({ outputPath, filename, response, url, mimeType });
    const absolutePath = workspacePath(targetWorkspace, relativePath);
    if (!overwrite && existsAtPath(absolutePath)) {
      throw new Error(`Refusing to overwrite existing file: ${relativePath}`);
    }
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, bytes);
    return {
      url,
      finalUrl: response.url || url,
      workspace: targetWorkspace,
      path: relativePath,
      mimeType,
      sizeBytes: bytes.length,
      sha256: sha256File(absolutePath)
    };
  }
});

export const operatorWebTools = {
  webSearchTool,
  webFetchTool,
  webDownloadTool
} as const;

type SearchResult = z.infer<typeof searchResultSchema>;

type HttpBytesResponse = {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  contentType: string;
  contentDisposition?: string;
  bytes: Buffer;
};

async function searchBrave(query: string, maxResults: number): Promise<SearchResult[]> {
  const token = process.env.OPERATOR_BRAVE_SEARCH_API_KEY || process.env.BRAVE_SEARCH_API_KEY;
  if (!token) return [];
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(maxResults, 20)}`;
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/json",
      "x-subscription-token": token
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as unknown;
  const results = arrayAt(data, ["web", "results"]);
  return dedupeResults(
    results.map((item) => ({
      title: stringAt(item, ["title"]),
      url: stringAt(item, ["url"]),
      snippet: stringAt(item, ["description"]) || undefined,
      source: "brave"
    }))
  )
    .filter((result) => result.title && result.url)
    .slice(0, maxResults);
}

async function searchTavily(query: string, maxResults: number): Promise<SearchResult[]> {
  const token = process.env.OPERATOR_TAVILY_API_KEY || process.env.TAVILY_API_KEY;
  if (!token) return [];
  const response = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      api_key: token,
      query,
      max_results: Math.min(maxResults, 20),
      search_depth: "basic"
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as unknown;
  return dedupeResults(
    arrayAt(data, ["results"]).map((item) => ({
      title: stringAt(item, ["title"]),
      url: stringAt(item, ["url"]),
      snippet: stringAt(item, ["content"]) || undefined,
      source: "tavily"
    }))
  )
    .filter((result) => result.title && result.url)
    .slice(0, maxResults);
}

async function searchSerper(query: string, maxResults: number): Promise<SearchResult[]> {
  const token = process.env.OPERATOR_SERPER_API_KEY || process.env.SERPER_API_KEY;
  if (!token) return [];
  const response = await fetchWithTimeout("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": token
    },
    body: JSON.stringify({
      q: query,
      num: Math.min(maxResults, 20)
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as unknown;
  return dedupeResults(
    arrayAt(data, ["organic"]).map((item) => ({
      title: stringAt(item, ["title"]),
      url: stringAt(item, ["link"]),
      snippet: stringAt(item, ["snippet"]) || undefined,
      source: "serper"
    }))
  )
    .filter((result) => result.title && result.url)
    .slice(0, maxResults);
}

async function searchBingApi(query: string, maxResults: number): Promise<SearchResult[]> {
  const token = process.env.OPERATOR_BING_SEARCH_API_KEY || process.env.BING_SEARCH_API_KEY;
  if (!token) return [];
  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${Math.min(maxResults, 20)}`;
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/json",
      "ocp-apim-subscription-key": token
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as unknown;
  return dedupeResults(
    arrayAt(data, ["webPages", "value"]).map((item) => ({
      title: stringAt(item, ["name"]),
      url: stringAt(item, ["url"]),
      snippet: stringAt(item, ["snippet"]) || undefined,
      source: "bing-api"
    }))
  )
    .filter((result) => result.title && result.url)
    .slice(0, maxResults);
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(url);
  const html = await response.text();
  const $ = load(html);
  const results: SearchResult[] = [];
  $(".result").each((_, element) => {
    if (results.length >= maxResults) return false;
    const anchor = $(element).find(".result__a").first();
    const title = anchor.text().replace(/\s+/gu, " ").trim();
    const href = decodeDuckDuckGoUrl(anchor.attr("href") ?? "");
    if (!title || !href) return;
    results.push({
      title,
      url: href,
      snippet: $(element).find(".result__snippet").text().replace(/\s+/gu, " ").trim() || undefined,
      source: "duckduckgo"
    });
  });
  return dedupeResults(results).slice(0, maxResults);
}

async function searchBing(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(url);
  const html = await response.text();
  const $ = load(html);
  const results: SearchResult[] = [];
  $("li.b_algo").each((_, element) => {
    if (results.length >= maxResults) return false;
    const anchor = $(element).find("h2 a").first();
    const title = anchor.text().replace(/\s+/gu, " ").trim();
    const href = anchor.attr("href") ?? "";
    if (!title || !/^https?:\/\//iu.test(href)) return;
    results.push({
      title,
      url: href,
      snippet: $(element).find("p").first().text().replace(/\s+/gu, " ").trim() || undefined,
      source: "bing"
    });
  });
  return dedupeResults(results).slice(0, maxResults);
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OPERATOR_WEB_FETCH_TIMEOUT_SECONDS ?? 30) * 1000);
  try {
    return await fetch(url, {
      ...init,
      redirect: "follow",
      headers: {
        "user-agent":
          process.env.OPERATOR_WEB_USER_AGENT || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) OperatorAgent/0.2",
        ...(init?.headers ?? {})
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBytesWithFallback(url: string): Promise<HttpBytesResponse> {
  try {
    const response = await fetchWithTimeout(url);
    return {
      url,
      finalUrl: response.url || url,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      contentDisposition: response.headers.get("content-disposition") ?? undefined,
      bytes: Buffer.from(await response.arrayBuffer())
    };
  } catch (error) {
    return curlFetchBytes(url, error);
  }
}

async function curlFetchBytes(url: string, originalError: unknown): Promise<HttpBytesResponse> {
  const timeoutSeconds = Number(process.env.OPERATOR_WEB_FETCH_TIMEOUT_SECONDS ?? 30);
  const maxBuffer = Number(process.env.OPERATOR_WEB_DOWNLOAD_MAX_BYTES ?? 100 * 1024 * 1024);
  const marker = `\n__OPERATOR_CURL_META_${createHash("sha256").update(`${url}:${Date.now()}`).digest("hex").slice(0, 12)}__`;
  const stdout = await execFileBuffer(
    "curl",
    [
      "-L",
      "--silent",
      "--show-error",
      "--max-time",
      String(timeoutSeconds),
      "--connect-timeout",
      String(Math.min(10, timeoutSeconds)),
      "-A",
      process.env.OPERATOR_WEB_USER_AGENT || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) OperatorAgent/0.2",
      "-w",
      `${marker}%{json}`,
      url
    ],
    maxBuffer
  );
  const markerBuffer = Buffer.from(marker);
  const markerIndex = stdout.lastIndexOf(markerBuffer);
  if (markerIndex < 0) {
    throw new Error(`fetch failed and curl metadata was missing: ${errorMessage(originalError)}`);
  }
  const body = stdout.subarray(0, markerIndex);
  const metaText = stdout
    .subarray(markerIndex + markerBuffer.length)
    .toString("utf8")
    .trim();
  const meta = JSON.parse(metaText) as Record<string, unknown>;
  return {
    url,
    finalUrl: typeof meta.url_effective === "string" ? meta.url_effective : url,
    status: typeof meta.http_code === "number" ? meta.http_code : Number(meta.http_code ?? 0),
    statusText: "",
    contentType: typeof meta.content_type === "string" ? meta.content_type : "application/octet-stream",
    bytes: body
  };
}

function execFileBuffer(command: string, args: string[], maxBuffer: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "buffer", maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        const detail = Buffer.isBuffer(stderr) ? stderr.toString("utf8").trim() : String(stderr || "").trim();
        reject(new Error(detail || error.message));
        return;
      }
      resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
    });
  });
}

function htmlTitle(html: string): string | undefined {
  const title = load(html)("title").first().text().replace(/\s+/gu, " ").trim();
  return title || undefined;
}

function htmlToText(html: string): string {
  const $ = load(html);
  $("script, style, noscript, svg").remove();
  return $("body").text().replace(/\s+/gu, " ").trim();
}

function decodeDuckDuckGoUrl(href: string): string {
  if (!href) return "";
  try {
    const url = href.startsWith("//") ? `https:${href}` : new URL(href, "https://duckduckgo.com").toString();
    const parsed = new URL(url);
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url;
  } catch {
    return href;
  }
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = normalizeResultUrl(result.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeResultUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function filenameFromResponse(response: HttpBytesResponse, url: string, mimeType: string): string {
  const header = response.contentDisposition;
  const headerName = header?.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/iu);
  const fromHeader = headerName?.[1] ? decodeURIComponent(headerName[1]) : headerName?.[2];
  if (fromHeader) return sanitizeFilename(fromHeader);
  const fromUrl = decodeURIComponent(new URL(response.url || url).pathname.split("/").filter(Boolean).at(-1) ?? "");
  if (fromUrl) return sanitizeFilename(fromUrl);
  return `download-${createHash("sha256").update(url).digest("hex").slice(0, 10)}${extensionForMime(mimeType)}`;
}

function resolveDownloadOutputPath(params: {
  outputPath?: string;
  filename?: string;
  response: HttpBytesResponse;
  url: string;
  mimeType: string;
}): string {
  const inferredFilename = sanitizeFilename(params.filename || filenameFromResponse(params.response, params.url, params.mimeType));
  if (!params.outputPath?.trim()) {
    return normalizeOutputPath(path.posix.join("downloads", inferredFilename));
  }
  const normalized = normalizeOutputPath(params.outputPath.trim());
  const basename = path.posix.basename(normalized);
  const looksLikeDirectory = normalized.endsWith("/") || !path.posix.extname(basename);
  return looksLikeDirectory ? normalizeOutputPath(path.posix.join(normalized, inferredFilename)) : normalized;
}

function sanitizeFilename(value: string): string {
  const sanitized = [...value]
    .map((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      return codePoint < 0x20 || '\\/:*?"<>|'.includes(char) ? "_" : char;
    })
    .join("");
  return sanitized.slice(0, 180) || "download.bin";
}

function extensionForMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === "application/pdf") return ".pdf";
  if (normalized.includes("wordprocessingml")) return ".docx";
  if (normalized.includes("spreadsheetml")) return ".xlsx";
  if (normalized.includes("presentationml")) return ".pptx";
  if (normalized.startsWith("image/")) return `.${normalized.slice("image/".length).replace("jpeg", "jpg")}`;
  if (normalized.includes("json")) return ".json";
  if (normalized.startsWith("text/")) return ".txt";
  return ".bin";
}

function normalizeOutputPath(value: string): string {
  const normalized = path.normalize(value).replaceAll(path.sep, "/");
  if (path.isAbsolute(normalized) || normalized.startsWith("../") || normalized === "..") {
    throw new Error(`Download path must be relative to the workspace: ${value}`);
  }
  return normalized;
}

function existsAtPath(filePath: string): boolean {
  try {
    return Boolean(sha256File(filePath));
  } catch {
    return false;
  }
}

function arrayAt(value: unknown, pathSegments: string[]): Record<string, unknown>[] {
  const valueAtPath = getAtPath(value, pathSegments);
  return Array.isArray(valueAtPath) ? valueAtPath.filter(isRecord) : [];
}

function stringAt(value: unknown, pathSegments: string[]): string {
  const valueAtPath = getAtPath(value, pathSegments);
  return typeof valueAtPath === "string" ? valueAtPath.trim() : "";
}

function getAtPath(value: unknown, pathSegments: string[]): unknown {
  let current = value;
  for (const segment of pathSegments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
