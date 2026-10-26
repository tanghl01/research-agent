import { describe, expect, it } from "vitest";
import { DisabledJobQueue, DisabledJobWorker } from "../src/types.js";
import { createJobQueueFromEnv, createJobWorkerFromEnv, RedisJobQueue } from "../src/redis-adapter.js";

describe("DisabledJobQueue", () => {
  it("keeps enqueue calls observable without requiring a queue backend", async () => {
    const queue = new DisabledJobQueue();
    const job = await queue.enqueue("agent-run", "run-agent", { runId: "run_1" });

    expect(job.id).toMatch(/^disabled-/u);
    expect(job.queue).toBe("agent-run");
    expect(job.name).toBe("run-agent");
    expect(job.payload).toEqual({ runId: "run_1" });
  });

  it("does not fake worker results", async () => {
    const queue = new DisabledJobQueue();
    await expect(queue.enqueueAndWait("agent-run", "run-agent", { runId: "run_1" })).rejects.toThrow(/disabled/u);
  });
});

describe("RedisJobQueue", () => {
  it("enqueues through a BullMQ-compatible queue", async () => {
    const calls: Array<{ queue: string; name: string; payload: Record<string, unknown> }> = [];
    const queue = new RedisJobQueue({
      queueFactory(name) {
        return {
          async add(jobName, payload) {
            calls.push({ queue: name, name: jobName, payload });
            return { id: "job-1", timestamp: Date.parse("2026-01-01T00:00:00.000Z") };
          },
          async close() {}
        };
      }
    });

    const job = await queue.enqueue("agent-run", "run-agent", { runId: "run_1" });
    await queue.close();

    expect(job).toEqual({
      id: "job-1",
      queue: "agent-run",
      name: "run-agent",
      payload: { runId: "run_1" },
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    expect(calls).toEqual([{ queue: "agent-run", name: "run-agent", payload: { runId: "run_1" } }]);
  });

  it("uses the disabled queue when REDIS_URL is not configured", () => {
    expect(createJobQueueFromEnv({})).toBeInstanceOf(DisabledJobQueue);
    expect(createJobQueueFromEnv({ REDIS_URL: "redis://localhost:6379" })).toBeInstanceOf(RedisJobQueue);
  });

  it("uses the disabled worker when REDIS_URL is not configured", () => {
    expect(createJobWorkerFromEnv("agent-run", async () => {}, {})).toBeInstanceOf(DisabledJobWorker);
  });

  it("rejects disabled production queues unless explicitly allowed", () => {
    expect(() => createJobQueueFromEnv({ NODE_ENV: "production" })).toThrow(/REDIS_URL is required/);
    expect(createJobQueueFromEnv({ NODE_ENV: "production", OPERATOR_ALLOW_DISABLED_QUEUE: "true" })).toBeInstanceOf(DisabledJobQueue);
  });
});
