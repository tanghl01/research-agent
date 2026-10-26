import { rmSync } from "node:fs";
import path from "node:path";
import { repoRoot, syncCapability } from "@operator/core";
import { describe, expect, test } from "vitest";
import {
  configuredMainAgentFallbackOrder,
  listConfiguredExternalAgentConfigs,
  type OperatorAgentTraceEvent,
  runOperatorAgent,
  stripForwardedCodexWarnings
} from "../src/agents/runtime.js";

describe("Operator agent runtime", () => {
  test("filters Codex environment warnings from forwarded ACP text", () => {
    const warning =
      "Warning: Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.";

    expect(stripForwardedCodexWarnings(warning)).toBe("");
    expect(stripForwardedCodexWarnings(`${warning}\n正常回复`)).toBe("正常回复");
    expect(stripForwardedCodexWarnings(`第一句\n${warning}\n第二句`)).toBe("第一句\n第二句");
  });

  test("runs a configured ACP agent through the Mastra ACP stream lifecycle", async () => {
    const previousAcpAgents = process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON;
    const previousLegacyAcpAgents = process.env.OPERATOR_ACP_AGENTS_JSON;
    const previousFallbackOrder = process.env.OPERATOR_AGENT_FALLBACK_ORDER;
    const previousCapabilityStateRoot = process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT;
    const capabilityStateRoot = path.join(repoRoot(), "tmp/test-runs/runtime-capabilities/fake-acp-stream");
    const prefixed = capturePrefixedAcpEnv();
    const traces: OperatorAgentTraceEvent[] = [];

    try {
      rmSync(capabilityStateRoot, { recursive: true, force: true });
      clearPrefixedAcpEnv();
      process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = capabilityStateRoot;
      process.env.OPERATOR_ACP_AGENTS_JSON = "";
      process.env.OPERATOR_AGENT_FALLBACK_ORDER = "fake-acp";
      process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON = JSON.stringify([
        fakeAcpAgentConfig({
          OPERATOR_TEST_FAKE_ACP_RESPONSE: "ACP standard runtime response"
        })
      ]);
      await syncCapability("fake-acp", { kind: "agent" });

      const result = await runOperatorAgent({
        agentId: "fake-acp",
        messages: [{ id: "test-acp-run", role: "user", content: "hello" }],
        runtimeContext: {
          workspace: "tmp/test-runs/runtime-acp-agent",
          workspace_absolute: path.join(repoRoot(), "tmp/test-runs/runtime-acp-agent"),
          run_id: "runtime-acp-agent"
        },
        onTrace: (event) => traces.push(event)
      });

      expect(result.status).toBe("used");
      expect(result.runtime).toBe("mastra-acp-agent");
      expect(result.value).toBe("ACP standard runtime response");
      expect(result.attemptedAgentIds).toEqual(["fake-acp"]);
      expect(traces.some((event) => event.label === "ACP stream started")).toBe(true);
      expect(traces.some((event) => event.label === "Agent output finished")).toBe(true);
    } finally {
      restoreEnv("OPERATOR_MASTRA_ACP_AGENTS_JSON", previousAcpAgents);
      restoreEnv("OPERATOR_ACP_AGENTS_JSON", previousLegacyAcpAgents);
      restoreEnv("OPERATOR_AGENT_FALLBACK_ORDER", previousFallbackOrder);
      restoreEnv("OPERATOR_CAPABILITY_INSTALL_STATE_ROOT", previousCapabilityStateRoot);
      restoreCapturedEnv(prefixed);
      rmSync(capabilityStateRoot, { recursive: true, force: true });
    }
  });

  test("uses the last ACP agent message as the final response", async () => {
    const previousAcpAgents = process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON;
    const previousLegacyAcpAgents = process.env.OPERATOR_ACP_AGENTS_JSON;
    const previousFallbackOrder = process.env.OPERATOR_AGENT_FALLBACK_ORDER;
    const previousCapabilityStateRoot = process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT;
    const capabilityStateRoot = path.join(repoRoot(), "tmp/test-runs/runtime-capabilities/fake-acp-final-message");
    const prefixed = capturePrefixedAcpEnv();
    const traces: OperatorAgentTraceEvent[] = [];

    try {
      rmSync(capabilityStateRoot, { recursive: true, force: true });
      clearPrefixedAcpEnv();
      process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = capabilityStateRoot;
      process.env.OPERATOR_ACP_AGENTS_JSON = "";
      process.env.OPERATOR_AGENT_FALLBACK_ORDER = "fake-acp";
      process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON = JSON.stringify([
        fakeAcpAgentConfig({
          OPERATOR_TEST_FAKE_ACP_MESSAGES_JSON: JSON.stringify([
            {
              messageId: "11111111-1111-4111-8111-111111111111",
              text: "我会先检查上下文并运行必要步骤。"
            },
            {
              messageId: "22222222-2222-4222-8222-222222222222",
              text: "最终结果：已完成。"
            }
          ])
        })
      ]);
      await syncCapability("fake-acp", { kind: "agent" });

      const result = await runOperatorAgent({
        agentId: "fake-acp",
        messages: [{ id: "test-acp-final-message", role: "user", content: "hello" }],
        runtimeContext: {
          workspace: "tmp/test-runs/runtime-acp-final-message",
          workspace_absolute: path.join(repoRoot(), "tmp/test-runs/runtime-acp-final-message"),
          run_id: "runtime-acp-final-message"
        },
        onTrace: (event) => traces.push(event)
      });

      expect(result.status).toBe("used");
      expect(result.value).toBe("最终结果：已完成。");
      expect(result.value).not.toContain("我会先检查");
      expect(traces.some((event) => event.label === "Agent output" && event.detail?.includes("我会先检查"))).toBe(true);
    } finally {
      restoreEnv("OPERATOR_MASTRA_ACP_AGENTS_JSON", previousAcpAgents);
      restoreEnv("OPERATOR_ACP_AGENTS_JSON", previousLegacyAcpAgents);
      restoreEnv("OPERATOR_AGENT_FALLBACK_ORDER", previousFallbackOrder);
      restoreEnv("OPERATOR_CAPABILITY_INSTALL_STATE_ROOT", previousCapabilityStateRoot);
      restoreCapturedEnv(prefixed);
      rmSync(capabilityStateRoot, { recursive: true, force: true });
    }
  });

  test("rejects removed Codex exec proxy external agent configs", () => {
    const previousAcpAgents = process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON;
    const previousLegacyAcpAgents = process.env.OPERATOR_ACP_AGENTS_JSON;
    const prefixed = capturePrefixedAcpEnv();

    try {
      clearPrefixedAcpEnv();
      process.env.OPERATOR_ACP_AGENTS_JSON = "";
      process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON = JSON.stringify([
        {
          id: "legacy-proxy",
          name: "Legacy Proxy",
          description: "Removed HTTP proxy runtime",
          runtime: "codex-exec-proxy",
          endpoint: "http://127.0.0.1:43181/v1/run"
        }
      ]);

      expect(() => listConfiguredExternalAgentConfigs()).toThrow(/removed runtime codex-exec-proxy/u);
    } finally {
      restoreEnv("OPERATOR_MASTRA_ACP_AGENTS_JSON", previousAcpAgents);
      restoreEnv("OPERATOR_ACP_AGENTS_JSON", previousLegacyAcpAgents);
      restoreCapturedEnv(prefixed);
    }
  });

  test("registers PackyCode ACP agents as default fallbacks", () => {
    const previousAcpAgents = process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON;
    const previousLegacyAcpAgents = process.env.OPERATOR_ACP_AGENTS_JSON;
    const previousFallbackOrder = process.env.OPERATOR_AGENT_FALLBACK_ORDER;
    const previousPackyModel = process.env.OPERATOR_PACKY_MODEL;
    const previousPackyClaudeModel = process.env.OPERATOR_PACKY_CLAUDE_MODEL;
    const prefixed = capturePrefixedAcpEnv();
    const codexHomeTemplate = "$" + "{OPERATOR_REPO_ROOT}/.local/codex-acp-packycode-home";

    try {
      clearPrefixedAcpEnv();
      process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON = "";
      process.env.OPERATOR_ACP_AGENTS_JSON = "";
      process.env.OPERATOR_AGENT_FALLBACK_ORDER = "";
      process.env.OPERATOR_PACKY_MODEL = "gpt-5.5";
      process.env.OPERATOR_PACKY_CLAUDE_MODEL = "claude-opus-4-8";
      process.env.OPERATOR_CODEX_ACP_COMMAND = "codex-acp";
      process.env.OPERATOR_CODEX_ACP_PACKYCODE_COMMAND = "codex-acp";
      process.env.OPERATOR_CODEX_ACP_PACKYCODE_ENV = JSON.stringify({
        CODEX_HOME: codexHomeTemplate,
        OPENAI_API_KEY: "$OPERATOR_PACKY_API_KEY"
      });
      process.env.OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_COMMAND = "npx";
      process.env.OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_ARGS = "-y @agentclientprotocol/claude-agent-acp";
      process.env.OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_MODEL = "";
      process.env.OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_ENV = JSON.stringify({
        ANTHROPIC_BASE_URL: "https://www.packyapi.com",
        ANTHROPIC_API_KEY: "$OPERATOR_PACKY_API_KEY",
        ANTHROPIC_AUTH_TOKEN: "$OPERATOR_PACKY_API_KEY",
        ANTHROPIC_MODEL: "$OPERATOR_PACKY_CLAUDE_MODEL",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "$OPERATOR_PACKY_CLAUDE_MODEL",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "$OPERATOR_PACKY_CLAUDE_MODEL",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "$OPERATOR_PACKY_CLAUDE_MODEL",
        CLAUDE_CODE_SUBAGENT_MODEL: "$OPERATOR_PACKY_CLAUDE_MODEL"
      });

      const configs = listConfiguredExternalAgentConfigs();
      const packyCode = configs.find((config) => config.id === "codex-acp-packycode");
      const packyClaude = configs.find((config) => config.id === "claude-code-acp-packycode");

      expect(configs.map((config) => config.id)).toEqual(["codex-acp", "codex-acp-packycode", "claude-code-acp-packycode"]);
      expect(configuredMainAgentFallbackOrder().slice(0, 3)).toEqual(["codex-acp", "codex-acp-packycode", "claude-code-acp-packycode"]);
      expect(packyCode).toMatchObject({
        name: "Codex ACP (PackyCode)",
        command: "codex-acp"
      });
      expect(packyCode?.model).toBeUndefined();
      expect(packyCode?.env).toEqual({
        CODEX_HOME: codexHomeTemplate,
        OPENAI_API_KEY: "$OPERATOR_PACKY_API_KEY"
      });
      expect(packyClaude).toMatchObject({
        name: "Claude Code ACP (PackyCode)",
        command: "npx",
        args: ["-y", "@agentclientprotocol/claude-agent-acp"],
        model: undefined,
        env: {
          ANTHROPIC_BASE_URL: "https://www.packyapi.com",
          ANTHROPIC_API_KEY: "$OPERATOR_PACKY_API_KEY",
          ANTHROPIC_AUTH_TOKEN: "$OPERATOR_PACKY_API_KEY",
          ANTHROPIC_MODEL: "$OPERATOR_PACKY_CLAUDE_MODEL",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "$OPERATOR_PACKY_CLAUDE_MODEL",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "$OPERATOR_PACKY_CLAUDE_MODEL",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "$OPERATOR_PACKY_CLAUDE_MODEL",
          CLAUDE_CODE_SUBAGENT_MODEL: "$OPERATOR_PACKY_CLAUDE_MODEL"
        }
      });
    } finally {
      restoreEnv("OPERATOR_MASTRA_ACP_AGENTS_JSON", previousAcpAgents);
      restoreEnv("OPERATOR_ACP_AGENTS_JSON", previousLegacyAcpAgents);
      restoreEnv("OPERATOR_AGENT_FALLBACK_ORDER", previousFallbackOrder);
      restoreEnv("OPERATOR_PACKY_MODEL", previousPackyModel);
      restoreEnv("OPERATOR_PACKY_CLAUDE_MODEL", previousPackyClaudeModel);
      restoreCapturedEnv(prefixed);
    }
  });
});

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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function capturePrefixedAcpEnv(): Record<string, string | undefined> {
  return Object.fromEntries(acpEnvNames().map((name) => [name, process.env[name]]));
}

function clearPrefixedAcpEnv(): void {
  for (const name of acpEnvNames()) process.env[name] = "";
}

function restoreCapturedEnv(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) restoreEnv(name, value);
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
