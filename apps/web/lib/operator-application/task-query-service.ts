import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactRecord } from "@operator/core";
import { workspacePath } from "@operator/core";
import {
  createProductEvent,
  ensureOperatorMessageIds,
  isRunStatus,
  stableOperatorMessageId,
  type ArtifactContract,
  type MessageContract,
  type OperatorConversationMessage as OperatorChatMessage,
  type ProductEvent,
  type RunStatus,
  type TaskSnapshot
} from "@operator/contracts";
import { artifactHref, rewriteWorkspaceArtifactLinks } from "../artifact-links";
import { loadServerTaskRunDetail } from "../operator-backend/runs";
import { readLatestLocalChatRun, resolveLocalRunWorkspace, type LocalChatRunFiles } from "../operator-local-run-files";
import { summarizeOperatorRuntimeResult } from "./runtime-result-summary";

export type OperatorTaskDataSource = "server" | "local";

export type OperatorTaskDetailPayload = (ServerTaskDetailPayload | LocalTaskRunDetail | MissingTaskRunDetail) & {
  productEvents?: ProductEvent[];
  agUiEvents?: unknown[];
};

export type OperatorTaskMessagesPayload = {
  source: OperatorTaskDataSource;
  messages: OperatorChatMessage[];
};

type LocalTaskRunDetail = {
  taskId: string;
  conversationId: string;
  workspace: string;
  exists: boolean;
  latestRun?: {
    runId: string;
    status: RunStatus;
    startedAt?: string;
    finishedAt?: string;
    error?: Record<string, unknown>;
    output: Record<string, unknown>;
  };
  messages: MessageContract[];
  productEvents: ProductEvent[];
  agUiEvents: unknown[];
  request: {
    run_id?: string;
    messages: OperatorChatMessage[];
  };
  plan: {
    phase?: string;
    error?: string;
    error_code?: string;
    error_detail?: string;
    trace: unknown[];
  };
  events: unknown[];
  result?: {
    run_id: string;
    status: "succeeded" | "failed";
    response?: string;
    selected_skills: unknown[];
    runs: unknown[];
    agent: Record<string, unknown>;
  };
  artifacts: Array<ArtifactContract & { mime_type: string; size_bytes: number; preview?: string }>;
  backend: "local";
};

type ServerTaskDetailPayload = Omit<TaskSnapshot, "events" | "artifacts" | "backend"> & {
  request: {
    run_id?: string;
    messages: OperatorChatMessage[];
  };
  plan: {
    phase?: string;
    error?: string;
    error_code?: string;
    error_detail?: string;
    trace: unknown[];
  };
  events: unknown[];
  result?: {
    run_id: string;
    status: "succeeded" | "failed";
    response?: string;
    selected_skills: unknown[];
    runs: unknown[];
    agent: Record<string, unknown>;
  };
  artifacts: Array<ArtifactContract & { mime_type: string; size_bytes: number; preview?: string }>;
  backend: "server";
};

type MissingTaskRunDetail = {
  taskId: string | null;
  workspace: undefined;
  exists: false;
  conversationId?: undefined;
  latestRun?: undefined;
  messages: MessageContract[];
  productEvents: ProductEvent[];
  agUiEvents: unknown[];
  request: { messages: OperatorChatMessage[] };
  plan: { trace: unknown[] };
  events: unknown[];
  artifacts: [];
  backend: OperatorTaskDataSource;
};

export async function loadOperatorTaskDetail(params: {
  taskId: string | null | undefined;
  source: string | null;
  legacyLocalAccessAllowed: boolean;
}): Promise<OperatorTaskDetailPayload> {
  if (!isSafeTaskId(params.taskId)) return missingTaskDetail(params.taskId ?? null, params.legacyLocalAccessAllowed ? "local" : "server");

  if (!params.legacyLocalAccessAllowed) {
    const snapshot = await loadServerTaskRunDetail(params.taskId);
    return snapshot ? serverTaskDetailPayloadFromSnapshot(snapshot) : missingTaskDetail(params.taskId, "server");
  }

  return loadLocalOperatorTaskDetail(params.taskId, params.source);
}

function serverTaskDetailPayloadFromSnapshot(snapshot: TaskSnapshot): ServerTaskDetailPayload {
  const compatibility = isRecord(snapshot.compatibility) ? snapshot.compatibility : {};
  return {
    ...snapshot,
    request: compatibilityRequest(compatibility, snapshot),
    plan: compatibilityPlan(compatibility, snapshot),
    result: compatibilityResult(compatibility),
    events: compatibilityEvents(compatibility, snapshot),
    artifacts: snapshot.artifacts.map((artifact) => ({
      ...artifact,
      mime_type: artifact.mimeType ?? "",
      size_bytes: artifact.sizeBytes ?? 0
    })),
    backend: "server"
  };
}

export async function loadOperatorTaskMessagesPayload(params: {
  taskId: string | null | undefined;
  source: string | null;
  legacyLocalAccessAllowed: boolean;
}): Promise<OperatorTaskMessagesPayload> {
  const detail = await loadOperatorTaskDetail(params);
  return {
    source: detail.backend === "server" ? "server" : "local",
    messages: contractMessagesToChatMessages(detail.messages)
  };
}

function loadLocalOperatorTaskDetail(taskId: string, source: string | null): Promise<LocalTaskRunDetail> {
  const workspace = resolveLocalRunWorkspace(taskId);
  const latest = readLatestLocalChatRun(workspace);
  const request = latest?.request;
  const plan = latest?.plan;
  const result = latest?.result;
  const manifest = latest?.manifest;
  const legacyArtifactSource = source === "browser-local" ? source : undefined;
  const artifacts = existingArtifacts(workspace, manifest?.artifacts ?? fallbackArtifacts(workspace, latest?.outputDir));
  const runId = request?.run_id ?? result?.run_id ?? latest?.runId ?? taskId;
  const status = localRunStatus(plan?.phase, result?.status);
  const requestMessages = ensureOperatorMessageIds(request?.messages ?? [], `${taskId}:${latest?.runId ?? "local"}:detail`);
  const messages = localMessagesToContracts({
    taskId,
    conversationId: taskId,
    runId,
    workspace,
    requestMessages,
    result,
    artifacts: manifest?.artifacts ?? [],
    legacyArtifactSource
  });
  const productEvents = result
    ? [
        createProductEvent({
          source: "/operator/web/local",
          taskId,
          runId,
          kind: result.status === "failed" ? "run.failed" : "run.succeeded",
          timestamp: new Date(latest?.updatedAtMs || Date.now()).toISOString(),
          payload: { status: result.status }
        })
      ]
    : [];

  return Promise.all(artifacts.map((artifact) => artifactPreview(workspace, artifact))).then((previews) => ({
    taskId,
    conversationId: taskId,
    workspace,
    exists: existsSync(workspace),
    latestRun: latest
      ? {
          runId,
          status,
          startedAt: latest.createdAtMs ? new Date(latest.createdAtMs).toISOString() : undefined,
          finishedAt: result ? new Date(latest.updatedAtMs || Date.now()).toISOString() : undefined,
          error: result?.status === "failed" ? { message: result.agent.error ?? "Operator task failed" } : undefined,
          output: result ? { result } : {}
        }
      : undefined,
    messages,
    productEvents,
    agUiEvents: [],
    request: {
      run_id: request?.run_id,
      messages: requestMessages
    },
    plan: {
      phase: plan?.phase,
      error: plan?.error,
      error_code: plan?.error_code,
      error_detail: plan?.error_detail,
      trace: plan?.trace ?? []
    },
    events: [],
    result: result
      ? {
          run_id: result.run_id,
          status: result.status,
          response: rewriteWorkspaceArtifactLinks(result.response, workspace, { source: legacyArtifactSource }),
          selected_skills: result.selected_skills,
          runs: result.runs,
          agent: result.agent
        }
      : undefined,
    artifacts: artifacts.map((artifact, index) => ({
      id: `${runId}:${index}:${artifact.path}`,
      taskId,
      runId,
      name: artifact.name,
      type: artifact.type,
      path: artifact.path,
      mimeType: artifact.mime_type,
      mime_type: artifact.mime_type,
      sizeBytes: artifact.size_bytes,
      size_bytes: artifact.size_bytes,
      sha256: artifact.sha256 || undefined,
      metadata: artifact.metadata ?? {},
      href: artifactHref(workspace, artifact.path, { source: legacyArtifactSource }),
      downloadHref: artifactHref(workspace, artifact.path, { download: true, source: legacyArtifactSource }),
      createdAt: new Date(latest?.updatedAtMs || Date.now()).toISOString(),
      preview: previews[index]
    })),
    backend: "local"
  }));
}

function localMessagesToContracts(params: {
  taskId: string;
  conversationId: string;
  runId: string;
  workspace: string;
  requestMessages: OperatorChatMessage[];
  result: LocalChatRunFiles["result"];
  artifacts: ArtifactRecord[];
  legacyArtifactSource?: string;
}): MessageContract[] {
  const messages: OperatorChatMessage[] = [...params.requestMessages];
  const resultResponse = params.result
    ? rewriteWorkspaceArtifactLinks(
        summarizeOperatorRuntimeResult(params.result, {
          artifacts: params.artifacts,
          messages
        }).trim(),
        params.workspace,
        { source: params.legacyArtifactSource }
      )
    : undefined;
  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")
    ?.content.trim();
  if (resultResponse && resultResponse !== lastAssistant) {
    messages.push({
      id: stableOperatorMessageId(
        `${params.taskId}:${params.runId}:result`,
        { role: "assistant", content: resultResponse },
        messages.length
      ),
      role: "assistant",
      content: resultResponse
    });
  }
  return messages.map((message) => ({
    id: message.id,
    taskId: params.taskId,
    conversationId: params.conversationId,
    runId: message.role === "assistant" ? params.runId : undefined,
    role: message.role,
    content: message.content,
    createdAt: new Date(0).toISOString(),
    metadata: {}
  }));
}

function contractMessagesToChatMessages(messages: MessageContract[]): OperatorChatMessage[] {
  return messages.flatMap((message): OperatorChatMessage[] =>
    message.role === "user" || message.role === "assistant" || message.role === "system"
      ? [{ id: message.id, role: message.role, content: message.content }]
      : []
  );
}

function compatibilityRequest(
  compatibility: Record<string, unknown>,
  snapshot: TaskSnapshot
): ServerTaskDetailPayload["request"] {
  const request = isRecord(compatibility.request) ? compatibility.request : {};
  const runId = typeof request.run_id === "string" && request.run_id.trim() ? request.run_id : snapshot.latestRun?.runId;
  const messages = Array.isArray(request.messages) ? normalizeCompatibilityMessages(request.messages) : contractMessagesToChatMessages(snapshot.messages);
  return {
    run_id: runId,
    messages
  };
}

function compatibilityPlan(compatibility: Record<string, unknown>, snapshot: TaskSnapshot): ServerTaskDetailPayload["plan"] {
  const plan = isRecord(compatibility.plan) ? compatibility.plan : {};
  return {
    phase: typeof plan.phase === "string" ? plan.phase : snapshot.latestRun?.status,
    error: typeof plan.error === "string" ? plan.error : undefined,
    error_code: typeof plan.error_code === "string" ? plan.error_code : undefined,
    error_detail: typeof plan.error_detail === "string" ? plan.error_detail : undefined,
    trace: Array.isArray(plan.trace) ? plan.trace : []
  };
}

function compatibilityEvents(compatibility: Record<string, unknown>, snapshot: TaskSnapshot): unknown[] {
  return Array.isArray(compatibility.events) ? compatibility.events : snapshot.agUiEvents;
}

function compatibilityResult(compatibility: Record<string, unknown>): ServerTaskDetailPayload["result"] | undefined {
  const result = isRecord(compatibility.result) ? compatibility.result : undefined;
  if (!result || typeof result.run_id !== "string" || (result.status !== "succeeded" && result.status !== "failed")) return undefined;
  return {
    run_id: result.run_id,
    status: result.status,
    response: typeof result.response === "string" ? result.response : undefined,
    selected_skills: Array.isArray(result.selected_skills) ? result.selected_skills : [],
    runs: Array.isArray(result.runs) ? result.runs : [],
    agent: isRecord(result.agent) ? result.agent : {}
  };
}

function normalizeCompatibilityMessages(messages: unknown[]): OperatorChatMessage[] {
  return messages.flatMap((message): OperatorChatMessage[] => {
    if (!isRecord(message)) return [];
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "system") return [];
    if (typeof message.id !== "string" || typeof message.content !== "string") return [];
    return [{ id: message.id, role: message.role, content: message.content }];
  });
}

function missingTaskDetail(taskId: string | null, backend: OperatorTaskDataSource): MissingTaskRunDetail {
  return {
    taskId,
    workspace: undefined,
    exists: false,
    messages: [],
    productEvents: [],
    agUiEvents: [],
    request: { messages: [] },
    plan: { trace: [] },
    events: [],
    artifacts: [],
    backend
  };
}

function localRunStatus(phase: string | undefined, resultStatus: string | undefined): RunStatus {
  if (resultStatus === "succeeded" || resultStatus === "failed") return resultStatus;
  if (isRunStatus(phase)) return phase;
  return resultStatus ? "failed" : "queued";
}

function existingArtifacts(workspace: string, artifacts: ArtifactRecord[]): ArtifactRecord[] {
  return artifacts.filter((artifact) => existsSync(workspacePath(workspace, artifact.path)));
}

function fallbackArtifacts(workspace: string, outputDir = "output"): ArtifactRecord[] {
  return ["chat_request.json", "chat_plan.json", "chat_result.json"]
    .map((filename) => `${outputDir}/${filename}`)
    .filter((artifactPath) => existsSync(workspacePath(workspace, artifactPath)))
    .map((artifactPath) => {
      const filePath = workspacePath(workspace, artifactPath);
      const stats = statSync(filePath);
      return {
        name: path.basename(artifactPath, path.extname(artifactPath)),
        type: path.extname(artifactPath).slice(1) || "file",
        path: artifactPath,
        mime_type: "application/json",
        size_bytes: stats.size,
        sha256: "",
        step_id: "operator_chat",
        metadata: {}
      };
    });
}

async function artifactPreview(workspace: string, artifact: ArtifactRecord): Promise<string | undefined> {
  if (!isPreviewable(artifact)) return undefined;
  if (artifact.size_bytes > 120_000) return undefined;
  try {
    const text = await readFile(workspacePath(workspace, artifact.path), "utf8");
    return text.length > 12_000 ? `${text.slice(0, 12_000)}\n...` : text;
  } catch {
    return undefined;
  }
}

function isPreviewable(artifact: ArtifactRecord): boolean {
  return (
    artifact.mime_type.startsWith("text/") ||
    ["application/json", "image/svg+xml"].includes(artifact.mime_type) ||
    [".json", ".md", ".txt", ".csv", ".html", ".svg", ".css"].includes(path.extname(artifact.path).toLowerCase())
  );
}

function isSafeTaskId(taskId: string | null | undefined): taskId is string {
  return Boolean(taskId && !taskId.includes("/") && !taskId.includes("\\"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
