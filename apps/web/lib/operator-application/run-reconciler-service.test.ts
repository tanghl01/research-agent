import type { JobQueue, QueueJob } from "@operator/queue";
import type { RunReconcileJobPayload } from "@operator/contracts";
import { describe, expect, test } from "vitest";
import { enqueueRunReconciliation } from "./run-reconciler-service";

describe("Operator run reconciler service", () => {
  test("enqueues reconciliation through the configured queue boundary", async () => {
    const enqueued: Array<{ queue: string; name: string; payload: RunReconcileJobPayload }> = [];
    const queue: JobQueue = {
      async enqueue(queueName, jobName, payload) {
        enqueued.push({ queue: queueName, name: jobName, payload: payload as unknown as RunReconcileJobPayload });
        return {
          id: "job_1",
          queue: queueName,
          name: jobName,
          payload,
          createdAt: "2026-01-01T00:00:00.000Z"
        } satisfies QueueJob<typeof payload>;
      }
    };

    await enqueueRunReconciliation(
      {
        taskId: "task_1",
        conversationId: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        userId: "00000000-0000-4000-8000-000000000003",
        reason: "test"
      },
      queue
    );

    expect(enqueued).toEqual([
      {
        queue: "workflow-run",
        name: "reconcile-run",
        payload: {
          taskId: "task_1",
          conversationId: "00000000-0000-4000-8000-000000000001",
          projectId: "00000000-0000-4000-8000-000000000002",
          userId: "00000000-0000-4000-8000-000000000003",
          reason: "test"
        }
      }
    ]);
  });
});
