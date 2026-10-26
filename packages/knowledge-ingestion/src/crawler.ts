import type { FetchedResource, KnowledgeCrawlerConfig, KnowledgeSourceRules } from "./types.js";
import {
  DEFAULT_USER_AGENT,
  filenameFromUrl,
  isDownloadUrl,
  isLikelyHtmlPage,
  normalizeUrl,
  parseJsonRecord,
  shouldCrawlUrl
} from "./utils.js";

export async function crawlKnowledgeSource(params: {
  baseUrl: string;
  rules?: KnowledgeSourceRules;
  crawlerConfig?: KnowledgeCrawlerConfig;
  runId?: string;
}): Promise<FetchedResource[]> {
  const rules = params.rules ?? {};
  const config = params.crawlerConfig ?? {};
  const resources: FetchedResource[] = [];
  const attachments = new Set<string>();
  const maxAttachments = rules.maxAttachments ?? 5000;
  const maxPages = rules.maxPages ?? config.maxRequestsPerCrawl ?? 2500;
  const userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
  const requestHandlerTimeoutSecs = clampNumber(config.requestHandlerTimeoutSecs ?? 180, 45, 600);
  const attachmentDownloadTimeoutMs = clampNumber(config.attachmentDownloadTimeoutMs ?? 120_000, 5_000, 600_000);
  const robotsAllowed = createRobotsGuard(userAgent, config.respectRobotsTxt !== false);
  if (!(await robotsAllowed(params.baseUrl))) return resources;
  const { CheerioCrawler, RequestQueue } = (await import("crawlee")) as typeof import("crawlee");
  const requestQueue = await RequestQueue.open(`operator-knowledge-${params.runId ?? Date.now()}`);
  await requestQueue.addRequest({ url: params.baseUrl, userData: { depth: 0 } });

  const crawler = new CheerioCrawler({
    requestQueue,
    maxConcurrency: Math.max(1, Math.min(config.sameHostConcurrency ?? 2, 4)),
    maxRequestsPerCrawl: maxPages,
    requestHandlerTimeoutSecs,
    navigationTimeoutSecs: 30,
    preNavigationHooks: [
      (_context, gotOptions) => {
        gotOptions.headers = {
          ...gotOptions.headers,
          "user-agent": userAgent
        };
      }
    ],
    requestHandler: async ({ request, response, body, $ }) => {
      const finalUrl = normalizeUrl(response.url || request.loadedUrl || request.url) ?? request.url;
      const contentType = String(response.headers["content-type"] ?? "text/html");
      const html = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? $.html());
      resources.push({
        url: finalUrl,
        title: titleFromPage($),
        body: Buffer.from(html),
        contentType,
        filename: filenameFromUrl(finalUrl, contentType),
        status: response.statusCode,
        headers: headersToRecord(response.headers as Record<string, string | string[] | undefined>)
      });

      const depth = typeof request.userData.depth === "number" ? request.userData.depth : 0;
      const maxDepth = config.maxDepth ?? Number.POSITIVE_INFINITY;
      const urls = extractLinks($, finalUrl);
      for (const url of urls) {
        if (!shouldCrawlUrl(url, rules)) continue;
        if (!(await robotsAllowed(url))) continue;
        if (isDownloadUrl(url)) {
          if (attachments.size >= maxAttachments || attachments.has(url)) continue;
          attachments.add(url);
          const resource = await downloadResource(url, finalUrl, rules.maxFileBytes, userAgent, attachmentDownloadTimeoutMs);
          if (resource) resources.push(resource);
          continue;
        }
        if (depth + 1 <= maxDepth && isLikelyHtmlPage(url)) {
          await requestQueue.addRequest({ url, userData: { depth: depth + 1 } }, { forefront: false });
        }
      }
    },
    failedRequestHandler: async () => undefined
  });
  await crawler.run();
  return resources;
}

export async function downloadResource(
  url: string,
  sourceUrl?: string,
  maxFileBytes?: number,
  userAgent = DEFAULT_USER_AGENT,
  timeoutMs = 120_000
): Promise<FetchedResource | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": userAgent },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (maxFileBytes && contentLength > maxFileBytes) return null;
    const body = Buffer.from(await response.arrayBuffer());
    if (maxFileBytes && body.byteLength > maxFileBytes) return null;
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const finalUrl = normalizeUrl(response.url || url) ?? url;
    return {
      url: finalUrl,
      sourceUrl,
      body,
      contentType,
      filename: filenameFromUrl(finalUrl, contentType),
      status: response.status,
      headers: Object.fromEntries(response.headers.entries())
    };
  } catch {
    return null;
  }
}

export function rulesFromRecord(value: unknown): KnowledgeSourceRules {
  const record = parseJsonRecord(value);
  return {
    allowHosts: stringArray(record.allowHosts),
    denyPatterns: stringArray(record.denyPatterns),
    includePatterns: stringArray(record.includePatterns),
    maxPages: numberValue(record.maxPages),
    maxAttachments: numberValue(record.maxAttachments),
    maxFileBytes: numberValue(record.maxFileBytes)
  };
}

export function crawlerConfigFromRecord(value: unknown): KnowledgeCrawlerConfig {
  const record = parseJsonRecord(value);
  return {
    sameHostConcurrency: numberValue(record.sameHostConcurrency),
    maxRequestsPerCrawl: numberValue(record.maxRequestsPerCrawl),
    maxDepth: numberValue(record.maxDepth),
    requestHandlerTimeoutSecs: numberValue(record.requestHandlerTimeoutSecs),
    attachmentDownloadTimeoutMs: numberValue(record.attachmentDownloadTimeoutMs),
    userAgent: typeof record.userAgent === "string" ? record.userAgent : undefined,
    renderFallback: record.renderFallback === "playwright" ? "playwright" : "none",
    respectRobotsTxt: record.respectRobotsTxt !== false
  };
}

function extractLinks($: AnyCheerioApi, baseUrl: string): string[] {
  const urls = new Set<string>();
  $("a[href],link[href]").each((_index, element) => {
    const href = $(element).attr("href");
    const url = href ? normalizeUrl(href, baseUrl) : null;
    if (url) urls.add(url);
  });
  return [...urls];
}

function titleFromPage($: AnyCheerioApi): string | undefined {
  return $("title").first().text().trim() || $("h1").first().text().trim() || undefined;
}

function headersToRecord(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) output[key] = value.join(", ");
    else if (value) output[key] = value;
  }
  return output;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

type AnyCheerioApi = {
  (
    selector: string
  ): {
    first(): { text(): string };
    each(callback: (index: number, element: unknown) => void): void;
    attr(name: string): string | undefined;
    text(): string;
  };
  (
    element: unknown
  ): {
    attr(name: string): string | undefined;
  };
  html(): string;
};

type RobotsRule = {
  allow: boolean;
  path: string;
};

type RobotsGroup = {
  agents: string[];
  rules: RobotsRule[];
};

function createRobotsGuard(userAgent: string, enabled: boolean): (url: string) => Promise<boolean> {
  if (!enabled) return async () => true;
  const cache = new Map<string, Promise<RobotsGroup[]>>();
  return async (url: string) => {
    const parsed = new URL(url);
    const origin = parsed.origin;
    let groups = cache.get(origin);
    if (!groups) {
      groups = fetchRobotsGroups(origin, userAgent);
      cache.set(origin, groups);
    }
    return isRobotsPathAllowed(await groups, userAgent, `${parsed.pathname}${parsed.search}`);
  };
}

async function fetchRobotsGroups(origin: string, userAgent: string): Promise<RobotsGroup[]> {
  try {
    const response = await fetch(new URL("/robots.txt", origin), {
      headers: { "user-agent": userAgent },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return [];
    return parseRobotsTxt(await response.text());
  } catch {
    return [];
  }
}

function parseRobotsTxt(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (agents.length && rules.length) {
        groups.push({ agents, rules });
        agents = [];
        rules = [];
      }
      agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && agents.length) {
      rules.push({ allow: key === "allow", path: value });
    }
  }
  if (agents.length) groups.push({ agents, rules });
  return groups;
}

function isRobotsPathAllowed(groups: RobotsGroup[], userAgent: string, path: string): boolean {
  const matched = groups.filter((group) => group.agents.some((agent) => robotsAgentMatches(agent, userAgent)));
  if (!matched.length) return true;
  const rules = matched.flatMap((group) => group.rules).filter((rule) => rule.path && robotsPatternMatches(rule.path, path));
  if (!rules.length) return true;
  rules.sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return rules[0]?.allow ?? true;
}

function robotsAgentMatches(agent: string, userAgent: string): boolean {
  if (agent === "*") return true;
  const token = userAgent.toLowerCase().split(/[/\s]/u)[0] ?? userAgent.toLowerCase();
  return token.includes(agent) || userAgent.toLowerCase().includes(agent);
}

function robotsPatternMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`, "u").test(path);
}
