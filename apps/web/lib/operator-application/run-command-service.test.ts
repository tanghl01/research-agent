import { describe, expect, test } from "vitest";
import type { JobQueue, QueueJob, QueueJobResult, QueueName } from "@operator/queue";
import { executeOperatorRunCommand, resolveAgentRunExecutionMode, type OperatorAgentRunJobPayload } from "./run-command-service";

describe("Operator agent run command service", () => {
  test("uses queued execution by default in production", () => {
    expect(resolveAgentRunExecutionMode({ NODE_ENV: "production" })).toBe("queue");
    expect(resolveAgentRunExecutionMode({ NODE_ENV: "production", OPERATOR_ALLOW_IN_PROCESS_AGENT_RUN: "true" })).toBe("in-process");
    expect(resolveAgentRunExecutionMode({ NODE_ENV: "development" })).toBe("in-process");
    expect(resolveAgentRunExecutionMode({ OPERATOR_AGENT_RUN_EXECUTION_MODE: "queue" })).toBe("queue");
  });

  test("executes through the queue boundary when queue mode is selected", async () => {
    const result = {
      run_id: "run_1",
      status: "succeeded",
      response: "done",
      workspace: "tmp/runs/web/run_1",
      agent: {
        id: "test-agent",
        role: "default_main_execution_agent",
        runtime: "mastra-acp-agent",
        execution_status: "used",
        trace: [],
        fallback_used: false
      },
      selected_skills: [],
      runs: [],
      outputs: {
        chatRequest: "output/chat_request.json",
        chatPlan: "output/chat_plan.json",
        chatResult: "output/chat_result.json",
        artifactManifest: "output/artifact_manifest.json"
      }
    } as const;
    const queue = new FakeWaitQueue(result);

    await expect(
      executeOperatorRunCommand(
        {
          messages: [{ id: "m1", role: "user", content: "hello" }],
          attachments: [],
          runId: "run_1",
          workspace: "tmp/runs/web/run_1",
          onAgentTrace: () => undefined
        },
        {
          env: { OPERATOR_AGENT_RUN_EXECUTION_MODE: "queue" },
          queue
        }
      )
    ).resolves.toBe(result);

    expect(queue.calls).toEqual([
      {
        queue: "agent-run",
        name: "run-agent",
        payload: expect.objectContaining({ runId: "run_1", workspace: "tmp/runs/web/run_1" })
      }
    ]);
  });
});

class FakeWaitQueue implements JobQueue {
  readonly calls: Array<{ queue: QueueName; name: string; payload: OperatorAgentRunJobPayload }> = [];

  constructor(private readonly result: unknown) {}

  async enqueue<TPayload extends Record<string, unknown>>(queue: QueueName, name: string, payload: TPayload): Promise<QueueJob<TPayload>> {
    return {
      id: "job_1",
      queue,
      name,
      payload,
      createdAt: "2026-01-01T00:00:00.000Z"
    };
  }

  async enqueueAndWait<TPayload extends Record<string, unknown>, TResult = unknown>(
    queue: QueueName,
    name: string,
    payload: TPayload
  ): Promise<QueueJobResult<TPayload, TResult>> {
    this.calls.push({ queue, name, payload: payload as unknown as OperatorAgentRunJobPayload });
    return {
      job: await this.enqueue(queue, name, payload),
      result: this.result as TResult
    };
  }
}
