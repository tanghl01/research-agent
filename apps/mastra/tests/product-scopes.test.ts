import { rmSync } from "node:fs";
import path from "node:path";
import { loadSkillManifest, repoRoot, syncCapability } from "@operator/core";
import { describe, expect, test } from "vitest";
import { getConfiguredExternalAgentConfig, selectMainAgentCandidateIds } from "../src/agents/runtime.js";
import {
  getAgentScope,
  getDefaultMainAgentScope,
  getSkillScope,
  getWorkflowScope,
  listRuntimeScopeSelectionCatalog,
  listScopeSelectionCatalog,
  listUserScopeSelectionCatalog
} from "../src/product-scopes/catalog.js";
import { mastraWorkflowImplementations } from "../src/workflows/index.js";

describe("Operator product scope catalog", () => {
  test("exposes agents, skills, workflows, and tools through one catalog", () => {
    const previousAcpAgents = process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON;
    const previousLegacyAcpAgents = process.env.OPERATOR_ACP_AGENTS_JSON;
    const prefixed = capturePrefixedAcpEnv();
    try {
      process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON = "";
      process.env.OPERATOR_ACP_AGENTS_JSON = "";
      clearPrefixedAcpEnv();
      const catalog = listScopeSelectionCatalog();

      expect(catalog.agents).toEqual([]);
      expect(catalog.skills.map((skill) => skill.id).sort()).toEqual([
        "claude-for-legal",
        "dianji-assistant",
        "gorden-ppt-skill",
        "guizang-ppt-skill",
        "industrial-leak-detection",
        "industrial-meter-reading",
        "ppt-master",
        "qinyan-academic-skills",
        "scientific-agent-skills",
        "text-to-cad"
      ]);
      expect(catalog.skills.every((skill) => /^[A-Za-z0-9_.-]+$/u.test(skill.id))).toBe(true);
      const displayNames = Object.fromEntries(catalog.skills.map((skill) => [skill.id, skill.displayName]));
      expect(displayNames).toMatchObject({
        "gorden-ppt-skill": "GordenPPT",
        "guizang-ppt-skill": "网页PPT",
        "ppt-master": "PPT大师",
        "qinyan-academic-skills": "沁言学术",
        "dianji-assistant": "电机百事通",
        "scientific-agent-skills": "科研助手",
        "text-to-cad": "文本转 CAD",
        "claude-for-legal": "法律助手",
        "industrial-leak-detection": "工业泄漏识别",
        "industrial-meter-reading": "工业仪表读数"
      });
      expect(Object.values(displayNames).every((displayName) => !displayName.includes("技能"))).toBe(true);
      expect(catalog.workflows.map((workflow) => workflow.id)).toContain("system.skill2workflow");
      expect(catalog.workflows.map((workflow) => workflow.id)).toContain("industrial.daily-monitoring-report");
      expect(catalog.workflows.map((workflow) => workflow.id)).toContain("research.paper-from-results");
      expect(catalog.tools.map((tool) => tool.id).sort()).toEqual([
        "operator.knowledge.fetch",
        "operator.knowledge.fill_template",
        "operator.knowledge.find_template",
        "operator.knowledge.search",
        "operator.web.download_file",
        "operator.web.fetch_url",
        "operator.web.search"
      ]);
    } finally {
      restoreEnv("OPERATOR_MASTRA_ACP_AGENTS_JSON", previousAcpAgents);
      restoreEnv("OPERATOR_ACP_AGENTS_JSON", previousLegacyAcpAgents);
      restoreCapturedEnv(prefixed);
    }
  });

  test("keeps scope policies near registration metadata", () => {
    expect(getSkillScope("gorden-ppt-skill")?.outputContract).toMatchObject({
      required_output_format: "pptx",
      preferred_artifact_path: "runs/gorden-ppt-skill/output/gorden_deck.pptx"
    });
    expect(getSkillScope("guizang-ppt-skill")?.outputContract).toMatchObject({
      required_output_format: "html",
      preferred_artifact_path: "runs/guizang-ppt-skill/output/guizang_deck.html"
    });
    expect(getSkillScope("ppt-master")?.outputContract).toMatchObject({
      required_output_format: "pptx",
      preferred_artifact_path: "runs/ppt-master/output/ppt_master_deck.pptx"
    });
    expect(getSkillScope("scientific-agent-skills")?.outputContract).toMatchObject({
      required_output_format: "research"
    });
    expect(getSkillScope("qinyan-academic-skills")?.outputContract).toMatchObject({
      required_output_format: "research",
      preferred_artifact_path: "runs/qinyan-academic-skills/output/qinyan_research_result.md"
    });
    expect(getSkillScope("dianji-assistant")?.outputContract).toMatchObject({
      required_output_format: "knowledge",
      preferred_artifact_path: "runs/dianji-assistant/output/dianji_answer.md"
    });
    expect(getSkillScope("text-to-cad")?.outputContract).toMatchObject({
      required_output_format: "cad",
      preferred_artifact_path: "runs/text-to-cad/output/cad_result.md"
    });
    expect(getSkillScope("text-to-cad-cad")).toBeUndefined();
    expect(getSkillScope("claude-for-legal")?.outputContract).toMatchObject({
      required_output_format: "legal"
    });
    expect(getSkillScope("industrial-leak-detection")?.outputContract).toMatchObject({
      required_output_format: "industrial_analysis",
      preferred_artifact_path: "runs/industrial-leak-detection/output/leak_analysis.json"
    });
    expect(getSkillScope("industrial-meter-reading")?.outputContract).toMatchObject({
      required_output_format: "industrial_analysis",
      preferred_artifact_path: "runs/industrial-meter-reading/output/meter_readings.json"
    });
    expect(getWorkflowScope("system.skill2workflow")?.mastraKey).toBe("skill2WorkflowWorkflow");
    expect(getWorkflowScope("industrial.daily-monitoring-report")?.mastraKey).toBe("industrialDailyReportWorkflow");
    expect(getWorkflowScope("research.paper-from-results")?.mastraKey).toBe("araPaperFromResultsWorkflow");
    expect(mastraWorkflowImplementations).toHaveProperty("skill2WorkflowWorkflow");
    expect(mastraWorkflowImplementations).toHaveProperty("industrialDailyReportWorkflow");
    expect(mastraWorkflowImplementations).toHaveProperty("araPaperFromResultsWorkflow");
  });

  test("keeps GitHub skill projects as user-facing skills while exposing nested execution metadata", () => {
    const { manifest } = loadSkillManifest("text-to-cad");
    const cad = manifest.subskills?.cad;

    expect(Object.keys(manifest.subskills ?? {})).toContain("cad");
    expect(cad).toBeDefined();
    if (!cad) throw new Error("text-to-cad cad subskill is missing");
    expect(cad.entrypoints?.skill).toBe("SKILL.md");
    expect(cad.execution?.adapter_paths).toContain("skills/adapters/text-to-cad-cad.md");
    expect(cad.runtime?.commands?.step).toContain("scripts/step");
    expect(cad.runtime?.commands?.inspect).toContain("scripts/inspect");
    expect(cad.runtime?.commands?.snapshot).toContain("scripts/snapshot");

    const { manifest: qinyanManifest } = loadSkillManifest("qinyan-academic-skills");
    expect(Object.keys(qinyanManifest.subskills ?? {})).toEqual(
      expect.arrayContaining([
        "qinyan-paper-search",
        "qinyan-paper-analysis",
        "qinyan-citation",
        "qinyan-topic-analysis",
        "qinyan-paper-polish",
        "timesfm-forecasting",
        "paper-slide-deck",
        "nsfc-proposal"
      ])
    );
    expect(qinyanManifest.subskills?.["qinyan-paper-search"]?.runtime?.commands?.search).toContain("scripts/search.sh");
    expect(qinyanManifest.subskills?.["qinyan-paper-analysis"]?.runtime?.commands?.analyze).toContain("scripts/analyze.sh");
  });

  test("exposes enabled ACP agents as internal agent scopes", async () => {
    const previous = process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON;
    const previousDefaultAgent = process.env.OPERATOR_DEFAULT_AGENT_SCOPE;
    const previousCapabilityStateRoot = process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT;
    const capabilityStateRoot = path.join(repoRoot(), "tmp/test-runs/product-scopes/agent-scope");
    const prefixed = capturePrefixedAcpEnv();
    try {
      rmSync(capabilityStateRoot, { recursive: true, force: true });
      clearPrefixedAcpEnv();
      process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = capabilityStateRoot;
      process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON = JSON.stringify([
        {
          id: "mock-acp-agent",
          name: "Mock ACP Agent",
          description: "A test ACP agent",
          command: "node",
          args: ["--version"],
          keywords: ["mock"]
        }
      ]);
      await syncCapability("mock-acp-agent", { kind: "agent" });

      const catalog = listRuntimeScopeSelectionCatalog();
      const scope = catalog.agents.find((agent) => agent.id === "mock-acp-agent");
      expect(scope).toMatchObject({
        id: "mock-acp-agent",
        runtime: "mastra-acp-agent",
        role: "runtime-agent",
        available: true
      });
      expect(getAgentScope("mock-acp-agent")?.mastraAgentId).toBe("mock-acp-agent");
      process.env.OPERATOR_DEFAULT_AGENT_SCOPE = "mock-acp-agent";
      expect(getDefaultMainAgentScope().id).toBe("mock-acp-agent");
    } finally {
      if (previous === undefined) {
        delete process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON;
      } else {
        process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON = previous;
      }
      restoreEnv("OPERATOR_DEFAULT_AGENT_SCOPE", previousDefaultAgent);
      restoreEnv("OPERATOR_CAPABILITY_INSTALL_STATE_ROOT", previousCapabilityStateRoot);
      restoreCapturedEnv(prefixed);
      rmSync(capabilityStateRoot, { recursive: true, force: true });
    }
  });

  test("skips unavailable default main agent and selects the first enabled fallback", async () => {
    const previousAcpAgents = process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON;
    const previousLegacyAcpAgents = process.env.OPERATOR_ACP_AGENTS_JSON;
    const previousDefaultAgent = process.env.OPERATOR_DEFAULT_AGENT_SCOPE;
    const previousDefaultAgentId = process.env.OPERATOR_DEFAULT_AGENT_ID;
    const previousFallbackOrder = process.env.OPERATOR_AGENT_FALLBACK_ORDER;
    const previousLegacyFallbackOrder = process.env.OPERATOR_ACP_AGENT_FALLBACK_ORDER;
    const previousCapabilityStateRoot = process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT;
    const capabilityStateRoot = path.join(repoRoot(), "tmp/test-runs/product-scopes/agent-fallback");
    const prefixed = capturePrefixedAcpEnv();
    try {
      rmSync(capabilityStateRoot, { recursive: true, force: true });
      clearPrefixedAcpEnv();
      process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = capabilityStateRoot;
      process.env.OPERATOR_DEFAULT_AGENT_SCOPE = "";
      process.env.OPERATOR_DEFAULT_AGENT_ID = "";
      process.env.OPERATOR_ACP_AGENTS_JSON = "";
      process.env.OPERATOR_AGENT_FALLBACK_ORDER = "codex-acp,claude-code-acp,openhands-acp";
      process.env.OPERATOR_ACP_AGENT_FALLBACK_ORDER = "";
      process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON = JSON.stringify([
        {
          id: "claude-code-acp",
          name: "Claude Code ACP (Agnes)",
          description: "Claude Code through ACP using Agnes",
          command: "node",
          args: ["--version"]
        },
        {
          id: "openhands-acp",
          name: "OpenHands ACP (Agnes)",
          description: "OpenHands through ACP using Agnes",
          command: "node",
          args: ["--version"]
        }
      ]);
      await syncCapability("claude-code-acp", { kind: "agent" });
      await syncCapability("openhands-acp", { kind: "agent" });

      expect(selectMainAgentCandidateIds()).toEqual(["codex-acp", "claude-code-acp", "openhands-acp"]);
      expect(getDefaultMainAgentScope().id).toBe("claude-code-acp");
    } finally {
      restoreEnv("OPERATOR_MASTRA_ACP_AGENTS_JSON", previousAcpAgents);
      restoreEnv("OPERATOR_ACP_AGENTS_JSON", previousLegacyAcpAgents);
      restoreEnv("OPERATOR_DEFAULT_AGENT_SCOPE", previousDefaultAgent);
      restoreEnv("OPERATOR_DEFAULT_AGENT_ID", previousDefaultAgentId);
      restoreEnv("OPERATOR_AGENT_FALLBACK_ORDER", previousFallbackOrder);
      restoreEnv("OPERATOR_ACP_AGENT_FALLBACK_ORDER", previousLegacyFallbackOrder);
      restoreEnv("OPERATOR_CAPABILITY_INSTALL_STATE_ROOT", previousCapabilityStateRoot);
      restoreCapturedEnv(prefixed);
      rmSync(capabilityStateRoot, { recursive: true, force: true });
    }
  });

  test("exposes user-facing skill scopes and enabled industrial workflows in the user-facing scope catalog", async () => {
    const previousAcpAgents = process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON;
    const previousCapabilityStateRoot = process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT;
    const prefixed = capturePrefixedAcpEnv();
    const capabilityStateRoot = path.join(repoRoot(), "tmp/test-runs/mastra-product-scopes/capabilities");
    try {
      clearPrefixedAcpEnv();
      rmSync(capabilityStateRoot, { recursive: true, force: true });
      process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = capabilityStateRoot;
      process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON = JSON.stringify([
        {
          id: "codex-acp",
          name: "Codex ACP",
          description: "Default runtime",
          command: "node",
          args: ["--version"]
        }
      ]);
      await syncCapability("industrial.daily-monitoring-report");
      await syncCapability("research.paper-from-results");
      await syncCapability("dianji-assistant", { kind: "skill" });

      const catalog = listUserScopeSelectionCatalog();
      expect(catalog.agents).toEqual([]);
      expect(catalog.workflows.map((workflow) => workflow.id)).toEqual([
        "industrial.daily-monitoring-report",
        "research.paper-from-results"
      ]);
      expect(catalog.tools.map((tool) => tool.id).sort()).toEqual([
        "operator.knowledge.fetch",
        "operator.knowledge.fill_template",
        "operator.knowledge.find_template",
        "operator.knowledge.search"
      ]);
      expect(catalog.skills.map((skill) => skill.id)).toContain("dianji-assistant");
      expect(catalog.skills.length).toBeGreaterThan(0);
      expect(catalog.skills.every((item) => item.kind === "skill")).toBe(true);
      expect(catalog.workflows.every((item) => item.kind === "workflow")).toBe(true);
      expect(catalog.tools.every((item) => item.kind === "tool")).toBe(true);
    } finally {
      restoreEnv("OPERATOR_MASTRA_ACP_AGENTS_JSON", previousAcpAgents);
      restoreEnv("OPERATOR_CAPABILITY_INSTALL_STATE_ROOT", previousCapabilityStateRoot);
      restoreCapturedEnv(prefixed);
      rmSync(capabilityStateRoot, { recursive: true, force: true });
    }
  });

  test("reuses the legacy Codex CLI model for Codex ACP when no ACP model is set", async () => {
    const previousLegacyModel = process.env.OPERATOR_CODEX_CLI_DEFAULT_MODEL;
    const previousAcpAgents = process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON;
    const previousLegacyAcpAgents = process.env.OPERATOR_ACP_AGENTS_JSON;
    const previousCapabilityStateRoot = process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT;
    const capabilityStateRoot = path.join(repoRoot(), "tmp/test-runs/product-scopes/codex-legacy-model");
    const prefixed = capturePrefixedAcpEnv();
    try {
      rmSync(capabilityStateRoot, { recursive: true, force: true });
      clearPrefixedAcpEnv();
      process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = capabilityStateRoot;
      process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON = "";
      process.env.OPERATOR_ACP_AGENTS_JSON = "";
      process.env.OPERATOR_CODEX_CLI_DEFAULT_MODEL = "legacy-codex-model";
      process.env.OPERATOR_CODEX_ACP_COMMAND = "node";
      process.env.OPERATOR_CODEX_ACP_ARGS = "--version";
      process.env.OPERATOR_CODEX_ACP_MODEL = "";
      await syncCapability("codex-acp", { kind: "agent" });

      const codex = getDefaultMainAgentScope();
      expect(codex.id).toBe("codex-acp");
      expect(getConfiguredExternalAgentConfig("codex-acp")?.model).toBe("legacy-codex-model");
    } finally {
      restoreEnv("OPERATOR_CODEX_CLI_DEFAULT_MODEL", previousLegacyModel);
      restoreEnv("OPERATOR_MASTRA_ACP_AGENTS_JSON", previousAcpAgents);
      restoreEnv("OPERATOR_ACP_AGENTS_JSON", previousLegacyAcpAgents);
      restoreEnv("OPERATOR_CAPABILITY_INSTALL_STATE_ROOT", previousCapabilityStateRoot);
      restoreCapturedEnv(prefixed);
      rmSync(capabilityStateRoot, { recursive: true, force: true });
    }
  });
});

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
