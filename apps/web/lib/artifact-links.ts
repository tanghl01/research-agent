import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ArtifactHrefOptions = {
  download?: boolean;
  source?: string;
};

export function artifactHref(workspace: string, artifactPath: string, options: boolean | ArtifactHrefOptions = false): string {
  const download = typeof options === "boolean" ? options : options.download === true;
  const source = typeof options === "boolean" ? undefined : options.source;
  const params = new URLSearchParams({
    workspace,
    path: artifactPath
  });
  if (download) params.set("download", "1");
  if (source) params.set("source", source);
  return `/api/operator/artifact?${params.toString()}`;
}

export function rewriteWorkspaceArtifactLinks(
  text: string | undefined,
  workspace: string,
  options: Pick<ArtifactHrefOptions, "source"> = {}
): string | undefined {
  if (!text) return text;
  return rewriteHtmlHrefs(rewriteMarkdownLinks(text, workspace, options), workspace, options);
}

function rewriteMarkdownLinks(text: string, workspace: string, options: Pick<ArtifactHrefOptions, "source">): string {
  return text.replace(/\]\(([^)\n]+)\)/gu, (match, href: string) => {
    const rewritten = workspaceArtifactHref(workspace, href, options);
    return rewritten ? `](${rewritten})` : match;
  });
}

function rewriteHtmlHrefs(text: string, workspace: string, options: Pick<ArtifactHrefOptions, "source">): string {
  return text.replace(/\bhref=(["'])(.*?)\1/gu, (match, quote: string, href: string) => {
    const rewritten = workspaceArtifactHref(workspace, href, options);
    return rewritten ? `href=${quote}${rewritten}${quote}` : match;
  });
}

function workspaceArtifactHref(workspace: string, href: string, options: Pick<ArtifactHrefOptions, "source">): string | undefined {
  const targetPath = localFilePathFromHref(href.trim(), workspace);
  if (!targetPath) return undefined;

  const absoluteWorkspace = path.resolve(workspace);
  const absoluteTarget = path.resolve(targetPath);
  const relativePath = path.relative(absoluteWorkspace, absoluteTarget);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return undefined;
  if (!existsSync(absoluteTarget) || !statSync(absoluteTarget).isFile()) return undefined;

  return artifactHref(absoluteWorkspace, relativePath.split(path.sep).join("/"), options);
}

function localFilePathFromHref(href: string, workspace: string): string | undefined {
  if (!href || href.startsWith("#") || href.startsWith("//") || href.startsWith("/api/operator/artifact")) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(href) && !href.startsWith("file://")) return undefined;

  if (href.startsWith("file://")) {
    try {
      return fileURLToPath(href);
    } catch {
      return undefined;
    }
  }

  const [pathname] = href.split(/[?#]/u, 1);
  if (!pathname) return undefined;

  try {
    const decodedPath = decodeURIComponent(pathname);
    return path.isAbsolute(decodedPath) ? decodedPath : path.resolve(workspace, decodedPath);
  } catch {
    return path.isAbsolute(pathname) ? pathname : path.resolve(workspace, pathname);
  }
}
