import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ArtifactRecord } from "./types.js";
import { relativeToWorkspace, workspacePath, writeJson } from "./workspace.js";

const typeBySuffix: Record<string, string> = {
  ".json": "json",
  ".md": "md",
  ".pptx": "pptx",
  ".html": "html",
  ".txt": "txt",
  ".png": "png",
  ".pdf": "pdf",
  ".zip": "zip"
};

const mimeBySuffix: Record<string, string> = {
  ".json": "application/json",
  ".md": "text/markdown",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".html": "text/html",
  ".txt": "text/plain",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".zip": "application/zip"
};

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function artifactFromFile(params: {
  workspace: string;
  path: string;
  stepId: string;
  name?: string;
  type?: string;
  metadata?: Record<string, unknown>;
}): ArtifactRecord {
  const absolute = workspacePath(params.workspace, params.path);
  if (!existsSync(absolute)) {
    throw new Error(`Artifact file does not exist: ${absolute}`);
  }
  const suffix = path.extname(absolute).toLowerCase();
  return {
    name: params.name ?? path.basename(absolute, suffix),
    type: params.type ?? typeBySuffix[suffix] ?? (suffix.slice(1) || "file"),
    path: relativeToWorkspace(params.workspace, absolute),
    mime_type: mimeBySuffix[suffix] ?? "application/octet-stream",
    size_bytes: statSync(absolute).size,
    sha256: sha256File(absolute),
    step_id: params.stepId,
    metadata: params.metadata ?? {}
  };
}

export function writeArtifactManifest(params: {
  workspace: string;
  path: string;
  workflowRunId: string;
  stepRunId: string;
  artifacts: ArtifactRecord[];
}): void {
  writeJson(workspacePath(params.workspace, params.path), {
    version: "1.0",
    workflow_run_id: params.workflowRunId,
    step_run_id: params.stepRunId,
    artifacts: params.artifacts
  });
}
