import { EventType } from "@ag-ui/core";
import type { OperatorAgUiEvent } from "./ag-ui";

export const OPERATOR_TASK_AG_UI_SSE_EVENT = "ag-ui-event";

export type OperatorTaskAgUiEvent = {
  taskId: string;
  event: OperatorAgUiEvent;
  source: "live" | "persisted";
};

export function isTerminalOperatorTaskAgUiEvent(event: unknown): event is OperatorAgUiEvent {
  if (!isRecord(event)) return false;
  return event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR;
}

export function operatorTaskAgUiEventTimestamp(event: OperatorAgUiEvent): number {
  return typeof event.timestamp === "number" && Number.isFinite(event.timestamp) ? event.timestamp : Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
