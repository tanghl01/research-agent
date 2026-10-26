import { buildProgressActivityEvent, type OperatorAgUiEvent } from "../ag-ui";

export type OperatorRunProgressEmitter = {
  emit(label: string, detail?: string): OperatorAgUiEvent;
  startHeartbeat(label: string, detail?: string, intervalMs?: number): void;
  stop(): void;
};

export function createOperatorRunProgressEmitter(params: {
  threadId: string;
  runId: string;
  startedAtMs: number;
  onEvent: (event: OperatorAgUiEvent) => void;
}): OperatorRunProgressEmitter {
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  const emit = (label: string, detail?: string): OperatorAgUiEvent => {
    const event = buildProgressActivityEvent({
      threadId: params.threadId,
      runId: params.runId,
      startedAt: params.startedAtMs,
      label,
      detail
    });
    params.onEvent(event);
    return event;
  };

  return {
    emit,
    startHeartbeat(label, detail, intervalMs = 30_000) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => emit(label, detail), intervalMs);
      if (typeof heartbeatTimer === "object" && "unref" in heartbeatTimer) heartbeatTimer.unref();
    },
    stop() {
      if (!heartbeatTimer) return;
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };
}
