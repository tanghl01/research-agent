import {
  EventSchemas,
  EventType,
  type AGUIEvent,
  type ActivitySnapshotEvent,
  type CustomEvent,
  type RunErrorEvent,
  type RunStartedEvent
} from "@ag-ui/core";

export type OperatorAgUiEvent = AGUIEvent;

export const AG_UI_EVENT_PART_TYPE = "data-ag-ui-event";
export const AG_UI_EVENT_PART_NAME = "ag-ui-event";
export const OPERATOR_PROGRESS_ACTIVITY_TYPE = "operator.progress";

export function agUiTimestamp(date: Date = new Date()): number {
  return date.getTime();
}

export function agUiEventPart(event: OperatorAgUiEvent): { type: typeof AG_UI_EVENT_PART_TYPE; data: OperatorAgUiEvent } {
  return { type: AG_UI_EVENT_PART_TYPE, data: event };
}

export function isOperatorAgUiEvent(value: unknown): value is OperatorAgUiEvent {
  return EventSchemas.safeParse(value).success;
}

export function buildProgressActivityEvent(params: {
  threadId: string;
  runId: string;
  startedAt: number;
  label: string;
  detail?: string;
  timestamp?: number;
}): ActivitySnapshotEvent {
  const timestamp = params.timestamp ?? agUiTimestamp();
  return {
    type: EventType.ACTIVITY_SNAPSHOT,
    timestamp,
    messageId: `${params.runId}:activity:progress`,
    activityType: OPERATOR_PROGRESS_ACTIVITY_TYPE,
    replace: true,
    content: {
      threadId: params.threadId,
      runId: params.runId,
      startedAt: params.startedAt,
      elapsedMs: Math.max(0, timestamp - params.startedAt),
      label: params.label,
      ...(params.detail ? { detail: params.detail } : {})
    }
  };
}

export function runStarted(threadId: string, runId: string, timestamp = agUiTimestamp()): RunStartedEvent {
  return {
    type: EventType.RUN_STARTED,
    threadId,
    runId,
    timestamp
  };
}

export function runError(message: string, code?: string, timestamp = agUiTimestamp()): RunErrorEvent {
  return {
    type: EventType.RUN_ERROR,
    timestamp,
    message,
    ...(code ? { code } : {})
  };
}

export function customEvent(name: string, value: unknown, timestamp = agUiTimestamp()): CustomEvent {
  return {
    type: EventType.CUSTOM,
    timestamp,
    name,
    value
  };
}
