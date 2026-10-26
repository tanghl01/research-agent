import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "@operator/core";
import { afterEach, describe, expect, test } from "vitest";
import type { LegacyMastraChatResult } from "./legacy-mastra-chat-result";
import { loadOperatorTaskDetail, loadOperatorTaskMessagesPayload } from "./task-query-service";

const taskId = "test_task_query_service";
const workspace = path.join(repoRoot(), "tmp/runs/web", taskId);

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("Operator task query service", () => {
  test("projects legacy local run files into contract-backed task messages and snapshots", async () => {
    writeLegacyLocalRun({
      request: {
        run_id: "web_local",
        messages: [{ role: "user", content: "生成一份报告" }]
      },
      result: chatResult({ run_id: "web_local", response: "报告已生成" })
    });

    const messagesPayload = await loadOperatorTaskMessagesPayload({
      taskId,
      source: "browser-local",
      legacyLocalAccessAllowed: true
    });
    const detail = await loadOperatorTaskDetail({
      taskId,
      source: "browser-local",
      legacyLocalAccessAllowed: true
    });

    expect(messagesPayload.source).toBe("local");
    expect(messagesPayload.messages).toMatchObject([
      { role: "user", content: "生成一份报告" },
      { role: "assistant", content: expect.stringContaining("报告已生成") }
    ]);
    expect(detail.latestRun).toMatchObject({ runId: "web_local", status: "succeeded" });
    expect(detail.productEvents).toMatchObject([{ kind: "run.succeeded", runId: "web_local" }]);
  });
});

function writeLegacyLocalRun(params: {
  request: { run_id: string; messages: Array<{ role: "user" | "assistant" | "system"; content: string }> };
  result: LegacyMastraChatResult;
}) {
  const output = path.join(workspace, "output");
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, "chat_request.json"), JSON.stringify(params.request), "utf8");
  writeFileSync(path.join(output, "chat_result.json"), JSON.stringify(params.result), "utf8");
  writeFileSync(path.join(output, "artifact_manifest.json"), JSON.stringify({ artifacts: [] }), "utf8");
}

function chatResult(overrides: Partial<LegacyMastraChatResult> = {}): LegacyMastraChatResult {
  return {
    run_id: "web_local",
    status: "succeeded",
    response: "done",
    selected_skills: [],
    runs: [],
    workspace: "tmp/runs/web/test_task_query_service",
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
