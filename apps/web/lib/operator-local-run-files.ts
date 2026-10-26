import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { type ArtifactRecord, readJson, repoRoot } from "@operator/core";
import type { LegacyOperatorChatMessageInput, LegacyMastraChatResult } from "./operator-application/legacy-mastra-chat-result";

export type LocalChatRequestFile = {
  run_id?: string;
  messages?: LegacyOperatorChatMessageInput[];
};

export type LocalChatPlanFile = {
  phase?: string;
  trace?: LegacyMastraChatResult["agent"]["trace"];
  error?: string;
  error_code?: string;
  error_detail?: string;
};

export type LocalArtifactManifestFile = {
  artifacts?: ArtifactRecord[];
};

export type LocalChatRunFiles = {
  runId?: string;
  outputDir: string;
  requestPath: string;
  planPath: string;
  resultPath: string;
  manifestPath: string;
  request?: LocalChatRequestFile;
  plan?: LocalChatPlanFile;
  result?: LegacyMastraChatResult;
  manifest?: LocalArtifactManifestFile;
  createdAtMs: number;
  updatedAtMs: number;
};

const LEGACY_OUTPUT_DIR = "output";
const CHAT_RUNS_DIR = "runs/chat";
const RUN_WORKSPACE_INDEX_TTL_MS = 30_000;

let runWorkspaceIndexCache:
  | {
      runsRoot: string;
      expiresAtMs: number;
      byRunId: Map<string, string>;
    }
  | undefined;

export function listLocalChatRuns(workspace: string): LocalChatRunFiles[] {
  return [...newRunFiles(workspace), ...legacyRunFiles(workspace)]
    .filter((run) => run.request || run.plan || run.result || run.manifest)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

export function readLatestLocalChatRun(workspace: string): LocalChatRunFiles | undefined {
  return listLocalChatRuns(workspace)[0];
}

export function resolveLocalRunWorkspace(taskId: string): string {
  const runsRoot = path.join(repoRoot(), "tmp/runs/web");
  const direct = path.join(runsRoot, taskId);
  if (existsSync(direct) || !existsSync(runsRoot)) return direct;

  return runWorkspaceIndex(runsRoot).get(taskId) ?? direct;
}

export function localTaskUpdatedAt(workspace: string): number | undefined {
  return readLatestLocalChatRun(workspace)?.updatedAtMs;
}

export function safeReadLocalJson<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    return readJson<T>(filePath);
  } catch {
    return undefined;
  }
}

function newRunFiles(workspace: string): LocalChatRunFiles[] {
  const runsDir = path.join(workspace, CHAT_RUNS_DIR);
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => filesFromOutputDir(workspace, path.join(CHAT_RUNS_DIR, entry.name, "output")));
}

function legacyRunFiles(workspace: string): LocalChatRunFiles[] {
  const legacyOutput = path.join(workspace, LEGACY_OUTPUT_DIR);
  return existsSync(legacyOutput) ? [filesFromOutputDir(workspace, LEGACY_OUTPUT_DIR)] : [];
}

function filesFromOutputDir(workspace: string, outputDir: string): LocalChatRunFiles {
  const requestPath = path.join(outputDir, "chat_request.json").split(path.sep).join("/");
  const planPath = path.join(outputDir, "chat_plan.json").split(path.sep).join("/");
  const resultPath = path.join(outputDir, "chat_result.json").split(path.sep).join("/");
  const manifestPath = path.join(outputDir, "artifact_manifest.json").split(path.sep).join("/");
  const paths = [requestPath, planPath, resultPath, manifestPath];
  const stats = paths.flatMap((filePath) => {
    const stat = safeStat(path.join(workspace, filePath));
    return stat ? [stat] : [];
  });
  const createdAtMs = stats.length ? Math.min(...stats.map((stat) => stat.birthtimeMs)) : 0;
  const updatedAtMs = stats.length ? Math.max(...stats.map((stat) => stat.mtimeMs)) : 0;
  const request = safeReadLocalJson<LocalChatRequestFile>(path.join(workspace, requestPath));
  const result = safeReadLocalJson<LegacyMastraChatResult>(path.join(workspace, resultPath));

  return {
    runId: request?.run_id ?? result?.run_id,
    outputDir,
    requestPath,
    planPath,
    resultPath,
    manifestPath,
    request,
    plan: safeReadLocalJson<LocalChatPlanFile>(path.join(workspace, planPath)),
    result,
    manifest: safeReadLocalJson<LocalArtifactManifestFile>(path.join(workspace, manifestPath)),
    createdAtMs,
    updatedAtMs
  };
}

function safeStat(filePath: string) {
  try {
    return statSync(filePath);
  } catch {
    return undefined;
  }
}

function runWorkspaceIndex(runsRoot: string): Map<string, string> {
  const now = Date.now();
  if (runWorkspaceIndexCache?.runsRoot === runsRoot && runWorkspaceIndexCache.expiresAtMs > now) {
    return runWorkspaceIndexCache.byRunId;
  }

  const byRunId = new Map<string, string>();
  for (const entry of readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const workspace = path.join(runsRoot, entry.name);
    indexWorkspaceRunIds(byRunId, workspace);
  }

  runWorkspaceIndexCache = {
    runsRoot,
    expiresAtMs: now + RUN_WORKSPACE_INDEX_TTL_MS,
    byRunId
  };
  return byRunId;
}

function indexWorkspaceRunIds(byRunId: Map<string, string>, workspace: string): void {
  addRunIdFromOutputDir(byRunId, workspace, LEGACY_OUTPUT_DIR);

  const chatRunsDir = path.join(workspace, CHAT_RUNS_DIR);
  if (!existsSync(chatRunsDir)) return;
  for (const entry of readdirSync(chatRunsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    addRunIdFromOutputDir(byRunId, workspace, path.join(CHAT_RUNS_DIR, entry.name, "output"));
  }
}

function addRunIdFromOutputDir(byRunId: Map<string, string>, workspace: string, outputDir: string): void {
  const requestPath = path.join(workspace, outputDir, "chat_request.json");
  const request = safeReadLocalJson<LocalChatRequestFile>(requestPath);
  if (request?.run_id) byRunId.set(request.run_id, workspace);

  const resultPath = path.join(workspace, outputDir, "chat_result.json");
  const result = safeReadLocalJson<LegacyMastraChatResult>(resultPath);
  if (result?.run_id) byRunId.set(result.run_id, workspace);
}
