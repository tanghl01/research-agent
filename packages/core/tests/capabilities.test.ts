import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  classifyCapabilityRepository,
  listSyncableCapabilityDescriptors,
  repoRoot,
  requireEnabledCapability,
  resolveCapabilityInstallReceipt,
  syncCapability,
  validateAcpAgentCapabilityConfig
} from "../src/index.js";

const root = path.join(repoRoot(), "tmp/test-runs/core-capabilities");
const manifestDir = path.join(root, "manifests");
const skillRoot = path.join(root, "runtime", "GoldenSkill");
const runtimeCacheRoot = path.join(root, "runtime-cache");
const capabilityStateRoot = path.join(root, "capability-state");

const previousSkillManifestDir = process.env.OPERATOR_SKILL_MANIFEST_DIR;
const previousRuntimeCacheRoot = process.env.OPERATOR_RUNTIME_CACHE_ROOT;
const previousCapabilityInstallStateRoot = process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT;
const previousApiKey = process.env.OPERATOR_TEST_MODEL_API_KEY;
const previousAcpAgents = process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON;
const previousLegacyAcpAgents = process.env.OPERATOR_ACP_AGENTS_JSON;

afterEach(() => {
  restoreEnv("OPERATOR_SKILL_MANIFEST_DIR", previousSkillManifestDir);
  restoreEnv("OPERATOR_RUNTIME_CACHE_ROOT", previousRuntimeCacheRoot);
  restoreEnv("OPERATOR_CAPABILITY_INSTALL_STATE_ROOT", previousCapabilityInstallStateRoot);
  restoreEnv("OPERATOR_TEST_MODEL_API_KEY", previousApiKey);
  restoreEnv("OPERATOR_MASTRA_ACP_AGENTS_JSON", previousAcpAgents);
  restoreEnv("OPERATOR_ACP_AGENTS_JSON", previousLegacyAcpAgents);
  rmSync(root, { recursive: true, force: true });
});

describe("capability lifecycle", () => {
  test("converts legacy skill manifests into syncable capability descriptors", () => {
    writeLegacySkillManifest({
      id: "GoldenSkill",
      kind: "agent_skill",
      cache: {
        development_root: path.relative(repoRoot(), skillRoot).split(path.sep).join("/")
      },
      required_paths: ["SKILL.md"]
    });
    process.env.OPERATOR_SKILL_MANIFEST_DIR = manifestDir;

    const descriptors = listSyncableCapabilityDescriptors({ kind: "skill" });
    expect(descriptors.map((descriptor) => descriptor.id)).toEqual(["GoldenSkill"]);
    expect(descriptors[0]).toMatchObject({
      kind: "skill",
      adapter: { type: "agent-skill" },
      compatibilityLevel: "operator-compatible",
      legacySkillId: "GoldenSkill"
    });
  });

  test("runs install, configuration, capability test, and enablement receipts for a legacy skill", async () => {
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(path.join(skillRoot, "SKILL.md"), "# GoldenSkill\n", "utf8");
    writeLegacySkillManifest({
      id: "GoldenSkill",
      kind: "agent_skill",
      cache: {
        development_root: path.relative(repoRoot(), skillRoot).split(path.sep).join("/")
      },
      required_paths: ["SKILL.md"],
      install: {
        required_env: ["OPERATOR_TEST_MODEL_API_KEY"],
        smoke_tests: [
          {
            name: "skill_readable",
            command: "test -s {skill_root}/SKILL.md"
          }
        ],
        capability_tests: [
          {
            name: "golden_artifact",
            command: "printf 'validated' > {workspace}/result.txt",
            expectedArtifacts: [{ path: "result.txt", minBytes: 4 }]
          }
        ]
      }
    });

    process.env.OPERATOR_SKILL_MANIFEST_DIR = manifestDir;
    process.env.OPERATOR_RUNTIME_CACHE_ROOT = runtimeCacheRoot;
    process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = capabilityStateRoot;
    process.env.OPERATOR_TEST_MODEL_API_KEY = "test-key";

    const receipt = await syncCapability("GoldenSkill");
    expect(receipt.status).toBe("enabled");
    expect(receipt.lifecycle_status).toBe("enabled");
    expect(receipt.stages.map((stage) => stage.phase)).toEqual(["install", "configure", "validate", "register", "deploy", "enable"]);
    expect(receipt.receipt_path).toContain("capability-state");
    expect(receipt.receipt_path).not.toContain("skill-state");
    expect(receipt.checks.some((check) => check.name.includes("required_env:OPERATOR_TEST_MODEL_API_KEY") && check.status === "passed")).toBe(true);
    expect(receipt.checks.some((check) => check.name.includes("capability:golden_artifact") && check.status === "passed")).toBe(true);
    expect(resolveCapabilityInstallReceipt("GoldenSkill")?.status).toBe("enabled");
    expect(requireEnabledCapability("GoldenSkill").receipt_path).toBe(receipt.receipt_path);
  });

  test("blocks enablement when required provider configuration is missing", async () => {
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(path.join(skillRoot, "SKILL.md"), "# GoldenSkill\n", "utf8");
    writeLegacySkillManifest({
      id: "GoldenSkill",
      kind: "agent_skill",
      cache: {
        development_root: path.relative(repoRoot(), skillRoot).split(path.sep).join("/")
      },
      required_paths: ["SKILL.md"],
      install: {
        required_env: ["OPERATOR_TEST_MODEL_API_KEY"],
        capability_tests: [
          {
            name: "golden_artifact",
            command: "printf 'validated' > {workspace}/result.txt",
            expectedArtifacts: [{ path: "result.txt", minBytes: 4 }]
          }
        ]
      }
    });

    process.env.OPERATOR_SKILL_MANIFEST_DIR = manifestDir;
    process.env.OPERATOR_RUNTIME_CACHE_ROOT = runtimeCacheRoot;
    process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = capabilityStateRoot;
    delete process.env.OPERATOR_TEST_MODEL_API_KEY;

    await expect(syncCapability("GoldenSkill")).rejects.toThrow(/Capability installation failed/u);
    const receipt = resolveCapabilityInstallReceipt("GoldenSkill");
    expect(receipt?.status).toBe("failed");
    expect(receipt?.receipt_path).toContain("capability-state");
    expect(receipt?.checks.some((check) => check.phase === "configure" && check.status === "failed")).toBe(true);
  });

  test("classifies community repository features without enabling generic repositories", () => {
    const langgraphRoot = path.join(root, "langgraph");
    const mcpRoot = path.join(root, "mcp");
    const skillRepoRoot = path.join(root, "skill");
    const genericRoot = path.join(root, "generic");
    mkdirSync(langgraphRoot, { recursive: true });
    mkdirSync(mcpRoot, { recursive: true });
    mkdirSync(skillRepoRoot, { recursive: true });
    mkdirSync(genericRoot, { recursive: true });
    writeFileSync(path.join(langgraphRoot, "langgraph.json"), "{}", "utf8");
    writeFileSync(path.join(mcpRoot, "mcp.json"), "{}", "utf8");
    writeFileSync(path.join(skillRepoRoot, "SKILL.md"), "# Skill\n", "utf8");
    writeFileSync(path.join(genericRoot, "README.md"), "# Generic\n", "utf8");

    expect(classifyCapabilityRepository(langgraphRoot)).toMatchObject({ adapterType: "langgraph", kind: "workflow" });
    expect(classifyCapabilityRepository(mcpRoot)).toMatchObject({ adapterType: "mcp-tool", kind: "tool" });
    expect(classifyCapabilityRepository(skillRepoRoot)).toMatchObject({ adapterType: "agent-skill", kind: "skill" });
    expect(classifyCapabilityRepository(genericRoot)).toMatchObject({
      adapterType: "generic-github",
      compatibilityLevel: "generic-open-source"
    });
  });

  test("validates ACP agent capability configuration before it enters runtime fallback", () => {
    expect(validateAcpAgentCapabilityConfig({ id: "agent", command: "node" }).every((check) => check.status === "passed")).toBe(true);
    const checks = validateAcpAgentCapabilityConfig({ id: "agent", command: "", env: { API_KEY: "$MISSING_AGENT_KEY" } });
    expect(checks.some((check) => check.name.endsWith(":acp_command") && check.status === "failed")).toBe(true);
    expect(checks.some((check) => check.name.endsWith(":acp_env:MISSING_AGENT_KEY") && check.status === "failed")).toBe(true);
  });

  test("syncs configured ACP agents through the capability lifecycle", async () => {
    process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = capabilityStateRoot;
    process.env.OPERATOR_MASTRA_ACP_AGENTS_JSON = JSON.stringify([
      {
        id: "test-acp-agent",
        name: "Test ACP Agent",
        description: "Runtime ACP agent fixture",
        command: process.execPath,
        args: ["--version"],
        cwd: "${OPERATOR_REPO_ROOT}"
      }
    ]);
    process.env.OPERATOR_ACP_AGENTS_JSON = "";

    const descriptors = listSyncableCapabilityDescriptors({ kind: "agent" });
    expect(descriptors.map((descriptor) => descriptor.id)).toContain("test-acp-agent");

    const receipt = await syncCapability("test-acp-agent", { kind: "agent" });
    expect(receipt.status).toBe("enabled");
    expect(receipt.adapter_type).toBe("acp-agent");
    expect(receipt.stages.map((stage) => stage.phase)).toEqual(["install", "configure", "validate", "register", "deploy", "enable"]);
    expect(receipt.checks.some((check) => check.name.endsWith(":acp_command") && check.status === "passed")).toBe(true);
    expect(receipt.checks.some((check) => check.name.endsWith(":acp_command_available") && check.status === "passed")).toBe(true);
    expect(requireEnabledCapability("test-acp-agent").receipt_path).toBe(receipt.receipt_path);
  });
});

function writeLegacySkillManifest(manifest: Record<string, unknown>): void {
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(path.join(manifestDir, `${manifest.id}.skill.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
