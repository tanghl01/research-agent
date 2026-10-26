import { EventType } from "@ag-ui/core";
import { isActiveRunStatus, isTerminalRunStatus } from "@operator/contracts";
import { runError, type OperatorAgUiEvent } from "@/lib/ag-ui";
import { loadOperatorTaskDetail } from "@/lib/operator-application/task-query-service";
import { recordOperatorException } from "@/lib/operator-application/observability";
import { resolveServerTaskEventScope } from "@/lib/operator-backend/conversations";
import { getOperatorBackendRuntimeStatus } from "@/lib/operator-backend/config";
import { isLegacyLocalOperatorAccessAllowed, legacyLocalAccessDisabledResponse } from "@/lib/operator-local-access-policy";
import { enqueueRunReconciliation } from "@/lib/operator-application/run-reconciler-service";
import {
  isTerminalOperatorTaskAgUiEvent,
  OPERATOR_TASK_AG_UI_SSE_EVENT,
  operatorTaskAgUiEventChannel,
  operatorTaskAgUiEventBus,
  operatorTaskAgUiEventTimestamp,
  type OperatorTaskAgUiEvent
} from "@/lib/operator-task-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId");
  const source = url.searchParams.get("source");
  const afterMs = parseTimestampBoundary(url.searchParams.get("after"));
  if (!isSafeTaskId(taskId)) {
    return new Response("Invalid taskId", { status: 400 });
  }
  const legacyLocalAccessAllowed = isLegacyLocalOperatorAccessAllowed(source);
  if (source === "browser-local" && !legacyLocalAccessAllowed) return legacyLocalAccessDisabledResponse();

  const backendEnabled = getOperatorBackendRuntimeStatus().enabled;
  const serverScope = backendEnabled && !legacyLocalAccessAllowed ? await resolveServerTaskEventScope(taskId) : null;
  if (backendEnabled && !legacyLocalAccessAllowed && !serverScope) {
    return new Response("Task not found", { status: 404 });
  }
  const channelId = serverScope
    ? operatorTaskAgUiEventChannel({
        userId: serverScope.userId,
        projectId: serverScope.projectId,
        conversationId: serverScope.conversationId,
        taskId: serverScope.taskId
      })
    : operatorTaskAgUiEventChannel({ taskId });

  let eventBus: ReturnType<typeof operatorTaskAgUiEventBus>;
  try {
    eventBus = operatorTaskAgUiEventBus();
  } catch (error) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 503 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let cleanup = () => {
    closed = true;
    unsubscribe?.();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        req.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // The client may have already closed the stream.
        }
      };

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const sendAgUiEvent = (event: OperatorTaskAgUiEvent) => {
        const timestamp = operatorTaskAgUiEventTimestamp(event.event);
        if (isBeforeBoundary(timestamp, afterMs)) return;
        write(`event: ${OPERATOR_TASK_AG_UI_SSE_EVENT}\nid: ${timestamp}\ndata: ${JSON.stringify(event.event)}\n\n`);
        if (isTerminalOperatorTaskAgUiEvent(event.event)) cleanup();
      };

      const replayPersistedStatus = async () => {
        const persisted = await readPersistedTaskAgUiEvent(taskId, source).catch((error) => {
          recordOperatorException(
            "operator.task_events.persisted_status_read_failed",
            { "operator.task_id": taskId, "operator.source": source ?? "" },
            error
          );
          return undefined;
        });
        if (persisted?.active) {
          await enqueueRunReconciliation({
            taskId,
            conversationId: serverScope?.conversationId,
            projectId: serverScope?.projectId,
            userId: serverScope?.userId,
            reason: "task-events-active-status"
          }).catch((error) => {
            recordOperatorException(
              "operator.task_events.reconciliation_enqueue_failed",
              { "operator.task_id": taskId, "operator.reconcile_reason": "task-events-active-status" },
              error
            );
          });
        }
        if (persisted?.event && !closed) sendAgUiEvent({ taskId, event: persisted.event, source: "persisted" });
      };

      req.signal.addEventListener("abort", cleanup);
      write(": connected\n\n");
      unsubscribe = eventBus.subscribe(channelId, sendAgUiEvent);
      void replayPersistedStatus();
      heartbeatTimer = setInterval(() => write(": heartbeat\n\n"), HEARTBEAT_MS);
    },
    cancel() {
      cleanup();
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    }
  });
}

async function readPersistedTaskAgUiEvent(
  taskId: string,
  source: string | null
): Promise<{ active: boolean; event?: OperatorAgUiEvent } | undefined> {
  const detail = await loadOperatorTaskDetail({
    taskId,
    source,
    legacyLocalAccessAllowed: isLegacyLocalOperatorAccessAllowed(source)
  });
  const latestRun = detail?.latestRun;
  if (!latestRun) return undefined;
  if (isActiveRunStatus(latestRun.status)) return { active: true };
  if (!isTerminalRunStatus(latestRun.status)) return undefined;

  const terminalEvent = [...(detail.agUiEvents ?? [])].reverse().find(isTerminalOperatorTaskAgUiEvent);
  return {
    active: false,
    event:
      terminalEvent ??
      synthesizeTerminalAgUiEvent({
        taskId,
        runId: latestRun.runId,
        status: latestRun.status,
        finishedAt: latestRun.finishedAt,
        error: latestRun.error
      })
  };
}

function isSafeTaskId(taskId: string | null | undefined): taskId is string {
  return Boolean(taskId && !taskId.includes("/") && !taskId.includes("\\"));
}

function parseTimestampBoundary(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isBeforeBoundary(timestamp: number, afterMs: number | undefined): boolean {
  if (!afterMs) return false;
  return Number.isFinite(timestamp) && timestamp < afterMs - 5_000;
}

function synthesizeTerminalAgUiEvent(params: {
  taskId: string;
  runId: string;
  status: string;
  finishedAt?: string;
  error?: Record<string, unknown> | null;
}): OperatorAgUiEvent {
  const timestamp = timestampMs(params.finishedAt) ?? Date.now();
  if (params.status === "succeeded") {
    return {
      type: EventType.RUN_FINISHED,
      threadId: params.taskId,
      runId: params.runId,
      timestamp,
      outcome: { type: "success" }
    };
  }
  return runError(stringValue(params.error?.message) ?? "Operator task failed", stringValue(params.error?.code), timestamp);
}

function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
