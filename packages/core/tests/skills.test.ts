import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  listSkillManifestIds,
  listSkillManifests,
  listSyncableSkillManifests,
  repoRoot,
  requireEnabledCapability,
  resolveSkillAdapterFiles,
  resolveSkillEntrypoint,
  resolveSkillExecutionTarget,
  resolveSkillCapabilityReceipt,
  resolveSkillRootInfo,
  resolveSkillRuntimeInfo,
  syncAllCapabilities,
  syncCapability
} from "../src/index.js";

const root = path.join(repoRoot(), "tmp/test-runs/core-skills");
const manifestDir = path.join(root, "manifests");
const skillRoot = path.join(root, "runtime", "ExampleSkill");

const previousManifestDir = process.env.OPERATOR_SKILL_MANIFEST_DIR;
const previousSkillRoot = process.env.OPERATOR_SKILL_EXAMPLESKILL_ROOT;
const previousRuntimeCacheRoot = process.env.OPERATOR_RUNTIME_CACHE_ROOT;
const previousCapabilityInstallStateRoot = process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT;
const previousPipCacheDir = process.env.PIP_CACHE_DIR;
const previousOperatorPipCacheDir = process.env.OPERATOR_PIP_CACHE_DIR;
const previousTestModelApiKey = process.env.OPERATOR_TEST_MODEL_API_KEY;

afterEach(() => {
  if (previousManifestDir === undefined) delete process.env.OPERATOR_SKILL_MANIFEST_DIR;
  else process.env.OPERATOR_SKILL_MANIFEST_DIR = previousManifestDir;
  if (previousSkillRoot === undefined) delete process.env.OPERATOR_SKILL_EXAMPLESKILL_ROOT;
  else process.env.OPERATOR_SKILL_EXAMPLESKILL_ROOT = previousSkillRoot;
  if (previousRuntimeCacheRoot === undefined) delete process.env.OPERATOR_RUNTIME_CACHE_ROOT;
  else process.env.OPERATOR_RUNTIME_CACHE_ROOT = previousRuntimeCacheRoot;
  if (previousCapabilityInstallStateRoot === undefined) delete process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT;
  else process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = previousCapabilityInstallStateRoot;
  if (previousPipCacheDir === undefined) delete process.env.PIP_CACHE_DIR;
  else process.env.PIP_CACHE_DIR = previousPipCacheDir;
  if (previousOperatorPipCacheDir === undefined) delete process.env.OPERATOR_PIP_CACHE_DIR;
  else process.env.OPERATOR_PIP_CACHE_DIR = previousOperatorPipCacheDir;
  if (previousTestModelApiKey === undefined) delete process.env.OPERATOR_TEST_MODEL_API_KEY;
  else process.env.OPERATOR_TEST_MODEL_API_KEY = previousTestModelApiKey;
  rmSync(root, { recursive: true, force: true });
});

describe("skill manifest resolver", () => {
  test("resolves roots and entrypoints from manifest metadata", () => {
    mkdirSync(path.join(skillRoot, "scripts"), { recursive: true });
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(path.join(skillRoot, "SKILL.md"), "# ExampleSkill\n", "utf8");
    writeFileSync(path.join(skillRoot, "scripts", "run.sh"), "#!/usr/bin/env bash\n", "utf8");
    writeFileSync(
      path.join(manifestDir, "ExampleSkill.skill.json"),
      JSON.stringify(
        {
          id: "ExampleSkill",
          kind: "agent_skill",
          cache: {
            development_root: "unused"
          },
          env: {
            root_override: "OPERATOR_SKILL_EXAMPLESKILL_ROOT"
          },
          entrypoints: {
            skill: "SKILL.md",
            runner: "scripts/run.sh"
          },
          required_paths: ["SKILL.md", "scripts/run.sh"]
        },
        null,
        2
      ),
      "utf8"
    );

    process.env.OPERATOR_SKILL_MANIFEST_DIR = manifestDir;
    process.env.OPERATOR_SKILL_EXAMPLESKILL_ROOT = skillRoot;

    const resolved = resolveSkillRootInfo("ExampleSkill");
    expect(resolved.root).toBe(skillRoot);
    expect(resolved.source).toBe("env_override");
    expect(resolveSkillEntrypoint("ExampleSkill", "runner")).toBe(path.join(skillRoot, "scripts", "run.sh"));
  });

  test("resolves a skill root subpath inside a repository cache", () => {
    const repoCache = path.join(root, "runtime", "NestedRepo");
    const nestedSkillRoot = path.join(repoCache, "skills", "nested-skill");
    mkdirSync(path.join(nestedSkillRoot, "scripts"), { recursive: true });
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(path.join(nestedSkillRoot, "SKILL.md"), "# NestedSkill\n", "utf8");
    writeFileSync(path.join(nestedSkillRoot, "scripts", "run.sh"), "#!/usr/bin/env bash\n", "utf8");
    writeFileSync(
      path.join(manifestDir, "NestedSkill.skill.json"),
      JSON.stringify(
        {
          id: "NestedSkill",
          kind: "agent_skill",
          cache: {
            development_root: path.relative(repoRoot(), repoCache).split(path.sep).join("/"),
            root_subpath: "skills/nested-skill"
          },
          entrypoints: {
            skill: "SKILL.md",
            runner: "scripts/run.sh"
          },
          required_paths: ["SKILL.md", "scripts/run.sh"]
        },
        null,
        2
      ),
      "utf8"
    );

    process.env.OPERATOR_SKILL_MANIFEST_DIR = manifestDir;

    const resolved = resolveSkillRootInfo("NestedSkill");
    expect(resolved.root).toBe(nestedSkillRoot);
    expect(resolved.source).toBe("development_cache");
    expect(resolveSkillEntrypoint("NestedSkill", "runner")).toBe(path.join(nestedSkillRoot, "scripts", "run.sh"));
  });

  test("resolves subskill runtime cache and setup metadata from manifests", () => {
    const repoCache = path.join(root, "runtime", "CadCollection");
    const cadRoot = path.join(repoCache, "skills", "cad");
    const runtimeRoot = path.join(root, "runtime-cache");
    const adapterPath = path.join(root, "adapters", "cad.md");
    mkdirSync(path.join(cadRoot, "scripts", "packages", "cadpy"), { recursive: true });
    mkdirSync(path.dirname(adapterPath), { recursive: true });
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(path.join(repoCache, "README.md"), "# CadCollection\n", "utf8");
    writeFileSync(path.join(cadRoot, "SKILL.md"), "# CAD\n", "utf8");
    writeFileSync(path.join(cadRoot, "requirements.txt"), "--editable ./scripts/packages/cadpy\n", "utf8");
    writeFileSync(path.join(cadRoot, "scripts", "packages", "cadpy", "pyproject.toml"), "[project]\nname='cadpy'\n", "utf8");
    writeFileSync(adapterPath, "# CAD adapter\n", "utf8");
    writeFileSync(
      path.join(manifestDir, "CadCollection.skill.json"),
      JSON.stringify(
        {
          id: "CadCollection",
          kind: "agent_skill_collection",
          cache: {
            development_root: path.relative(repoRoot(), repoCache).split(path.sep).join("/")
          },
          required_paths: ["README.md"],
          subskills: {
            cad: {
              root_subpath: "skills/cad",
              entrypoints: {
                skill: "SKILL.md",
                requirements: "requirements.txt"
              },
              required_paths: ["SKILL.md", "requirements.txt", "scripts/packages/cadpy/pyproject.toml"],
              execution: {
                evidence_entrypoint: "skill",
                adapter_paths: [path.relative(repoRoot(), adapterPath).split(path.sep).join("/")],
                agent_guard: {
                  blocked_tool_action_patterns: ["dir\\("],
                  blocked_tool_action_message: "Do not probe APIs."
                }
              },
              runtime: {
                type: "python_venv",
                cache_key_files: ["requirements.txt", "scripts/packages/cadpy/pyproject.toml"],
                setup: {
                  cwd: ".",
                  commands: [
                    "mkdir -p {runtime_root}",
                    "test -x {python} || {system_python} -m venv {venv}",
                    "{pip} install -r requirements.txt",
                    "touch {setup_complete_path}"
                  ]
                },
                commands: {
                  step: "{python} scripts/step"
                }
              }
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    process.env.OPERATOR_SKILL_MANIFEST_DIR = manifestDir;
    process.env.OPERATOR_RUNTIME_CACHE_ROOT = runtimeRoot;

    const target = resolveSkillExecutionTarget("CadCollection", "cad");
    expect(target.root).toBe(cadRoot);
    expect(target.entrypoints.skill).toBe("SKILL.md");
    expect(target.execution.agent_guard?.blocked_tool_action_patterns).toContain("dir\\(");

    const runtime = resolveSkillRuntimeInfo("CadCollection", "cad");
    expect(runtime?.type).toBe("python_venv");
    expect(runtime?.cache_root).toBe(runtimeRoot);
    expect(runtime?.runtime_root).toContain(path.join(runtimeRoot, "CadCollection-cad"));
    expect(runtime?.setup_cwd).toBe(cadRoot);
    expect(runtime?.setup_commands.join("\n")).toContain("pip install -r requirements.txt");
    expect(runtime?.commands.step).toContain("scripts/step");
    expect(runtime?.cache_key_files.every((file) => file.sha256)).toBe(true);

    const adapters = resolveSkillAdapterFiles("CadCollection", "cad");
    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.path).toBe(adapterPath);
    expect(adapters[0]?.sha256).toHaveLength(64);
  });

  test("keeps provider credential mapping scoped to skill runtime commands", () => {
    const imageSkillRoot = path.join(root, "runtime", "ImageSkill");
    const runtimeRoot = path.join(root, "runtime-cache");
    mkdirSync(path.join(imageSkillRoot, "scripts"), { recursive: true });
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(path.join(imageSkillRoot, "SKILL.md"), "# ImageSkill\n", "utf8");
    writeFileSync(path.join(imageSkillRoot, "requirements.txt"), "requests\n", "utf8");
    writeFileSync(path.join(imageSkillRoot, "scripts", "image_gen.py"), "print('ok')\n", "utf8");
    writeFileSync(
      path.join(manifestDir, "ImageSkill.skill.json"),
      JSON.stringify(
        {
          id: "ImageSkill",
          kind: "agent_skill",
          cache: {
            development_root: path.relative(repoRoot(), imageSkillRoot).split(path.sep).join("/")
          },
          entrypoints: {
            skill: "SKILL.md",
            requirements: "requirements.txt"
          },
          required_paths: ["SKILL.md", "requirements.txt", "scripts/image_gen.py"],
          runtime: {
            type: "python_venv",
            cache_key_files: ["requirements.txt"],
            commands: {
              image_gen:
                "env IMAGE_BACKEND=openai OPENAI_API_KEY=\"$OPERATOR_PACKY_IMAGE_API_KEY\" OPENAI_BASE_URL=\"${OPERATOR_PACKY_IMAGE_BASE_URL:-https://www.packyapi.com/v1}\" {python} {skill_root}/scripts/image_gen.py"
            }
          },
          install: {
            optional_env: ["OPERATOR_PACKY_IMAGE_API_KEY"]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    process.env.OPERATOR_SKILL_MANIFEST_DIR = manifestDir;
    process.env.OPERATOR_RUNTIME_CACHE_ROOT = runtimeRoot;

    const runtime = resolveSkillRuntimeInfo("ImageSkill");
    expect(runtime?.commands.image_gen).toContain('OPENAI_API_KEY="$OPERATOR_PACKY_IMAGE_API_KEY"');
    expect(runtime?.commands.image_gen).toContain("scripts/image_gen.py");
    expect(runtime?.commands.image_gen).toContain(path.join(runtimeRoot, "ImageSkill"));
    expect(runtime?.commands.image_gen).not.toContain("sk-");
  });

  test("discovers syncable git-backed agent skill manifests", () => {
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      path.join(manifestDir, "AgentSkill.skill.json"),
      JSON.stringify(
        {
          id: "AgentSkill",
          kind: "agent_skill",
          source: {
            type: "git",
            repo: "https://example.com/agent-skill.git",
            ref: "main",
            commit: "abc123"
          },
          cache: {
            development_root: "unused"
          },
          required_paths: ["SKILL.md"]
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      path.join(manifestDir, "CollectionSkill.skill.json"),
      JSON.stringify(
        {
          id: "CollectionSkill",
          kind: "agent_skill_collection",
          source: {
            type: "git",
            repo: "https://example.com/collection.git"
          },
          cache: {
            development_root: "unused"
          },
          required_paths: ["README.md"]
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      path.join(manifestDir, "ExternalAgent.skill.json"),
      JSON.stringify(
        {
          id: "ExternalAgent",
          kind: "external_agent_package",
          source: {
            type: "git",
            repo: "https://example.com/external-agent.git"
          },
          cache: {
            development_root: "unused"
          },
          required_paths: ["README.md"]
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      path.join(manifestDir, "LocalSkill.skill.json"),
      JSON.stringify(
        {
          id: "LocalSkill",
          kind: "agent_skill",
          cache: {
            development_root: "skills/local/local-skill"
          },
          required_paths: ["SKILL.md"]
        },
        null,
        2
      ),
      "utf8"
    );

    process.env.OPERATOR_SKILL_MANIFEST_DIR = manifestDir;

    expect(listSkillManifestIds()).toEqual(["AgentSkill", "CollectionSkill", "ExternalAgent", "LocalSkill"]);
    expect(listSkillManifests().map((entry) => entry.id)).toEqual(["AgentSkill", "CollectionSkill", "ExternalAgent", "LocalSkill"]);
    expect(listSyncableSkillManifests().map((entry) => entry.id)).toEqual(["AgentSkill", "CollectionSkill", "LocalSkill"]);
    expect(listSyncableSkillManifests({ includeExternal: true }).map((entry) => entry.id)).toEqual([
      "AgentSkill",
      "CollectionSkill",
      "ExternalAgent",
      "LocalSkill"
    ]);
  });

  test("syncs all discovered manifests from existing local caches", async () => {
    const cachedSkillRoot = path.join(root, "runtime", "CachedSkill");
    mkdirSync(cachedSkillRoot, { recursive: true });
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(path.join(cachedSkillRoot, "SKILL.md"), "# CachedSkill\n", "utf8");
    writeFileSync(
      path.join(manifestDir, "CachedSkill.skill.json"),
      JSON.stringify(
        {
          id: "CachedSkill",
          kind: "agent_skill",
          source: {
            type: "git",
            repo: "https://example.com/cached-skill.git"
          },
          cache: {
            development_root: path.relative(repoRoot(), cachedSkillRoot).split(path.sep).join("/")
          },
          required_paths: ["SKILL.md"]
        },
        null,
        2
      ),
      "utf8"
    );

    process.env.OPERATOR_SKILL_MANIFEST_DIR = manifestDir;
    process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = path.join(root, "capability-state");

    await expect(syncAllCapabilities({ kind: "skill" })).resolves.toMatchObject([
      {
        capability_id: "CachedSkill",
        source: { root: cachedSkillRoot },
        source_type: "imported",
        status: "enabled"
      }
    ]);
  });

  test("installs local skills through the standard workflow and requires a successful receipt", async () => {
    const installedSkillRoot = path.join(root, "runtime", "InstalledSkill");
    const runtimeCacheRoot = path.join(root, "runtime-cache");
    const capabilityStateRoot = path.join(root, "capability-state");
    const expectedPipCacheDir = path.join(runtimeCacheRoot, "_pip-cache");
    mkdirSync(installedSkillRoot, { recursive: true });
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(path.join(installedSkillRoot, "SKILL.md"), "# InstalledSkill\n", "utf8");
    writeFileSync(
      path.join(manifestDir, "InstalledSkill.skill.json"),
      JSON.stringify(
        {
          id: "InstalledSkill",
          kind: "agent_skill",
          cache: {
            development_root: path.relative(repoRoot(), installedSkillRoot).split(path.sep).join("/")
          },
          entrypoints: {
            skill: "SKILL.md"
          },
          required_paths: ["SKILL.md"],
          execution: {
            required_entrypoints: ["skill"]
          },
          configuration: {
            providers: [
              {
                id: "test-model",
                interface: "openai-compatible-chat",
                required: true,
                env: {
                  apiKey: "OPERATOR_TEST_MODEL_API_KEY"
                }
              }
            ]
          },
          install: {
            smoke_tests: [
              {
                name: "skill_file_readable",
                command: "test -s {skill_root}/SKILL.md"
              },
              {
                name: "shared_pip_cache_env",
                command: `test "$PIP_CACHE_DIR" = "${expectedPipCacheDir}" && test "{pip_cache_dir}" = "${expectedPipCacheDir}"`
              }
            ],
            capability_tests: [
              {
                name: "golden_artifact",
                command: "mkdir -p {workspace}/out && printf 'validated' > {workspace}/out/result.txt",
                expectedArtifacts: [{ path: "out/result.txt", type: "file", minBytes: 4 }]
              }
            ]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    process.env.OPERATOR_SKILL_MANIFEST_DIR = manifestDir;
    process.env.OPERATOR_RUNTIME_CACHE_ROOT = runtimeCacheRoot;
    process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = capabilityStateRoot;
    process.env.OPERATOR_TEST_MODEL_API_KEY = "test-key";
    delete process.env.PIP_CACHE_DIR;
    delete process.env.OPERATOR_PIP_CACHE_DIR;

    expect(() => requireEnabledCapability("InstalledSkill")).toThrow(/not installed through the Operator capability lifecycle/u);
    const report = await syncCapability("InstalledSkill", { kind: "skill" });
    expect(report.status).toBe("enabled");
    expect(report.stages.map((stage) => stage.phase)).toEqual(["install", "configure", "validate", "register", "deploy", "enable"]);
    expect(report.receipt_path).toContain("capability-state");
    expect(report.checks.some((check) => check.name.endsWith(":smoke:skill_file_readable") && check.status === "passed")).toBe(true);
    expect(report.checks.some((check) => check.name.endsWith(":smoke:shared_pip_cache_env") && check.status === "passed")).toBe(true);
    expect(report.checks.some((check) => check.name.endsWith(":provider:test-model:apiKey:OPERATOR_TEST_MODEL_API_KEY") && check.status === "passed")).toBe(true);
    expect(report.checks.some((check) => check.name.endsWith(":capability:golden_artifact") && check.status === "passed")).toBe(true);
    expect(resolveSkillCapabilityReceipt("InstalledSkill")?.status).toBe("enabled");
    expect(requireEnabledCapability("InstalledSkill").receipt_path).toBe(report.receipt_path);
  });

  test("keeps failed skill installs unavailable with a failed receipt", async () => {
    const brokenSkillRoot = path.join(root, "runtime", "BrokenSkill");
    const capabilityStateRoot = path.join(root, "capability-state");
    mkdirSync(brokenSkillRoot, { recursive: true });
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(path.join(brokenSkillRoot, "SKILL.md"), "# BrokenSkill\n", "utf8");
    writeFileSync(
      path.join(manifestDir, "BrokenSkill.skill.json"),
      JSON.stringify(
        {
          id: "BrokenSkill",
          kind: "agent_skill",
          cache: {
            development_root: path.relative(repoRoot(), brokenSkillRoot).split(path.sep).join("/")
          },
          required_paths: ["SKILL.md"],
          install: {
            smoke_tests: [
              {
                name: "intentional_failure",
                command: "echo broken >&2; exit 9"
              }
            ]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    process.env.OPERATOR_SKILL_MANIFEST_DIR = manifestDir;
    process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = capabilityStateRoot;

    await expect(syncCapability("BrokenSkill", { kind: "skill" })).rejects.toThrow(/Capability installation failed/u);
    const report = resolveSkillCapabilityReceipt("BrokenSkill");
    expect(report?.status).toBe("failed");
    expect(report?.checks.some((check) => check.name.endsWith(":smoke:intentional_failure") && check.status === "failed")).toBe(true);
    expect(() => requireEnabledCapability("BrokenSkill")).toThrow(/capability status is failed/u);
  });
});
