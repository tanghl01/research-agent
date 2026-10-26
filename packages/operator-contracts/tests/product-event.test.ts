import { describe, expect, test } from "vitest";
import { createProductEvent, productEventSubject, productEventType, ProductEventSchema } from "../src/index.js";

describe("product event contract", () => {
  test("creates a CloudEvents-compatible envelope", () => {
    const event = createProductEvent({
      source: "/operator/web",
      taskId: "task_1",
      runId: "run_1",
      kind: "run.succeeded",
      payload: { response: "done" },
      timestamp: "2026-01-01T00:00:00.000Z"
    });

    expect(event).toMatchObject({
      specversion: "1.0",
      source: "/operator/web",
      subject: productEventSubject("task_1", "run_1"),
      type: productEventType("run.succeeded"),
      time: "2026-01-01T00:00:00.000Z",
      data: { response: "done" },
      payload: { response: "done" }
    });
    expect(ProductEventSchema.parse(event)).toEqual(event);
  });
});
