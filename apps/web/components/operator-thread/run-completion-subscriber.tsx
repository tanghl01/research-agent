import { useAuiState } from "@assistant-ui/react";
import { EventType } from "@ag-ui/core";
import { isTerminalRunStatus } from "@operator/contracts";
import { OPERATOR_TASK_AG_UI_SSE_EVENT } from "@/lib/operator-task-event-contract";
import { useCallback, useEffect, useRef } from "react";
import { fetchTaskSnapshot, normalizeSnapshotMessages, snapshotMessagePayload, type HistoryMessage } from "./history";

const HISTORY_RECONCILE_RETRY_COUNT = 5;
const HISTORY_RECONCILE_RETRY_DELAY_MS = 500;
const HISTORY_STREAM_SETTLE_DELAY_MS = 250;
const HISTORY_STREAM_START_GRACE_MS = 900;

type AgUiEventPayload = {
  type?: string;
  threadId?: string;
  timestamp?: string | number;
};

export function RunCompletionSubscriber({
  active,
  homeMode,
  localHistoryMode,
  onComplete,
  reconciled,
  restoredRunning,
  startedAfterMs,
  taskId
}: {
  active: boolean;
  homeMode: boolean;
  localHistoryMode: boolean;
  onComplete: (messages: HistoryMessage[]) => void;
  reconciled: boolean;
  restoredRunning: boolean;
  startedAfterMs: number | null;
  taskId: string;
}) {
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const wasRunningRef = useRef(false);
  const reconciliationRunRef = useRef(0);

  const reconcileTerminalSnapshot = useCallback(
    (options: { initialDelayMs?: number; retryCount?: number } = {}) => {
      const reconciliationRun = ++reconciliationRunRef.current;
      let cancelled = false;
      let timer: number | undefined;
      const attempt = (remainingRetries: number, delayMs: number) => {
        timer = window.setTimeout(() => {
          if (cancelled || reconciliationRunRef.current !== reconciliationRun) return;
          void fetchTaskSnapshot(taskId, localHistoryMode)
            .then((snapshot) => {
              if (cancelled || reconciliationRunRef.current !== reconciliationRun) return;
              const status = snapshot?.latestRun?.status;
              const messages = snapshot ? normalizeSnapshotMessages(snapshotMessagePayload(snapshot)) : [];
              if (status && isTerminalRunStatus(status) && messages.length) {
                onComplete(messages);
                return;
              }
              if (remainingRetries > 0) attempt(remainingRetries - 1, HISTORY_RECONCILE_RETRY_DELAY_MS);
            })
            .catch(() => {
              if (!cancelled && reconciliationRunRef.current === reconciliationRun && remainingRetries > 0) {
                attempt(remainingRetries - 1, HISTORY_RECONCILE_RETRY_DELAY_MS);
              }
            });
        }, delayMs);
      };
      attempt(options.retryCount ?? 0, options.initialDelayMs ?? 0);
      return () => {
        cancelled = true;
        if (timer) window.clearTimeout(timer);
      };
    },
    [localHistoryMode, onComplete, taskId]
  );

  useEffect(() => {
    if (!active || homeMode || (!isRunning && !restoredRunning) || reconciled) return;
    if (typeof EventSource === "undefined") return;

    let cancelReconcile: (() => void) | undefined;
    const params = new URLSearchParams({ taskId });
    if (localHistoryMode) params.set("source", "browser-local");
    if (startedAfterMs) params.set("after", String(startedAfterMs));
    const eventSource = new EventSource(`/api/operator/task-events?${params.toString()}`);

    const handleTerminalEvent = (event: MessageEvent<string>) => {
      const payload = parseAgUiEvent(event.data);
      if (!payload || (payload.threadId && payload.threadId !== taskId) || !isCompletedAgUiEvent(payload)) return;
      if (isStaleAgUiEvent(payload, startedAfterMs)) return;
      eventSource.close();
      cancelReconcile?.();
      cancelReconcile = reconcileTerminalSnapshot({ retryCount: HISTORY_RECONCILE_RETRY_COUNT });
    };

    eventSource.addEventListener(OPERATOR_TASK_AG_UI_SSE_EVENT, handleTerminalEvent);
    return () => {
      cancelReconcile?.();
      eventSource.removeEventListener(OPERATOR_TASK_AG_UI_SSE_EVENT, handleTerminalEvent);
      eventSource.close();
    };
  }, [active, homeMode, isRunning, localHistoryMode, reconcileTerminalSnapshot, reconciled, restoredRunning, startedAfterMs, taskId]);

  useEffect(() => {
    if (!active || homeMode || reconciled || !startedAfterMs) {
      if (!isRunning) wasRunningRef.current = false;
      return;
    }
    if (isRunning) {
      wasRunningRef.current = true;
      return;
    }

    const initialDelayMs = wasRunningRef.current ? HISTORY_STREAM_SETTLE_DELAY_MS : HISTORY_STREAM_START_GRACE_MS;
    wasRunningRef.current = false;
    return reconcileTerminalSnapshot({
      initialDelayMs,
      retryCount: HISTORY_RECONCILE_RETRY_COUNT
    });
  }, [active, homeMode, isRunning, reconcileTerminalSnapshot, reconciled, startedAfterMs]);

  return null;
}

function parseAgUiEvent(data: string): AgUiEventPayload | undefined {
  try {
    const parsed = JSON.parse(data) as AgUiEventPayload;
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isCompletedAgUiEvent(event: AgUiEventPayload): boolean {
  return event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR;
}

function isStaleAgUiEvent(payload: AgUiEventPayload, startedAfterMs: number | null): boolean {
  if (!startedAfterMs || !payload.timestamp) return false;
  const timestampMs = typeof payload.timestamp === "number" ? payload.timestamp : Date.parse(payload.timestamp);
  return Number.isFinite(timestampMs) && timestampMs < startedAfterMs - 5_000;
}
