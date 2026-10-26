import { describe, expect, test } from "vitest";
import type { LegacyMastraChatResult } from "../operator-application/legacy-mastra-chat-result";
import {
  createServerAgentRunPersistence,
  runEventsToAgUiEvents,
  runEventsToTrace,
  type ServerAgentRunEventRecord,
  type ServerAgentRunRecord,
  type ServerRunStore,
  taskRunDetailFromRecords
} from "./runs";

const runId = "00000000-0000-4000-8000-000000000101";
const conversationId = "00000000-0000-4000-8000-000000000102";

describe("Operator server agent run persistence", () => {
  test("maps run events into preview trace rows", () => {
    const trace = runEventsToTrace([
      eventRecord("RUN_STARTED", { timestamp: "2026-06-16T00:00:00.000Z" }),
      eventRecord("ACTIVITY_SNAPSHOT", {
        timestamp: Date.parse("2026-06-16T00:00:01.000Z"),
        messageId: "web_123:activity:progress",
        activityType: "operator.progress",
        replace: true,
        content: {
          label: "Agent 正在执行",
          detail: "等待实时输出"
        }
      }),
      eventRecord("CUSTOM", {
        name: "operator.agent_trace",
        value: {
          kind: "observation",
          label: "读取完成",
          detail: "loaded file",
          tool: "read_file"
        }
      })
    ]);

    expect(trace).toEqual([
      { kind: "action", label: "运行开始", timestamp: "2026-06-16T00:00:00.000Z" },
      {
        kind: "action",
        label: "Agent 正在执行",
        detail: "等待实时输出",
        timestamp: "2026-06-16T00:00:01.000Z"
      },
      {
        kind: "observation",
        label: "读取完成",
        detail: "loaded file",
        tool: "read_file",
        timestamp: "2026-06-16T00:00:00.000Z"
      }
    ]);
  });

  test("keeps a running task in the plan phase without final result", () => {
    const detail = taskRunDetailFromRecords({
      taskId: "task_local_1",
      run: runRecord({ status: "running" }),
      events: [
        eventRecord("RUN_STARTED", { type: "RUN_STARTED", timestamp: "2026-06-16T00:00:00.000Z" }),
        eventRecord("ACTIVITY_SNAPSHOT", {
          type: "ACTIVITY_SNAPSHOT",
          messageId: "web_123:activity:progress",
          activityType: "operator.progress",
          replace: true,
          content: { label: "Agent 正在执行", elapsedMs: 1000 }
        })
      ],
      messages: [{ id: "request-user", role: "user", content: "hello" }]
    });
    const compatibility = serverCompatibility(detail);

    expect(detail).toMatchObject({
      exists: true,
      backend: "server"
    });
    expect(compatibility).toMatchObject({
      plan: { phase: "running" },
      request: {
        run_id: "web_123",
        messages: [{ role: "user", content: "hello" }]
      }
    });
    expect(detail.agUiEvents).toMatchObject([
      { type: "RUN_STARTED", threadId: "task_local_1", runId: "web_123" },
      { type: "ACTIVITY_SNAPSHOT", activityType: "operator.progress", content: { label: "Agent 正在执行" } }
    ]);
    expect(compatibility.result).toBeUndefined();
  });

  test("rebuilds resumable AG-UI events from persisted run events", () => {
    const events = runEventsToAgUiEvents(
      [
        eventRecord("RUN_STARTED", { timestamp: "2026-06-16T00:00:00.000Z" }),
        eventRecord("CUSTOM", {
          type: "CUSTOM",
          name: "operator.agent_trace",
          value: { kind: "action", label: "Agent tool call", detail: "web search" }
        }),
        eventRecord("ACTIVITY_SNAPSHOT", {
          type: "ACTIVITY_SNAPSHOT",
          messageId: "web_restore:activity:progress",
          activityType: "operator.progress",
          replace: true,
          content: { label: "Agent 正在执行", detail: "等待实时输出", elapsedMs: 3000 }
        })
      ],
      { threadId: "task_restore", runId: "web_restore", startedAt: "2026-06-16T00:00:00.000Z" }
    );

    expect(events).toMatchObject([
      { type: "RUN_STARTED", threadId: "task_restore", runId: "web_restore" },
      {
        type: "CUSTOM",
        name: "operator.agent_trace",
        value: { label: "Agent tool call", detail: "web search" }
      },
      {
        type: "ACTIVITY_SNAPSHOT",
        activityType: "operator.progress",
        content: {
          label: "Agent 正在执行",
          detail: "等待实时输出",
          elapsedMs: 3000
        }
      }
    ]);
  });

  test("exposes succeeded run output as a task preview result", () => {
    const result = chatResult({ status: "succeeded", response: "done" });
    const detail = taskRunDetailFromRecords({
      taskId: "task_local_1",
      run: runRecord({
        status: "succeeded",
        output: {
          clientRunId: "web_123",
          assistantText: "done",
          result
        }
      }),
      events: [eventRecord("RUN_FINISHED", {})],
      messages: []
    });
    const compatibility = serverCompatibility(detail);

    expect(compatibility.result).toMatchObject({
      run_id: "web_123",
      status: "succeeded",
      response: "done"
    });
    expect(detail.latestRun).toMatchObject({
      runId: "web_123",
      status: "succeeded"
    });
    expect(detail.productEvents).toMatchObject([{ kind: "run.succeeded", type: "operator.run.succeeded" }]);
    expect(detail.agUiEvents).toMatchObject([{ type: "RUN_FINISHED", runId: "web_123" }]);
  });

  test("exposes failed run errors", () => {
    const detail = taskRunDetailFromRecords({
      taskId: "task_local_1",
      run: runRecord({
        status: "failed",
        error: {
          message: "worker failed",
          code: "WORKER_FAILED",
          detail: "exit 1"
        }
      }),
      events: [eventRecord("RUN_ERROR", { message: "worker failed", code: "WORKER_FAILED" })],
      messages: []
    });
    const compatibility = serverCompatibility(detail);

    expect(compatibility.plan).toMatchObject({
      phase: "failed",
      error: "worker failed",
      error_code: "WORKER_FAILED",
      error_detail: "exit 1"
    });
    expect(compatibility.result).toMatchObject({
      status: "failed",
      agent: {
        error: "worker failed",
        error_code: "WORKER_FAILED",
        error_detail: "exit 1"
      }
    });
  });

  test("terminal persistence appends a terminal event", async () => {
    const appendedEvents: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const updates: Array<{ status: string; finishedAt?: string }> = [];
    const createdRuns: Array<{ createdBy: string; workspace: string }> = [];
    const store: ServerRunStore = {
      async createAgentRun(params) {
        createdRuns.push({ createdBy: params.createdBy, workspace: params.workspace });
        return runRecord();
      },
      async appendAgentRunEvent(params) {
        appendedEvents.push({ kind: params.kind, payload: params.payload });
        return eventRecord(params.kind, params.payload);
      },
      async updateAgentRun(params) {
        updates.push({ status: params.status, finishedAt: params.finishedAt });
        return runRecord({ status: params.status, finished_at: params.finishedAt ?? null });
      },
      async findLatestAgentRun() {
        return runRecord();
      },
      async listAgentRunEvents() {
        return [];
      },
      async listArtifactsForRun() {
        return [];
      },
      async listMessages() {
        return [];
      }
    };

    const persistence = await createServerAgentRunPersistence({
      userId: "00000000-0000-4000-8000-000000000300",
      project: {
        id: "00000000-0000-4000-8000-000000000100",
        org_id: "00000000-0000-4000-8000-000000000200",
        name: "default",
        workspace_type: "operator-web",
        status: "active",
        created_by: "00000000-0000-4000-8000-000000000300",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      },
      conversation: {
        id: conversationId,
        project_id: "00000000-0000-4000-8000-000000000100",
        client_task_id: "task_local_1",
        title: "Task",
        status: "active",
        created_by: "00000000-0000-4000-8000-000000000300",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      },
      runId: "web_123",
      workspace:
        "tmp/runs/web/users/00000000-0000-4000-8000-000000000300/projects/00000000-0000-4000-8000-000000000100/conversations/00000000-0000-4000-8000-000000000102/runs/web_123",
      messages: [],
      store
    });

    await persistence.markSucceeded(chatResult({ status: "succeeded" }), "done");

    expect(createdRuns).toEqual([
      {
        createdBy: "00000000-0000-4000-8000-000000000300",
        workspace:
          "tmp/runs/web/users/00000000-0000-4000-8000-000000000300/projects/00000000-0000-4000-8000-000000000100/conversations/00000000-0000-4000-8000-000000000102/runs/web_123"
      }
    ]);
    expect(updates).toMatchObject([{ status: "succeeded" }]);
    expect(appendedEvents).toMatchObject([{ kind: "RUN_FINISHED", payload: { type: "RUN_FINISHED", runId: "web_123" } }]);
  });
});

function runRecord(overrides: Partial<ServerAgentRunRecord> = {}): ServerAgentRunRecord {
  return {
    id: runId,
    project_id: "00000000-0000-4000-8000-000000000100",
    conversation_id: conversationId,
    workflow_run_id: null,
    agent_id: "operator-chat",
    agent_version: "0.1.0",
    status: "running",
    input: { clientRunId: "web_123" },
    output: {},
    error: null,
    workspace: "tmp/runs/web/task_local_1",
    created_by: "00000000-0000-4000-8000-000000000300",
    started_at: "2026-06-16T00:00:00.000Z",
    finished_at: null,
    created_at: "2026-06-16T00:00:00.000Z",
    updated_at: "2026-06-16T00:00:00.000Z",
    ...overrides
  };
}

function eventRecord(kind: string, payload: Record<string, unknown>): ServerAgentRunEventRecord {
  return {
    id: crypto.randomUUID(),
    agent_run_id: runId,
    seq: 1,
    kind,
    payload,
    created_at: "2026-06-16T00:00:00.000Z"
  };
}

function chatResult(overrides: Partial<LegacyMastraChatResult> = {}): LegacyMastraChatResult {
  return {
    run_id: "web_123",
    status: "succeeded",
    response: "done",
    selected_skills: [],
    runs: [],
    workspace: "tmp/runs/web/task_local_1",
    outputs: {
      chatRequest: "output/chat_request.json",
      chatPlan: "output/chat_plan.json",
      chatResult: "output/chat_result.json",
      artifactManifest: "output/artifact_manifest.json"
    },
    agent: {
      id: "operator-chat",
      role: "default_main_execution_agent",
      runtime: "mastra-acp-agent",
      execution_status: "used",
      conversation_ids: [],
      trace: [],
      fallback_used: false
    },
    ...overrides
  };
}

function serverCompatibility(detail: { compatibility?: Record<string, unknown> }) {
  return (detail.compatibility ?? {}) as {
    request?: unknown;
    plan?: unknown;
    events?: unknown;
    result?: unknown;
  };
}
