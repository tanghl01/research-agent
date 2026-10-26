import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadDotenv, repoRoot, syncCapability } from "@operator/core";
import { describe, expect, test } from "vitest";
import { runOperatorChat } from "../src/chat.js";
import { listMastraWorkspaceSkills } from "../src/workspace.js";

loadDotenv();

const pptIntegrationTest = process.env.OPERATOR_RUN_PPT_INTEGRATION === "1" ? test : test.skip;

describe("Operator chat runtime", () => {
  test("handles plain text user requests without a scope tag", async () => {
    const previous = captureAgentEnv();
    const workspace = `tmp/test-runs/operator-chat-user-smoke-text-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);

    try {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      await configureFakeAcpAgent(workspace, {
        OPERATOR_TEST_FAKE_ACP_RESPONSE: "文字需求已正常响应：这是给终端用户看的回答。"
      });

      const result = await runOperatorChat({
        workspace,
        prompt: "用三句话解释什么是CRISPR。"
      });

      expect(result.status).toBe("succeeded");
      expect(result.selected_skills).toEqual([]);
      expect(result.agent.runtime).toBe("mastra-acp-agent");
      expect(result.response).toContain("文字需求已正常响应");
      expect(existsSync(path.join(result.workspace, result.outputs.chatResult))).toBe(true);
    } finally {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      restoreAgentEnv(previous);
    }
  });

  test("passes uploaded file context to the ACP agent and strips attachment bodies from chat metadata", async () => {
    const previous = captureAgentEnv();
    const workspace = `tmp/test-runs/operator-chat-user-smoke-upload-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);

    try {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      await configureFakeAcpAgent(workspace, {
        OPERATOR_TEST_FAKE_ACP_RESPONSE: "已读取上传文件，并给出摘要。",
        OPERATOR_TEST_FAKE_ACP_CAPTURE_PROMPT_PATH: "runs/fake-acp/prompt.txt"
      });

      const result = await runOperatorChat({
        workspace,
        prompt: "请总结我上传的实验记录。",
        attachments: [
          {
            path: "input/attachments/experiment-note.txt",
            filename: "experiment-note.txt",
            mimeType: "text/plain",
            sizeBytes: 24,
            sha256: "test-sha",
            contentBase64: Buffer.from("sample experiment note").toString("base64")
          }
        ]
      });

      const chatRequest = readJsonArtifact<{
        uploaded_attachments?: Array<{ path?: string; filename?: string; contentBase64?: string }>;
      }>(result.workspace, result.outputs.chatRequest);
      const promptCapture = readFileSync(path.join(result.workspace, "runs/fake-acp/prompt.txt"), "utf8");

      expect(result.status).toBe("succeeded");
      expect(result.response).toContain("已读取上传文件");
      expect(promptCapture).toContain("input/attachments/experiment-note.txt");
      expect(promptCapture).toContain("experiment-note.txt");
      expect(promptCapture).not.toContain(Buffer.from("sample experiment note").toString("base64"));
      expect(chatRequest.uploaded_attachments?.[0]).toMatchObject({
        path: "input/attachments/experiment-note.txt",
        filename: "experiment-note.txt"
      });
      expect(chatRequest.uploaded_attachments?.[0]?.contentBase64).toBeUndefined();
    } finally {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      restoreAgentEnv(previous);
    }
  });

  test("fails honestly when no default main agent is configured", async () => {
    const previous = captureAgentEnv();
    const workspace = `tmp/test-runs/operator-chat-no-acp-agent-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);

    try {
      process.env.OPERATOR_DEFAULT_AGENT_SCOPE = "";
      process.env.OPERATOR_DEFAULT_AGENT_ID = "";
      process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON = "";
      process.env.OPERATOR_ACP_AGENTS_JSON = "";
      process.env.OPERATOR_AGENT_FALLBACK_ORDER = "";
      process.env.OPERATOR_ACP_AGENT_FALLBACK_ORDER = "";
      clearPrefixedAcpEnv();
      rmSync(absoluteWorkspace, { recursive: true, force: true });

      const result = await runOperatorChat({
        workspace,
        prompt: "写一段 RSA 示例代码"
      });

      expect(result.status).toBe("failed");
      expect(result.agent.id).toBe("codex-acp");
      expect(result.agent.runtime).toBe("mastra-acp-agent");
      expect(result.agent.error).toContain("No main agent is configured");
      expect(result.selected_skills).toEqual([]);
      expect(result.runs).toEqual([]);
      const plan = readJsonArtifact<{
        phase?: string;
        candidate_agent_ids?: string[];
        attempted_agent_ids?: string[];
      }>(result.workspace, result.outputs.chatPlan);
      expect(plan.phase).toBe("main_agent");
      expect(plan.candidate_agent_ids?.[0]).toBe("codex-acp");
      expect(plan.attempted_agent_ids).toEqual([]);
    } finally {
      restoreAgentEnv(previous);
    }
  });

  test("only includes current-run direct artifacts in reused task workspaces", async () => {
    const previous = captureAgentEnv();
    const workspace = `tmp/test-runs/operator-chat-reused-workspace-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);

    try {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      mkdirSync(absoluteWorkspace, { recursive: true });
      writeFileSync(path.join(absoluteWorkspace, "floorplan_85sqm_2br2hall.png"), Buffer.from("old image"));
      await configureFakeAcpAgent(workspace, {
        OPERATOR_TEST_FAKE_ACP_RESPONSE: "已生成 `adder_8bit.v`。",
        OPERATOR_TEST_FAKE_ACP_WORKSPACE_FILES: JSON.stringify([
          {
            path: "adder_8bit.v",
            content: "module adder_8bit; endmodule\n"
          }
        ])
      });

      const result = await runOperatorChat({
        workspace,
        prompt: "写一段加法器的verilog代码"
      });
      const manifest = readJsonArtifact<{
        artifacts?: Array<{ path: string }>;
      }>(result.workspace, result.outputs.artifactManifest);
      const paths = manifest.artifacts?.map((artifact) => artifact.path) ?? [];

      expect(result.status).toBe("succeeded");
      expect(paths).toContain("adder_8bit.v");
      expect(paths).not.toContain("floorplan_85sqm_2br2hall.png");
    } finally {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      restoreAgentEnv(previous);
    }
  });

  test("stores chat metadata in run-scoped paths for reused task workspaces", async () => {
    const previous = captureAgentEnv();
    const workspace = `tmp/test-runs/operator-chat-run-scoped-output-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);

    try {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      await configureFakeAcpAgent(workspace, {
        OPERATOR_TEST_FAKE_ACP_RESPONSE: "run {{run_id}} done"
      });

      const first = await runOperatorChat({ workspace, runId: "web_first", prompt: "first" });
      const second = await runOperatorChat({ workspace, runId: "web_second", prompt: "second" });
      const firstResult = readJsonArtifact<{ run_id?: string; response?: string }>(first.workspace, first.outputs.chatResult);
      const secondResult = readJsonArtifact<{ run_id?: string; response?: string }>(second.workspace, second.outputs.chatResult);

      expect(first.outputs.chatResult).toBe("runs/chat/web_first/output/chat_result.json");
      expect(second.outputs.chatResult).toBe("runs/chat/web_second/output/chat_result.json");
      expect(firstResult).toMatchObject({ run_id: "web_first", response: "run web_first done" });
      expect(secondResult).toMatchObject({ run_id: "web_second", response: "run web_second done" });
      expect(existsSync(path.join(first.workspace, "output/chat_result.json"))).toBe(false);
    } finally {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      restoreAgentEnv(previous);
    }
  });

  test("persists a failed result when the main agent times out", async () => {
    const previous = captureAgentEnv();
    const workspace = `tmp/test-runs/operator-chat-timeout-result-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);

    try {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      await configureFakeAcpAgent(workspace, {
        OPERATOR_TEST_FAKE_ACP_HANG: "1"
      });

      const result = await runOperatorChat({
        workspace,
        runId: "web_timeout",
        prompt: "simulate a long agent run",
        timeoutMs: 20
      });
      const plan = readJsonArtifact<{ execution_status?: string; error?: string }>(result.workspace, result.outputs.chatPlan);
      const manifest = readJsonArtifact<{ artifacts?: Array<{ path: string }> }>(result.workspace, result.outputs.artifactManifest);
      const paths = manifest.artifacts?.map((artifact) => artifact.path) ?? [];

      expect(result.status).toBe("failed");
      expect(result.agent.error ?? "").toMatch(/timed out|aborted|cancelled|stopped before completing/iu);
      expect(plan.execution_status).toBe("failed");
      expect(plan.error ?? "").toMatch(/timed out|aborted|cancelled|stopped before completing/iu);
      expect(existsSync(path.join(result.workspace, result.outputs.chatRequest))).toBe(true);
      expect(existsSync(path.join(result.workspace, result.outputs.chatPlan))).toBe(true);
      expect(existsSync(path.join(result.workspace, result.outputs.chatResult))).toBe(true);
      expect(existsSync(path.join(result.workspace, result.outputs.artifactManifest))).toBe(true);
      expect(paths).toContain("runs/chat/web_timeout/output/chat_request.json");
      expect(paths).toContain("runs/chat/web_timeout/output/chat_plan.json");
      expect(paths).toContain("runs/chat/web_timeout/output/chat_result.json");
    } finally {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      restoreAgentEnv(previous);
    }
  });

  test("does not register runtime dependency caches as direct artifacts", async () => {
    const previous = captureAgentEnv();
    const workspace = `tmp/test-runs/operator-chat-runtime-cache-artifacts-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);

    try {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      await configureFakeAcpAgent(workspace, {
        OPERATOR_TEST_FAKE_ACP_RESPONSE: "已生成 runs/example/output/result.md",
        OPERATOR_TEST_FAKE_ACP_WORKSPACE_FILES: JSON.stringify([
          {
            path: "runs/example/work/.venv/lib/python3.12/site-packages/pkg/cache.py",
            content: "cache = True\n"
          },
          {
            path: "runs/example/work/build_result.py",
            content: "print('internal helper')\n"
          },
          {
            path: "runs/example/output/result.md",
            content: "# Result\n"
          }
        ])
      });

      const result = await runOperatorChat({
        workspace,
        prompt: "generate a report"
      });
      const manifest = readJsonArtifact<{
        artifacts?: Array<{ path: string }>;
      }>(result.workspace, result.outputs.artifactManifest);
      const paths = manifest.artifacts?.map((artifact) => artifact.path) ?? [];

      expect(result.status).toBe("succeeded");
      expect(paths).toContain("runs/example/output/result.md");
      expect(paths).not.toContain("runs/example/work/build_result.py");
      expect(paths.some((artifactPath) => artifactPath.includes(".venv"))).toBe(false);
      expect(paths.some((artifactPath) => artifactPath.includes("site-packages"))).toBe(false);
    } finally {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      restoreAgentEnv(previous);
    }
  });

  test("records image-generation intent in standard ACP chat context without proxy model policy", async () => {
    const previous = captureAgentEnv();
    const workspace = `tmp/test-runs/operator-chat-image-context-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);

    try {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      await configureFakeAcpAgent(workspace, {
        OPERATOR_TEST_FAKE_ACP_RESPONSE: "已调用图像模型生成孙悟空图片。",
        OPERATOR_TEST_FAKE_ACP_WORKSPACE_FILES: JSON.stringify([
          {
            path: "output/sun-wukong.png",
            content: "fake png"
          }
        ])
      });

      const result = await runOperatorChat({
        workspace,
        prompt: "生成一张孙悟空的图片"
      });

      expect(result.status).toBe("succeeded");
      expect(result.response).toContain("孙悟空图片");
      expect(result.agent.fallback_used).toBe(false);
      const chatRequest = readJsonArtifact<{
        codex_model_policy?: string;
        image_generation_requested?: boolean;
      }>(result.workspace, result.outputs.chatRequest);
      expect(chatRequest.codex_model_policy).toBeUndefined();
      expect(chatRequest.image_generation_requested).toBe(true);
      expect(existsSync(path.join(result.workspace, "output/sun-wukong.png"))).toBe(true);
      const manifest = readJsonArtifact<{
        artifacts?: Array<{ path: string }>;
      }>(result.workspace, result.outputs.artifactManifest);
      expect(manifest.artifacts?.map((artifact) => artifact.path)).toContain("output/sun-wukong.png");
    } finally {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      restoreAgentEnv(previous);
    }
  });

  test("keeps plain latest chat messages out of image-generation context", async () => {
    const previous = captureAgentEnv();
    const workspace = `tmp/test-runs/operator-chat-image-history-context-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);

    try {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      await configureFakeAcpAgent(workspace, {
        OPERATOR_TEST_FAKE_ACP_RESPONSE: "普通文字任务已完成。"
      });

      const result = await runOperatorChat({
        workspace,
        messages: [
          { id: "image-history-user", role: "user", content: "生成一张孙悟空的图片" },
          { id: "image-history-assistant", role: "assistant", content: "已生成图片。" },
          { id: "image-followup-user", role: "user", content: "继续用文字总结刚才的要点。" }
        ]
      });

      expect(result.status).toBe("succeeded");
      expect(result.response).toContain("普通文字任务已完成");
      const chatRequest = readJsonArtifact<{
        codex_model_policy?: string;
        image_generation_requested?: boolean;
      }>(result.workspace, result.outputs.chatRequest);
      expect(chatRequest.codex_model_policy).toBeUndefined();
      expect(chatRequest.image_generation_requested).toBe(false);
    } finally {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      restoreAgentEnv(previous);
    }
  });

  test("exposes scope-scoped tag runs to the selected skill while using the ACP main agent", async () => {
    const previous = captureAgentEnv();
    const workspace = `tmp/test-runs/operator-chat-scope-context-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);

    try {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      await configureFakeAcpAgent(workspace, {
        OPERATOR_TEST_FAKE_ACP_RESPONSE: "范围标签任务已处理。"
      });

      const result = await runOperatorChat({
        workspace,
        scopeId: "gorden-ppt-skill",
        prompt: "测试标签范围上下文"
      });

      expect(result.status).toBe("succeeded");
      expect(result.response).toContain("范围标签任务已处理");
      expect(result.selected_skills.map((skill) => skill.skill)).toEqual(["gorden-ppt-skill"]);
      expect(result.agent.runtime).toBe("mastra-acp-agent");
      expect(result.agent.fallback_used).toBe(false);
    } finally {
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      restoreAgentEnv(previous);
    }
  });
});

describe("Operator Mastra Workspace Skill registration", () => {
  pptIntegrationTest("registers PPT skills as standard Mastra Workspace Skills", async () => {
    const skills = await listMastraWorkspaceSkills();
    const names = skills.map((skill) => skill.name);

    expect(names).toContain("gorden-ppt-skill");
    expect(names).toContain("guizang-ppt-skill");
  });

  pptIntegrationTest(
    "executes PPT skills through the configured ACP agent",
    async () => {
      const workspace = `tmp/test-runs/operator-chat-xiyouji-ppt-skills-${process.pid}-${Date.now()}`;
      rmSync(path.join(repoRoot(), workspace), { recursive: true, force: true });
      const result = await runOperatorChat({
        workspace,
        prompt: [
          "请为《西游记》生成两份用于大学文学鉴赏课的3页PPT smoke test。",
          "一份输出可编辑 PowerPoint PPTX，另一份输出瑞士风 HTML 网页 PPT。",
          "你必须通过已注册的 Mastra Workspace Skills 自己选择并执行合适的 skill。",
          "最终产物必须包含真实《西游记》内容，而不是占位文案。"
        ].join("")
      });

      expect(result.status).toBe("succeeded");
      expect(result.agent.execution_status).toBe("used");
      expect(result.agent.fallback_used).toBe(false);

      const artifacts = readJsonArtifact<{
        artifacts?: Array<{ path: string; type?: string; name?: string }>;
      }>(result.workspace, result.outputs.artifactManifest);
      const pptxArtifact = artifacts.artifacts?.find((artifact) => artifact.path.endsWith(".pptx"));
      const htmlArtifact = artifacts.artifacts?.find((artifact) => artifact.path.endsWith(".html"));
      expect(pptxArtifact?.path).toBeTruthy();
      expect(htmlArtifact?.path).toBeTruthy();
      expect(existsSync(path.join(result.workspace, pptxArtifact?.path ?? ""))).toBe(true);
      expect(existsSync(path.join(result.workspace, htmlArtifact?.path ?? ""))).toBe(true);

      expect(result.response?.trim()).toBeTruthy();
      expect(existsSync(path.join(result.workspace, result.outputs.chatPlan))).toBe(true);
      expect(existsSync(path.join(result.workspace, result.outputs.chatResult))).toBe(true);
      expect(existsSync(path.join(result.workspace, result.outputs.artifactManifest))).toBe(true);
    },
    1_200_000
  );
});

async function configureFakeAcpAgent(workspace: string, env: Record<string, string> = {}): Promise<void> {
  clearPrefixedAcpEnv();
  process.env.OPERATOR_DEFAULT_AGENT_SCOPE = "";
  process.env.OPERATOR_DEFAULT_AGENT_ID = "";
  process.env.OPERATOR_ACP_AGENTS_JSON = "";
  process.env.OPERATOR_ACP_AGENT_FALLBACK_ORDER = "";
  process.env.OPERATOR_AGENT_FALLBACK_ORDER = "fake-acp";
  process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON = JSON.stringify([fakeAcpAgentConfig(env)]);
  process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = path.join(repoRoot(), workspace, ".capabilities");
  await syncCapability("fake-acp", { kind: "agent" });
}

function fakeAcpAgentConfig(env: Record<string, string> = {}) {
  return {
    id: "fake-acp",
    name: "Fake ACP",
    description: "Test ACP agent",
    command: process.execPath,
    args: [path.join(repoRoot(), "apps/mastra/tests/fixtures/fake-acp-agent.mjs")],
    cwd: repoRoot(),
    env
  };
}

function readJsonArtifact<T>(workspace: string, artifactPath: string): T {
  return JSON.parse(readFileSync(path.join(workspace, artifactPath), "utf8")) as T;
}

function captureAgentEnv(): Record<string, string | undefined> {
  const names = [
    "OPERATOR_MASTRA_ACP_AGENTS_JSON",
    "OPERATOR_ACP_AGENTS_JSON",
    "OPERATOR_AGENT_FALLBACK_ORDER",
    "OPERATOR_ACP_AGENT_FALLBACK_ORDER",
    "OPERATOR_DEFAULT_AGENT_SCOPE",
    "OPERATOR_DEFAULT_AGENT_ID",
    "OPERATOR_CAPABILITY_INSTALL_STATE_ROOT",
    ...acpEnvNames()
  ];
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreAgentEnv(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) restoreEnv(name, value);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function clearPrefixedAcpEnv(): void {
  for (const name of acpEnvNames()) process.env[name] = "";
}

function acpEnvNames(): string[] {
  const prefixes = [
    "OPERATOR_CODEX_ACP",
    "OPERATOR_CODEX_ACP_PACKYCODE",
    "OPERATOR_CLAUDE_CODE_ACP_PACKYCODE",
    "OPERATOR_CLAUDE_CODE_ACP",
    "OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP",
    "OPERATOR_OPENHANDS_ACP"
  ];
  const suffixes = ["COMMAND", "ARGS", "MODEL", "CWD", "ENV", "PERSIST_SESSION", "ID", "NAME", "DESCRIPTION", "KEYWORDS"];
  return prefixes.flatMap((prefix) => suffixes.map((suffix) => `${prefix}_${suffix}`));
}
