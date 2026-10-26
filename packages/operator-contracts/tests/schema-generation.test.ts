import { describe, expect, test } from "vitest";
import {
  createOperatorAsyncApiDocument,
  createOperatorOpenApiDocument,
  ensureOperatorMessageIds,
  listOperatorToolCatalog,
  listUserScopeSelectionCatalog,
  RuntimeAdapterResultSchema,
  stableOperatorMessageId,
  TaskSnapshotSchema
} from "../src/index.js";

describe("contract schemas", () => {
  test("validates task snapshots and runtime results", () => {
    expect(
      TaskSnapshotSchema.parse({
        taskId: "task_1",
        exists: true,
        messages: [],
        events: [],
        productEvents: [],
        artifacts: []
      })
    ).toMatchObject({ taskId: "task_1", productEvents: [] });

    expect(() =>
      RuntimeAdapterResultSchema.parse({
        identity: {
          taskId: "task_1",
          conversationId: "conv_1",
          runId: "run_1",
          turnId: "turn_1",
          userMessageId: "msg_1"
        },
        status: "failed",
        output: {},
        artifacts: [],
        attempts: [],
        trace: [],
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:01:00.000Z"
      })
    ).toThrow(/failed runtime results require OperatorError/);
  });

  test("generates OpenAPI and AsyncAPI smoke documents", () => {
    const openapi = createOperatorOpenApiDocument();
    const asyncapi = createOperatorAsyncApiDocument();

    expect(openapi.openapi).toBe("3.1.0");
    expect(openapi.paths["/api/operator/task-detail"]).toBeTruthy();
    expect(openapi.paths["/api/operator/task-messages"]).toBeTruthy();
    expect(openapi.paths["/api/operator/chat"]).toBeTruthy();
    expect(openapi.paths["/api/operator/task-events"]).toBeTruthy();
    expect(openapi.components.schemas.TaskSnapshot).toBeTruthy();
    expect(openapi.components.schemas.TaskMessagesResponse).toBeTruthy();
    expect(openapi.components.schemas.ProductEvent).toBeTruthy();

    expect(asyncapi.asyncapi).toBe("3.0.0");
    expect(asyncapi.components.schemas.ProductEvent).toBeTruthy();
    expect(asyncapi.components.schemas.RunReconcileJobPayload).toBeTruthy();
    expect(asyncapi.channels.taskAgUiEvents).toBeTruthy();
    expect(asyncapi.channels.runReconciliationJobs).toBeTruthy();
    expect(asyncapi.channels.productEvents).toBeTruthy();
  });

  test("normalizes conversation message ids through contracts", () => {
    const message = { role: "user" as const, content: "hello" };
    expect(stableOperatorMessageId("scope", message, 0)).toBe("legacy_scope_0_user_1n1e4y");
    expect(ensureOperatorMessageIds([message], "scope")).toEqual([{ id: "legacy_scope_0_user_1n1e4y", role: "user", content: "hello" }]);
  });

  test("exposes Operator knowledge tools in the user-facing catalog", () => {
    const expectedToolIds = [
      "operator.knowledge.fetch",
      "operator.knowledge.fill_template",
      "operator.knowledge.find_template",
      "operator.knowledge.search"
    ];

    expect(listOperatorToolCatalog().map((tool) => tool.id).sort()).toEqual(expectedToolIds);
    expect(listUserScopeSelectionCatalog().tools.map((tool) => tool.id).sort()).toEqual(expectedToolIds);
  });
});
