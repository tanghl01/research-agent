import { isActiveRunStatus, isRunStatus } from "@operator/contracts";
import type { TaskSnapshot } from "@operator/contracts";
import type { UIMessage } from "ai";
import { buildProgressActivityEvent, isOperatorAgUiEvent, type OperatorAgUiEvent, runStarted } from "../../lib/ag-ui";

export type HistoryMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export type OperatorThreadUiMessage = UIMessage<unknown, { "ag-ui-event": OperatorAgUiEvent }>;

export type RestoredRunState = {
  phase: string;
  events: OperatorAgUiEvent[];
};

const HISTORY_MESSAGE_CACHE_TTL_MS = 30_000;
const historyMessageCache = new Map<string, { expiresAtMs: number; promise: Promise<HistoryMessage[]> }>();

export function preloadHistoryMessages(taskId: string, localHistoryMode: boolean): void {
  void fetchHistoryMessages(taskId, localHistoryMode).catch(() => undefined);
}

export function fetchHistoryMessages(
  taskId: string,
  localHistoryMode: boolean,
  options: { force?: boolean } = {}
): Promise<HistoryMessage[]> {
  const cacheKey = `${localHistoryMode ? "browser-local" : "default"}:${taskId}`;
  const now = Date.now();
  const cached = historyMessageCache.get(cacheKey);
  if (!options.force && cached && cached.expiresAtMs > now) return cached.promise;

  const params = new URLSearchParams({ taskId });
  if (localHistoryMode) params.set("source", "browser-local");
  const promise = fetch(`/api/operator/task-messages?${params.toString()}`, { cache: "no-store" })
    .then((response) => response.json())
    .then((payload: { messages?: unknown }) => normalizeHistoryMessages(payload.messages, cacheKey))
    .catch((error) => {
      historyMessageCache.delete(cacheKey);
      throw error;
    });

  historyMessageCache.set(cacheKey, { expiresAtMs: now + HISTORY_MESSAGE_CACHE_TTL_MS, promise });
  return promise;
}

export function fetchTaskSnapshot(taskId: string, localHistoryMode: boolean): Promise<TaskSnapshot | null> {
  const params = new URLSearchParams({ taskId });
  if (localHistoryMode) params.set("source", "browser-local");
  return fetch(`/api/operator/task-detail?${params.toString()}`, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload: unknown) => (isRecord(payload) ? (payload as TaskSnapshot) : null));
}

export function snapshotMessagePayload(snapshot: TaskSnapshot): unknown {
  if (snapshot.messages?.length) return snapshot.messages;
  const request = snapshotRequest(snapshot);
  return request?.messages;
}

export function snapshotPhase(snapshot: TaskSnapshot): string | undefined {
  const plan = snapshotPlan(snapshot);
  return snapshot.latestRun?.status ?? plan?.phase;
}

export function snapshotAgUiPayload(snapshot: TaskSnapshot): unknown {
  if (snapshot.agUiEvents?.length) return snapshot.agUiEvents;
  return snapshotEvents(snapshot);
}

export function snapshotRunId(snapshot: TaskSnapshot): string | undefined {
  const request = snapshotRequest(snapshot);
  return snapshot.latestRun?.runId ?? request?.run_id;
}

export function normalizeSnapshotMessages(messages: unknown): HistoryMessage[] {
  return normalizeHistoryMessages(messages, "snapshot");
}

export function normalizeHistoryMessages(messages: unknown, scope: string): HistoryMessage[] {
  if (!Array.isArray(messages)) return [];
  return uniquifyHistoryMessageIds(
    messages.flatMap((message, index): HistoryMessage[] => {
      if (!isRecord(message)) return [];
      const role = message.role === "user" || message.role === "assistant" || message.role === "system" ? message.role : undefined;
      if (!role || typeof message.content !== "string") return [];
      return [
        {
          id: typeof message.id === "string" && message.id.trim() ? message.id : legacyHistoryMessageId(scope, role, message.content, index),
          role,
          content: message.content
        }
      ];
    })
  );
}

export function historyMessagesToUiMessages(
  messages: readonly HistoryMessage[],
  options: { restoredRun?: RestoredRunState | null; taskId?: string } = {}
): OperatorThreadUiMessage[] {
  const uiMessages = uniquifyHistoryMessageIds(messages).map(historyMessageToUiMessage);
  if (options.restoredRun?.events.length) {
    uiMessages.push(restoredRunToUiMessage(options.taskId ?? "task", options.restoredRun));
  }
  return uiMessages;
}

export function operatorThreadUiMessagesEqual(
  left: readonly OperatorThreadUiMessage[],
  right: readonly OperatorThreadUiMessage[]
): boolean {
  return operatorThreadUiMessagesKey(left) === operatorThreadUiMessagesKey(right);
}

export function operatorThreadUiMessagesKey(messages: readonly OperatorThreadUiMessage[]): string {
  return safeJsonKey(
    messages.map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.parts
    }))
  );
}

export function normalizeSnapshotEvents(events: unknown): OperatorAgUiEvent[] {
  if (!Array.isArray(events)) return [];
  return events.filter(isOperatorAgUiEvent);
}

export function isRunningTaskPhase(phase: string | undefined): phase is string {
  return isRunStatus(phase) && isActiveRunStatus(phase);
}

export function fallbackRunningEvents(taskId: string, runId: string | undefined): OperatorAgUiEvent[] {
  const now = Date.now();
  const resolvedRunId = runId ?? taskId;
  return [
    runStarted(taskId, resolvedRunId, now),
    buildProgressActivityEvent({
      threadId: taskId,
      runId: resolvedRunId,
      timestamp: now,
      startedAt: now,
      label: "Agent 正在执行",
      detail: "正在恢复任务状态"
    })
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function historyMessageToUiMessage(message: HistoryMessage): OperatorThreadUiMessage {
  return {
    id: message.id,
    role: message.role,
    parts: message.content ? [{ type: "text", text: message.content }] : []
  };
}

function uniquifyHistoryMessageIds(messages: readonly HistoryMessage[]): HistoryMessage[] {
  const seen = new Set<string>();
  return messages.map((message, index) => {
    if (!seen.has(message.id)) {
      seen.add(message.id);
      return message;
    }
    const id = `${message.id}_${index}_${stableTextKey(`${message.role}:${message.content}`)}`;
    seen.add(id);
    return { ...message, id };
  });
}

function restoredRunToUiMessage(taskId: string, restoredRun: RestoredRunState): OperatorThreadUiMessage {
  return {
    id: `restored_run_${safeMessageIdSegment(taskId)}_${stableTextKey(safeJsonKey(restoredRun.events))}`,
    role: "assistant",
    parts: restoredRun.events.map((event, index) => ({
      type: "data-ag-ui-event",
      id: `restored_event_${index}_${stableTextKey(safeJsonKey(event))}`,
      data: event
    }))
  };
}

function safeJsonKey(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function snapshotRequest(snapshot: TaskSnapshot): { run_id?: string; messages?: unknown } | undefined {
  const compatibility = isRecord(snapshot.compatibility) ? snapshot.compatibility : {};
  const request = isRecord(compatibility.request)
    ? compatibility.request
    : isRecord((snapshot as unknown as Record<string, unknown>).request)
      ? ((snapshot as unknown as Record<string, unknown>).request as Record<string, unknown>)
      : undefined;
  if (!request) return undefined;
  return {
    run_id: typeof request.run_id === "string" ? request.run_id : undefined,
    messages: request.messages
  };
}

function snapshotPlan(snapshot: TaskSnapshot): { phase?: string } | undefined {
  const compatibility = isRecord(snapshot.compatibility) ? snapshot.compatibility : {};
  const plan = isRecord(compatibility.plan)
    ? compatibility.plan
    : isRecord((snapshot as unknown as Record<string, unknown>).plan)
      ? ((snapshot as unknown as Record<string, unknown>).plan as Record<string, unknown>)
      : undefined;
  if (!plan) return undefined;
  return {
    phase: typeof plan.phase === "string" ? plan.phase : undefined
  };
}

function snapshotEvents(snapshot: TaskSnapshot): unknown {
  const compatibility = isRecord(snapshot.compatibility) ? snapshot.compatibility : {};
  if (Array.isArray(compatibility.events)) return compatibility.events;
  const legacyEvents = (snapshot as unknown as Record<string, unknown>).events;
  return Array.isArray(legacyEvents) ? legacyEvents : [];
}

function legacyHistoryMessageId(scope: string, role: HistoryMessage["role"], content: string, index: number): string {
  return `legacy_${safeMessageIdSegment(scope)}_${index}_${role}_${stableTextKey(content)}`;
}

function safeMessageIdSegment(value: string): string {
  const normalized = value.replace(/[^a-z0-9_-]+/giu, "_").replace(/^_+|_+$/gu, "");
  return (normalized || "history").slice(0, 48);
}

function stableTextKey(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}
