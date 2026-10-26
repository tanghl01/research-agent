import { extensionOf, mimeTypeFromFilename } from "./file-metadata";

export { extensionOf, mimeTypeFromFilename };

export function operatorBaseUrl(): string {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

export function relativeUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function artifactInlineHref(href: string): string {
  return withArtifactDownloadParam(href, false);
}

export function artifactDownloadHref(href: string): string {
  return withArtifactDownloadParam(href, true);
}

export function withArtifactDownloadParam(href: string, download: boolean): string {
  try {
    const url = new URL(href, operatorBaseUrl());
    if (download) {
      url.searchParams.set("download", "1");
    } else {
      url.searchParams.delete("download");
    }
    return relativeUrl(url);
  } catch {
    if (download) return href.includes("download=1") ? href : `${href}${href.includes("?") ? "&" : "?"}download=1`;
    return href.replace(/[?&]download=1\b/u, (match) => (match.startsWith("?") ? "?" : ""));
  }
}

export function isArtifactDownloadHref(href: string): boolean {
  try {
    return new URL(href, operatorBaseUrl()).searchParams.get("download") === "1";
  } catch {
    return href.includes("download=1");
  }
}

export function artifactPathFromHref(href: string): string | undefined {
  try {
    return new URL(href, operatorBaseUrl()).searchParams.get("path") ?? undefined;
  } catch {
    return undefined;
  }
}

export function artifactFilenameFromHref(href: string): string {
  const artifactPath = artifactPathFromHref(href);
  if (artifactPath) return artifactPath.split(/[\\/]/u).at(-1) || "artifact";
  try {
    const url = new URL(href, operatorBaseUrl());
    return decodeURIComponent(url.pathname.split("/").at(-1) || "artifact");
  } catch {
    return "artifact";
  }
}

export function artifactFilename(href: string, label: string): string {
  const cleanLabel = cleanArtifactLabel(label);
  if (extensionOf(cleanLabel)) return cleanLabel;
  try {
    const url = new URL(href, operatorBaseUrl());
    const artifactPath = url.searchParams.get("path");
    const pathName = artifactPath ?? decodeURIComponent(url.pathname);
    const filename = cleanArtifactLabel(pathName.split(/[\\/]/u).at(-1) ?? cleanLabel);
    return filename === "download" ? cleanLabel : filename;
  } catch {
    return cleanLabel;
  }
}

export function artifactIdFromHref(href: string): string | undefined {
  const match = /\/api\/operator\/artifacts\/([0-9a-f-]+)\/download/iu.exec(href);
  return match?.[1];
}

function cleanArtifactLabel(value: string): string {
  const cleaned = value
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^(?:预览|下载|打开)\s+/u, "");
  return cleaned && cleaned !== "目标产物下载：" && cleaned !== "目标产物：" ? cleaned : "artifact";
}
