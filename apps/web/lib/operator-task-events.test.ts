import { EventType } from "@ag-ui/core";
import { afterEach, describe, expect, test } from "vitest";
import {
  LocalOperatorTaskAgUiEventBus,
  createOperatorTaskAgUiEventBus,
  isTerminalOperatorTaskAgUiEvent,
  operatorTaskAgUiEventChannel,
  publishOperatorTaskAgUiEvent,
  setOperatorTaskAgUiEventBusForTests,
  subscribeOperatorTaskAgUiEvents
} from "./operator-task-events";

describe("Operator task AG-UI event bus", () => {
  afterEach(() => {
    setOperatorTaskAgUiEventBusForTests(undefined);
  });

  test("publishes AG-UI terminal events through the configured event bus", async () => {
    setOperatorTaskAgUiEventBusForTests(new LocalOperatorTaskAgUiEventBus());
    const event = {
      type: EventType.RUN_FINISHED as const,
      threadId: "task_1",
      runId: "run_1",
      timestamp: Date.now(),
      outcome: { type: "success" as const }
    };

    const received = await new Promise((resolve) => {
      const unsubscribe = subscribeOperatorTaskAgUiEvents("task_1", (payload) => {
        unsubscribe();
        resolve(payload.event);
      });
      void publishOperatorTaskAgUiEvent({ taskId: "task_1", event, source: "live" });
    });

    expect(received).toMatchObject({ type: EventType.RUN_FINISHED, runId: "run_1" });
    expect(isTerminalOperatorTaskAgUiEvent(received)).toBe(true);
    expect(isTerminalOperatorTaskAgUiEvent({ type: ["operator", "task_status"].join(".") })).toBe(false);
  });

  test("isolates server task events by authorized account scope", async () => {
    setOperatorTaskAgUiEventBusForTests(new LocalOperatorTaskAgUiEventBus());
    const event = {
      type: EventType.RUN_FINISHED as const,
      threadId: "task_1",
      runId: "run_1",
      timestamp: Date.now(),
      outcome: { type: "success" as const }
    };
    const aliceChannel = operatorTaskAgUiEventChannel({
      userId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000010",
      conversationId: "00000000-0000-4000-8000-000000000100",
      taskId: "task_1"
    });
    const bobChannel = operatorTaskAgUiEventChannel({
      userId: "00000000-0000-4000-8000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000020",
      conversationId: "00000000-0000-4000-8000-000000000200",
      taskId: "task_1"
    });
    const received: unknown[] = [];
    const unsubscribe = subscribeOperatorTaskAgUiEvents(
      "task_1",
      (payload) => {
        received.push(payload.event);
      },
      { channelId: bobChannel }
    );

    await publishOperatorTaskAgUiEvent({ taskId: "task_1", event, source: "live" }, { channelId: aliceChannel });
    unsubscribe();

    expect(received).toEqual([]);
  });

  test("requires Redis for production task AG-UI events", () => {
    expect(() => createOperatorTaskAgUiEventBus({ NODE_ENV: "production" })).toThrow(/REDIS_URL is required/u);
  });
});
