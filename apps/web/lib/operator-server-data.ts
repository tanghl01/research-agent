import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "@operator/core";
import {
  stableOperatorMessageId,
  type OperatorConversationMessage as OperatorChatMessage,
  type OperatorConversationMessageInput as OperatorChatMessageInput
} from "@operator/contracts";
import { rewriteWorkspaceArtifactLinks } from "@/lib/artifact-links";
import { summarizeLegacyMastraChatResult } from "@/lib/chat-result";
import type { ScopeCatalog } from "@/lib/scopes";
import { loadMastraRuntimeUserScopeCatalog } from "@/lib/operator-application/mastra-scope-runtime-adapter";
import { compactOperatorMessages } from "@/lib/operator-message-history";
import { getOperatorBackendRuntimeStatus } from "@/lib/operator-backend/config";
import { listServerConversationTasks, loadServerTaskMessages } from "@/lib/operator-backend/conversations";
import { readLatestLocalChatRun, resolveLocalRunWorkspace } from "@/lib/operator-local-run-files";
import { withOperatorSpan } from "@/lib/operator-application/observability";
import type { OperatorTask } from "@/lib/tasks";

export function loadOperatorScopeCatalog(): ScopeCatalog {
  return loadMastraRuntimeUserScopeCatalog() as ScopeCatalog;
}

export type OperatorTaskDataSource = "server" | "local";
type LocalOperatorTaskMessageOptions = {
  source?: string;
};

export async function listOperatorTasks(): Promise<OperatorTask[]> {
  return (await listOperatorTasksWithSource()).tasks;
}

export async function listOperatorTasksWithSource(): Promise<{ source: OperatorTaskDataSource; tasks: OperatorTask[] }> {
  if (getOperatorBackendRuntimeStatus().enabled) {
    const serverTasks = await withOperatorSpan("operator.backend.list_tasks", { "operator.backend": "server" }, () =>
      listServerConversationTasks()
    );
    return { source: "server", tasks: serverTasks ?? [] };
  }
  return { source: "local", tasks: listLocalOperatorTasks() };
}

export async function loadOperatorTaskMessages(taskId: string | null | undefined): Promise<OperatorChatMessage[]> {
  return (await loadOperatorTaskMessagesWithSource(taskId)).messages;
}

export async function loadOperatorTaskMessagesWithSource(
  taskId: string | null | undefined
): Promise<{ source: OperatorTaskDataSource; messages: OperatorChatMessage[] }> {
  if (getOperatorBackendRuntimeStatus().enabled) {
    const serverMessages = await withOperatorSpan(
      "operator.backend.load_task_messages",
      { "operator.backend": "server", "operator.task_id": taskId ?? "" },
      () => loadServerTaskMessages(taskId)
    );
    return { source: "server", messages: serverMessages ?? [] };
  }
  return { source: "local", messages: loadLocalOperatorTaskMessages(taskId) };
}

export function loadBrowserLocalOperatorTaskMessages(
  taskId: string | null | undefined,
  options: LocalOperatorTaskMessageOptions = {}
): OperatorChatMessage[] {
  return loadLocalOperatorTaskMessages(taskId, options);
}

function listLocalOperatorTasks(): OperatorTask[] {
  const runsRoot = path.join(repoRoot(), "tmp/runs/web");
  if (!existsSync(runsRoot)) return [];

  return dedupeTasks(
    readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => taskFromRun(path.join(runsRoot, entry.name), entry.name))
  ).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function loadLocalOperatorTaskMessages(
  taskId: string | null | undefined,
  options: LocalOperatorTaskMessageOptions = {}
): OperatorChatMessage[] {
  if (!isSafeTaskId(taskId)) return [];

  const workspace = resolveLocalRunWorkspace(taskId);
  const latest = readLatestLocalChatRun(workspace);
  const request = latest?.request;
  const result = latest?.result;
  const messages = compactOperatorMessages(
    (request?.messages ?? []).map((message) => rewriteMessageArtifactLinks(message, workspace, options)),
    `${taskId}:${latest?.runId ?? "local"}`
  );
  const resultResponse = result
    ? rewriteWorkspaceArtifactLinks(
        summarizeLegacyMastraChatResult(result, {
          artifacts: latest?.manifest?.artifacts ?? [],
          messages
        }).trim(),
        workspace,
        options
      )
    : undefined;
  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")
    ?.content.trim();
  if (resultResponse && resultResponse !== lastAssistant) {
    messages.push({
      id: stableOperatorMessageId(
        `${taskId}:${latest?.runId ?? "local"}:result`,
        { role: "assistant", content: resultResponse },
        messages.length
      ),
      role: "assistant",
      content: resultResponse
    });
  }

  return messages;
}

function rewriteMessageArtifactLinks(
  message: OperatorChatMessageInput,
  workspace: string,
  options: LocalOperatorTaskMessageOptions
): OperatorChatMessageInput {
  if (message.role !== "assistant") return message;
  return {
    ...message,
    content: rewriteWorkspaceArtifactLinks(message.content, workspace, options) ?? message.content
  };
}

function taskFromRun(runDir: string, fallbackId: string): OperatorTask[] {
  const latest = readLatestLocalChatRun(runDir);
  if (!latest) return [];

  const request = latest.request;
  const result = latest.result;
  const title = titleFromMessages(request?.messages) ?? titleFromResponse(result?.response) ?? "新任务";
  const createdAt = new Date(latest.createdAtMs || latest.updatedAtMs || Date.now()).toISOString();
  const updatedAt = new Date(latest.updatedAtMs || latest.createdAtMs || Date.now()).toISOString();

  return [
    {
      id: fallbackId,
      title,
      createdAt,
      updatedAt
    }
  ];
}

function titleFromMessages(messages: OperatorChatMessageInput[] | undefined): string | undefined {
  const firstUserMessage = messages?.find((message) => message.role === "user" && message.content.trim());
  return firstUserMessage ? compactTitle(firstUserMessage.content) : undefined;
}

function titleFromResponse(response: string | undefined): string | undefined {
  return response?.trim() ? compactTitle(response) : undefined;
}

function compactTitle(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return normalized.length > 32 ? `${normalized.slice(0, 32)}...` : normalized;
}

function dedupeTasks(tasks: OperatorTask[]): OperatorTask[] {
  const byTitle = new Map<string, OperatorTask>();
  for (const task of tasks) {
    const key = task.title.replace(/\s+/gu, " ").trim().toLowerCase();
    const existing = byTitle.get(key);
    if (!existing || Date.parse(task.updatedAt) > Date.parse(existing.updatedAt)) {
      byTitle.set(key, task);
    }
  }
  return [...byTitle.values()];
}

function isSafeTaskId(taskId: string | null | undefined): taskId is string {
  return Boolean(taskId && !taskId.includes("/") && !taskId.includes("\\"));
}
