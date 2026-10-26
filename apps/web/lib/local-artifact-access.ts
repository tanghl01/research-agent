import { existsSync, realpathSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot, workspacePath } from "@operator/core";

export class LegacyArtifactAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "LegacyArtifactAccessError";
  }
}

export function resolveLegacyArtifactFile(params: {
  workspace: string | null;
  artifactPath: string | null;
  root?: string;
  allowedRoots?: string[];
}): string {
  if (!params.workspace || !params.artifactPath) {
    throw new LegacyArtifactAccessError("workspace and path are required", 400, "LEGACY_ARTIFACT_INPUT_REQUIRED");
  }

  const root = path.resolve(params.root ?? repoRoot());
  const allowedRoots = (params.allowedRoots ?? defaultLegacyArtifactWorkspaceRoots(root)).map((entry) => path.resolve(entry));
  const requestedWorkspace = path.resolve(params.workspace);

  if (!isWithinAnyRoot(requestedWorkspace, allowedRoots)) {
    throw new LegacyArtifactAccessError(
      "legacy artifact workspace is outside allowed Operator run workspaces",
      403,
      "LEGACY_ARTIFACT_WORKSPACE_DENIED"
    );
  }

  if (!existsSync(requestedWorkspace) || !statSync(requestedWorkspace).isDirectory()) {
    throw new LegacyArtifactAccessError("artifact not found", 404, "LEGACY_ARTIFACT_NOT_FOUND");
  }

  const realAllowedRoots = allowedRoots.map((entry) => realOrResolved(entry));
  const realWorkspace = realpathSync(requestedWorkspace);
  if (!isWithinAnyRoot(realWorkspace, realAllowedRoots)) {
    throw new LegacyArtifactAccessError(
      "legacy artifact workspace resolves outside allowed Operator run workspaces",
      403,
      "LEGACY_ARTIFACT_WORKSPACE_DENIED"
    );
  }

  let filePath: string;
  try {
    filePath = workspacePath(requestedWorkspace, params.artifactPath);
  } catch (error) {
    throw new LegacyArtifactAccessError(error instanceof Error ? error.message : String(error), 400, "LEGACY_ARTIFACT_PATH_INVALID");
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new LegacyArtifactAccessError("artifact not found", 404, "LEGACY_ARTIFACT_NOT_FOUND");
  }

  const realFile = realpathSync(filePath);
  if (!isWithinRoot(realFile, realWorkspace)) {
    throw new LegacyArtifactAccessError(
      "legacy artifact path resolves outside the requested workspace",
      403,
      "LEGACY_ARTIFACT_PATH_DENIED"
    );
  }

  return filePath;
}

export async function writeLegacyArtifactFile(params: {
  workspace: string | null;
  artifactPath: string | null;
  content?: unknown;
  contentBase64?: unknown;
}): Promise<{ filePath: string; sizeBytes: number }> {
  const filePath = resolveLegacyArtifactFile(params);
  const body = legacyArtifactWriteBody(params);
  await writeFile(filePath, body);
  return { filePath, sizeBytes: body.byteLength };
}

function legacyArtifactWriteBody(params: { content?: unknown; contentBase64?: unknown }): Buffer {
  if (typeof params.content === "string") {
    const body = Buffer.from(params.content, "utf8");
    assertWritableArtifactSize(body);
    return body;
  }
  if (typeof params.contentBase64 === "string") {
    const body = Buffer.from(params.contentBase64, "base64");
    assertWritableArtifactSize(body);
    return body;
  }
  throw new LegacyArtifactAccessError("content or contentBase64 is required", 400, "LEGACY_ARTIFACT_CONTENT_REQUIRED");
}

function assertWritableArtifactSize(body: Buffer): void {
  const maxBytes = 24 * 1024 * 1024;
  if (body.byteLength > maxBytes) {
    throw new LegacyArtifactAccessError("artifact update exceeds 24MB", 413, "LEGACY_ARTIFACT_TOO_LARGE");
  }
}

function defaultLegacyArtifactWorkspaceRoots(root: string): string[] {
  return [path.join(root, "tmp", "runs")];
}

function realOrResolved(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isWithinAnyRoot(candidate: string, roots: string[]): boolean {
  return roots.some((root) => isWithinRoot(candidate, root));
}

function isWithinRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}
