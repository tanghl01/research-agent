import { extensionOfUrl, htmlTitle, htmlToReadableText, normalizeText, sha256Buffer } from "./utils.js";
import type { FetchedResource, ParsedResource } from "./types.js";

export const PARSER_VERSION = "operator-knowledge/0.1.0";

const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".md", ".json", ".xml", ".log"]);

export async function parseResource(resource: FetchedResource, options: { tikaUrl?: string } = {}): Promise<ParsedResource> {
  const contentType = resource.contentType.toLowerCase();
  const ext = extensionOfUrl(resource.filename || resource.url);
  if (contentType.includes("html") || ext === ".html" || ext === ".htm" || ext === ".shtml") {
    const html = resource.body.toString("utf8");
    const text = htmlToReadableText(html);
    return parsed({
      title: resource.title ?? htmlTitle(html),
      text,
      metadata: { parser: "cheerio", content_type: resource.contentType }
    });
  }

  if (contentType.startsWith("text/") || TEXT_EXTENSIONS.has(ext)) {
    return parsed({
      text: resource.body.toString("utf8"),
      metadata: { parser: "text", content_type: resource.contentType }
    });
  }

  const tika = await parseWithTika(resource, options.tikaUrl).catch((error) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error)
  }));
  if (tika.ok) {
    return parsed({
      text: tika.text,
      metadata: { parser: "tika", content_type: resource.contentType }
    });
  }

  return {
    text: "",
    normalizedText: "",
    metadata: {
      parser: "none",
      content_type: resource.contentType,
      parse_error: tika.error,
      raw_sha256: sha256Buffer(resource.body)
    },
    parseStatus: "failed"
  };
}

async function parseWithTika(resource: FetchedResource, tikaUrl?: string): Promise<{ ok: true; text: string }> {
  const endpoint = tikaUrl?.trim() || process.env.OPERATOR_TIKA_URL?.trim();
  if (!endpoint) throw new Error("Tika endpoint is not configured.");
  const response = await fetch(new URL("/tika", endpoint.endsWith("/") ? endpoint : `${endpoint}/`), {
    method: "PUT",
    headers: {
      "content-type": resource.contentType || "application/octet-stream",
      accept: "text/plain"
    },
    body: resource.body as unknown as BodyInit
  });
  if (!response.ok) throw new Error(`Tika returned HTTP ${response.status}`);
  return { ok: true, text: await response.text() };
}

function parsed(params: { title?: string; text: string; metadata: Record<string, unknown> }): ParsedResource {
  const normalizedText = normalizeText(params.text);
  return {
    title: params.title,
    text: params.text,
    normalizedText,
    metadata: {
      ...params.metadata,
      normalized_sha256: normalizedText ? sha256Buffer(normalizedText) : null
    },
    parseStatus: normalizedText ? "parsed" : "skipped"
  };
}
