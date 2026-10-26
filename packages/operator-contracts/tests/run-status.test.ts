import { describe, expect, test } from "vitest";
import {
  assertRunTransition,
  canTransitionRunStatus,
  hasAssistantFinalMessageAfterLatestUser,
  RunTerminalUpdateSchema
} from "../src/index.js";

describe("run lifecycle contract", () => {
  test("allows expected active transitions and idempotent terminal writes", () => {
    expect(canTransitionRunStatus("queued", "running")).toBe(true);
    expect(canTransitionRunStatus("running", "succeeded")).toBe(true);
    expect(canTransitionRunStatus("failed", "failed")).toBe(true);
  });

  test("rejects terminal to active transitions", () => {
    expect(canTransitionRunStatus("succeeded", "running")).toBe(false);
    expect(() => assertRunTransition("failed", "queued")).toThrow(/Invalid Operator run status transition/);
  });

  test("requires failed terminal updates to carry OperatorError", () => {
    expect(() => RunTerminalUpdateSchema.parse({ status: "failed" })).toThrow();
    expect(
      RunTerminalUpdateSchema.parse({
        status: "failed",
        error: {
          code: "OPERATOR_RUNTIME_TIMEOUT",
          message: "Runtime timed out"
        }
      })
    ).toMatchObject({ status: "failed" });
  });
});

describe("message boundary contract", () => {
  test("does not treat previous assistant turns as current run completion", () => {
    const messages = [
      { role: "user" as const, content: "first task" },
      { role: "assistant" as const, content: "first answer" },
      { role: "user" as const, content: "second task" }
    ];

    expect(hasAssistantFinalMessageAfterLatestUser(messages)).toBe(false);
  });
});
