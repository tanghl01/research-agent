import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { runCommand } from "../process.js";
import { repoRoot } from "../workspace.js";
import { capabilityReceiptPath, capabilityInstallStateRoot, resolveRepoPath, sanitizePathSegment, sha256Text, writeCapabilityInstallReceipt } from "./receipts.js";
import {
  CapabilityInstallError,
  type CapabilityCheckResult,
  type CapabilityDescriptor,
  type CapabilityInstallOptions,
  type CapabilityInstallReceipt,
  type CapabilityStageReceipt
} from "./types.js";

export type SkillRuntimeType = "none" | "python_venv" | "node" | "container" | "external";

export type SkillRuntimeSpec = {
  type: SkillRuntimeType;
  cache_env?: string;
  cache_key_files?: string[];
  setup?: {
    cwd?: string;
    commands?: string[];
    complete_marker?: string;
  };
  env?: Record<string, string>;
  commands?: Record<string, string>;
  notes?: string[];
};

export type SkillInstallCommandSpec = {
  name: string;
  command: string;
  cwd?: string;
  timeout_ms?: number;
  timeoutMs?: number;
  required?: boolean;
  type?: string;
  source?: string;
  expectedArtifacts?: Array<{
    path: string;
    type?: string;
    minBytes?: number;
    maxBytes?: number;
  }>;
};

export type SkillInstallSpec = {
  required_env?: string[];
  optional_env?: string[];
  smoke_tests?: SkillInstallCommandSpec[];
  capability_tests?: SkillInstallCommandSpec[];
};

export type SkillProviderSpec = {
  id: string;
  interface: string;
  required?: boolean;
  env?: Record<string, string>;
  compatibleProviders?: string[];
};

export type SkillConfigurationSpec = {
  requiredEnv?: string[];
  optionalEnv?: string[];
  providers?: SkillProviderSpec[];
  secrets?: string[];
};

export type SkillValidationSpec = {
  capability_tests?: SkillInstallCommandSpec[];
  capabilityTests?: SkillInstallCommandSpec[];
};

export type SkillExecutionPolicy = {
  evidence_entrypoint?: string;
  required_entrypoints?: string[];
  required_commands?: string[];
  adapter_paths?: string[];
  agent_guard?: {
    blocked_tool_action_patterns?: string[];
    blocked_tool_action_message?: string;
  };
  notes?: string[];
};

export type SkillSubskillManifest = {
  display_name?: string;
  description?: string;
  root_subpath?: string;
  entrypoints?: Record<string, string>;
  required_paths?: string[];
  runtime?: SkillRuntimeSpec;
  install?: SkillInstallSpec;
  configuration?: SkillConfigurationSpec;
  validation?: SkillValidationSpec;
  execution?: SkillExecutionPolicy;
};

export type SkillManifest = {
  id: string;
  kind: string;
  display_name?: string;
  description?: string;
  source?: {
    type: "git";
    repo: string;
    ref?: string;
    commit?: string;
  };
  cache?: {
    development_root?: string;
    root_subpath?: string;
    production_root_env?: string;
    production_path_template?: string;
  };
  env?: {
    root_override?: string;
  };
  entrypoints?: Record<string, string>;
  required_paths?: string[];
  runtime?: SkillRuntimeSpec;
  install?: SkillInstallSpec;
  configuration?: SkillConfigurationSpec;
  validation?: SkillValidationSpec;
  execution?: SkillExecutionPolicy;
  subskills?: Record<string, SkillSubskillManifest>;
  license?: Record<string, unknown>;
};

export type SyncableSkillManifest = {
  id: string;
  manifest: SkillManifest;
  manifestPath: string;
};

export type SkillRootResolution = {
  id: string;
  root: string;
  manifestPath: string;
  source: "env_override" | "generic_env_override" | "production_cache" | "development_cache";
  manifest: SkillManifest;
};

export type SkillExecutionTarget = {
  id: string;
  subskillId?: string;
  root: string;
  sourceRoot: string;
  manifestPath: string;
  source: SkillRootResolution["source"];
  manifest: SkillManifest;
  subskill?: SkillSubskillManifest;
  entrypoints: Record<string, string>;
  requiredPaths: string[];
  execution: SkillExecutionPolicy;
};

export type SkillAdapterFile = {
  path: string;
  sha256: string;
};

export type SkillRuntimeResolution = {
  type: SkillRuntimeType;
  cache_key: string;
  cache_root: string;
  runtime_root: string;
  setup_cwd?: string;
  setup_commands: string[];
  setup_complete_path?: string;
  env: Record<string, string>;
  commands: Record<string, string>;
  notes: string[];
  cache_key_files: Array<{
    path: string;
    sha256?: string;
    missing?: boolean;
  }>;
};

export type SkillInstallCheckStatus = "passed" | "failed" | "skipped";

export type SkillInstallCheckResult = {
  name: string;
  status: SkillInstallCheckStatus;
  required: boolean;
  message?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
};

export type SkillCapabilityUnitReport = {
  id: string;
  subskill_id?: string;
  root: string;
  runtime?: SkillRuntimeResolution;
  checks: SkillInstallCheckResult[];
};

export type SkillCapabilityAdapterReport = {
  schema: "operator.capability.skill-adapter-report.v1";
  id: string;
  root: string;
  source: SkillRootResolution["source"];
  manifestPath: string;
  manifest_sha256: string;
  install_key: string;
  status: "installed" | "failed";
  installed_at: string;
  receipt_path: string;
  units: SkillCapabilityUnitReport[];
  checks: SkillInstallCheckResult[];
  error?: string;
};

export type SyncSkillOptions = {
  force?: boolean;
  timeoutMs?: number;
};

export type SyncableSkillManifestOptions = {
  includeExternal?: boolean;
};

export function skillManifestDir(): string {
  return path.resolve(process.env.OPERATOR_SKILL_MANIFEST_DIR || path.join(repoRoot(), "skills", "manifests"));
}

export function loadSkillManifest(skillId: string): { manifest: SkillManifest; manifestPath: string } {
  const manifestPath = path.join(skillManifestDir(), `${skillId}.skill.json`);
  if (!existsSync(manifestPath)) {
    throw new Error(`Skill manifest not found for ${skillId}: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SkillManifest;
  if (!manifest.id) throw new Error(`Skill manifest is missing id: ${manifestPath}`);
  return { manifest, manifestPath };
}

export function listSkillManifestIds(): string[] {
  const manifestDir = skillManifestDir();
  if (!existsSync(manifestDir)) return [];
  return readdirSync(manifestDir)
    .filter((filename) => filename.endsWith(".skill.json"))
    .map((filename) => filename.slice(0, -".skill.json".length))
    .sort((left, right) => left.localeCompare(right));
}

export function listSkillManifests(): SyncableSkillManifest[] {
  return listSkillManifestIds().map((id) => {
    const { manifest, manifestPath } = loadSkillManifest(id);
    return { id: manifest.id, manifest, manifestPath };
  });
}

export function listSyncableSkillManifests(options: SyncableSkillManifestOptions = {}): SyncableSkillManifest[] {
  return listSkillManifests().filter(({ manifest }) => isSyncableSkillManifest(manifest, options));
}

export function isSyncableSkillManifest(manifest: SkillManifest, options: SyncableSkillManifestOptions = {}): boolean {
  if (options.includeExternal) return true;
  return manifest.kind === "agent_skill" || manifest.kind === "agent_skill_collection";
}

function capabilityDescriptorFromSkillRoot(rootInfo: SkillRootResolution): CapabilityDescriptor {
  const adapterType = rootInfo.manifest.kind === "external_agent_package" ? "generic-github" : "agent-skill";
  const sourceType = rootInfo.manifest.source ? "imported" : "bundled";
  return {
    id: rootInfo.manifest.id,
    kind: rootInfo.manifest.kind === "external_agent_package" ? "agent" : "skill",
    displayName: rootInfo.manifest.display_name ?? rootInfo.manifest.id,
    description: rootInfo.manifest.description,
    source: {
      type: sourceType,
      provider: rootInfo.manifest.source?.type === "git" ? "github" : "local",
      repo: rootInfo.manifest.source?.repo,
      ref: rootInfo.manifest.source?.ref,
      commit: rootInfo.manifest.source?.commit,
      root: rootInfo.root
    },
    adapter: {
      type: adapterType,
      entrypoints: rootInfo.manifest.entrypoints
    },
    runtime: rootInfo.manifest.runtime
      ? {
          type: rootInfo.manifest.runtime.type,
          commands: rootInfo.manifest.runtime.commands,
          cacheKeyFiles: rootInfo.manifest.runtime.cache_key_files
        }
      : undefined,
    configuration: {
      requiredEnv: uniqueStrings([...(rootInfo.manifest.install?.required_env ?? []), ...(rootInfo.manifest.configuration?.requiredEnv ?? [])]),
      optionalEnv: uniqueStrings([...(rootInfo.manifest.install?.optional_env ?? []), ...(rootInfo.manifest.configuration?.optionalEnv ?? [])]),
      providers: rootInfo.manifest.configuration?.providers ?? [],
      secrets: rootInfo.manifest.configuration?.secrets ?? []
    },
    validation: {
      requiredPaths: rootInfo.manifest.required_paths ?? [],
      smokeTests: rootInfo.manifest.install?.smoke_tests ?? [],
      capabilityTests: [
        ...(rootInfo.manifest.validation?.capability_tests ?? []),
        ...(rootInfo.manifest.validation?.capabilityTests ?? []),
        ...(rootInfo.manifest.install?.capability_tests ?? [])
      ]
    },
    license: rootInfo.manifest.license,
    manifestPath: rootInfo.manifestPath,
    manifestSha256: sha256Text(readFileSync(rootInfo.manifestPath)),
    compatibilityLevel: adapterType === "generic-github" ? "generic-open-source" : "operator-compatible",
    sourceType,
    legacySkillId: rootInfo.manifest.id
  };
}

export function skillInstallStateRoot(): string {
  return capabilityInstallStateRoot();
}

export function skillPipCacheDir(): string {
  const configured = process.env.OPERATOR_PIP_CACHE_DIR || process.env.PIP_CACHE_DIR;
  if (configured?.trim()) return resolveRepoPath(configured);
  const runtimeRoot = process.env.OPERATOR_RUNTIME_CACHE_ROOT
    ? resolveRepoPath(process.env.OPERATOR_RUNTIME_CACHE_ROOT)
    : path.join(repoRoot(), "tmp", "runtimes");
  return path.join(runtimeRoot, "_pip-cache");
}

export function resolveSkillRoot(skillId: string): string {
  return resolveSkillRootInfo(skillId).root;
}

export function resolveSkillRootInfo(skillId: string): SkillRootResolution {
  const { manifest, manifestPath } = loadSkillManifest(skillId);
  const candidates = skillRootCandidates(manifest);
  for (const candidate of candidates) {
    if (existsSync(candidate.root) && statSync(candidate.root).isDirectory()) {
      assertSkillRoot(manifest, candidate.root);
      return {
        id: manifest.id,
        root: candidate.root,
        manifestPath,
        source: candidate.source,
        manifest
      };
    }
  }
  throw new Error(
    [
      `Skill root not found for ${skillId}.`,
      `Manifest: ${manifestPath}`,
      "Tried:",
      ...candidates.map((candidate) => `- ${candidate.source}: ${candidate.root}`),
      `Run "pnpm capabilities:sync ${skillId} --kind skill" or set ${manifest.env?.root_override ?? genericSkillRootEnv(manifest.id)}.`
    ].join("\n")
  );
}

export function resolveSkillEntrypoint(skillId: string, entrypointName: string, root?: string): string {
  const { manifest } = loadSkillManifest(skillId);
  const relativePath = manifest.entrypoints?.[entrypointName];
  if (!relativePath) {
    throw new Error(`Skill ${skillId} has no entrypoint named ${entrypointName}`);
  }
  return path.join(root ?? resolveSkillRoot(skillId), relativePath);
}

export function listSkillSubskills(skillId: string): Array<{ id: string; manifest: SkillSubskillManifest }> {
  const { manifest } = loadSkillManifest(skillId);
  return Object.entries(manifest.subskills ?? {}).map(([id, subskill]) => ({ id, manifest: subskill }));
}

export function resolveSkillExecutionTarget(skillId: string, subskillId?: string): SkillExecutionTarget {
  const rootInfo = resolveSkillRootInfo(skillId);
  if (!subskillId) {
    return {
      id: rootInfo.id,
      root: rootInfo.root,
      sourceRoot: rootInfo.root,
      manifestPath: rootInfo.manifestPath,
      source: rootInfo.source,
      manifest: rootInfo.manifest,
      entrypoints: rootInfo.manifest.entrypoints ?? {},
      requiredPaths: rootInfo.manifest.required_paths ?? [],
      execution: mergeExecutionPolicies(undefined, rootInfo.manifest.execution)
    };
  }

  const subskill = rootInfo.manifest.subskills?.[subskillId];
  if (!subskill) {
    throw new Error(`Skill ${skillId} has no subskill named ${subskillId}`);
  }
  const root = path.resolve(rootInfo.root, subskill.root_subpath ?? ".");
  assertRequiredPaths(`${skillId}.${subskillId}`, root, subskill.required_paths ?? []);
  return {
    id: rootInfo.id,
    subskillId,
    root,
    sourceRoot: rootInfo.root,
    manifestPath: rootInfo.manifestPath,
    source: rootInfo.source,
    manifest: rootInfo.manifest,
    subskill,
    entrypoints: subskill.entrypoints ?? {},
    requiredPaths: subskill.required_paths ?? [],
    execution: mergeExecutionPolicies(rootInfo.manifest.execution, subskill.execution)
  };
}

export function resolveSkillAdapterFiles(skillId: string, subskillId?: string): SkillAdapterFile[] {
  const target = resolveSkillExecutionTarget(skillId, subskillId);
  return (target.execution.adapter_paths ?? []).map((adapterPath) => {
    const absolutePath = path.resolve(repoRoot(), adapterPath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Skill adapter file not found for ${skillId}${subskillId ? `.${subskillId}` : ""}: ${absolutePath}`);
    }
    return {
      path: absolutePath,
      sha256: sha256Text(readFileSync(absolutePath))
    };
  });
}

export function resolveSkillRuntimeInfo(skillId: string, subskillId?: string): SkillRuntimeResolution | undefined {
  const target = resolveSkillExecutionTarget(skillId, subskillId);
  const runtime = target.subskill?.runtime ?? target.manifest.runtime;
  if (!runtime || runtime.type === "none") return undefined;

  const cacheRoot = path.resolve(
    process.env[runtime.cache_env ?? "OPERATOR_RUNTIME_CACHE_ROOT"]
      ? resolveRepoPath(process.env[runtime.cache_env ?? "OPERATOR_RUNTIME_CACHE_ROOT"] as string)
      : path.join(repoRoot(), "tmp", "runtimes")
  );
  const cacheKeyFiles = runtimeCacheKeyFiles(target, runtime);
  const cacheKey = runtimeCacheKey(target, runtime, cacheKeyFiles);
  const runtimeRoot = path.join(cacheRoot, sanitizePathSegment([skillId, subskillId].filter(Boolean).join("-")), cacheKey);
  const venv = path.join(runtimeRoot, ".venv");
  const setupCompletePath = path.join(runtimeRoot, runtime.setup?.complete_marker ?? ".operator-runtime-ready");
  const setupCwd = runtime.setup?.cwd ? path.resolve(target.root, runtime.setup.cwd) : target.root;
  const variables = {
    repo_root: repoRoot(),
    skill_root: target.root,
    source_root: target.sourceRoot,
    runtime_root: runtimeRoot,
    venv,
    python: path.join(venv, "bin", "python"),
    pip: path.join(venv, "bin", "pip"),
    system_python: process.env.OPERATOR_SYSTEM_PYTHON ?? process.env.PYTHON ?? "python3",
    setup_cwd: setupCwd,
    setup_complete_path: setupCompletePath
  };
  const defaultCommands =
    runtime.type === "python_venv"
      ? [
          "mkdir -p {runtime_root}",
          "test -x {python} || {system_python} -m venv {venv}",
          "{pip} install --upgrade pip",
          "touch {setup_complete_path}"
        ]
      : [];

  return {
    type: runtime.type,
    cache_key: cacheKey,
    cache_root: cacheRoot,
    runtime_root: runtimeRoot,
    setup_cwd: setupCwd,
    setup_commands: (runtime.setup?.commands ?? defaultCommands).map((command) => renderRuntimeTemplate(command, variables)),
    setup_complete_path: setupCompletePath,
    env: Object.fromEntries(Object.entries(runtime.env ?? {}).map(([key, value]) => [key, renderRuntimeTemplate(value, variables)])),
    commands: {
      ...(runtime.type === "python_venv"
        ? {
            python: variables.python,
            pip: variables.pip
          }
        : {}),
      ...Object.fromEntries(Object.entries(runtime.commands ?? {}).map(([key, value]) => [key, renderRuntimeTemplate(value, variables)]))
    },
    notes: runtime.notes ?? [],
    cache_key_files: cacheKeyFiles
  };
}

export function resolveSkillCapabilityReceipt(skillId: string): CapabilityInstallReceipt | undefined {
  const rootInfo = resolveSkillRootInfo(skillId);
  const descriptor = capabilityDescriptorFromSkillRoot(rootInfo);
  const reportPath = skillCapabilityReceiptPath(descriptor, rootInfo);
  if (!existsSync(reportPath)) return undefined;
  try {
    return JSON.parse(readFileSync(reportPath, "utf8")) as CapabilityInstallReceipt;
  } catch {
    return undefined;
  }
}

export function requireInstalledSkillCapability(skillId: string): CapabilityInstallReceipt {
  const rootInfo = resolveSkillRootInfo(skillId);
  const descriptor = capabilityDescriptorFromSkillRoot(rootInfo);
  const expectedPath = skillCapabilityReceiptPath(descriptor, rootInfo);
  if (!existsSync(expectedPath)) {
    throw new Error(
      [
        `Skill ${skillId} is not installed through the Operator capability lifecycle.`,
        `Expected install receipt: ${expectedPath}`,
        `Run "pnpm capabilities:sync ${skillId}" or "pnpm capabilities:sync --all --kind skill".`
      ].join("\n")
    );
  }
  const receipt = JSON.parse(readFileSync(expectedPath, "utf8")) as CapabilityInstallReceipt;
  if (receipt.status !== "enabled") {
    throw new Error(`Skill ${skillId} capability status is ${receipt.lifecycle_status}: ${receipt.error ?? expectedPath}`);
  }
  if (receipt.version_key !== skillInstallKey(rootInfo)) {
    throw new Error(
      [
        `Skill ${skillId} capability receipt is stale for the current manifest/source/runtime definition.`,
        `Receipt: ${expectedPath}`,
        `Run "pnpm capabilities:sync ${skillId}" to reinstall.`
      ].join("\n")
    );
  }
  return receipt;
}

function mergeExecutionPolicies(base: SkillExecutionPolicy | undefined, override: SkillExecutionPolicy | undefined): SkillExecutionPolicy {
  return {
    ...base,
    ...override,
    required_entrypoints: [...(base?.required_entrypoints ?? []), ...(override?.required_entrypoints ?? [])],
    required_commands: [...(base?.required_commands ?? []), ...(override?.required_commands ?? [])],
    adapter_paths: [...(base?.adapter_paths ?? []), ...(override?.adapter_paths ?? [])],
    agent_guard: mergeAgentGuards(base?.agent_guard, override?.agent_guard),
    notes: [...(base?.notes ?? []), ...(override?.notes ?? [])]
  };
}

function mergeAgentGuards(
  base: SkillExecutionPolicy["agent_guard"],
  override: SkillExecutionPolicy["agent_guard"]
): SkillExecutionPolicy["agent_guard"] {
  if (!base && !override) return undefined;
  return {
    ...base,
    ...override,
    blocked_tool_action_patterns: [...(base?.blocked_tool_action_patterns ?? []), ...(override?.blocked_tool_action_patterns ?? [])]
  };
}

async function syncSkillSource(skillId: string, options: SyncSkillOptions = {}): Promise<SkillRootResolution> {
  const { manifest, manifestPath } = loadSkillManifest(skillId);
  if (manifest.source?.type !== "git") {
    return resolveSkillRootInfo(skillId);
  }
  const target = syncTarget(manifest);
  if (existsSync(target) && !existsSync(path.join(target, ".git"))) {
    const resolvedTarget = skillRootWithinCache(manifest, target);
    assertSkillRoot(manifest, resolvedTarget);
    if (!options.force) {
      return {
        id: manifest.id,
        root: resolvedTarget,
        manifestPath,
        source: process.env[manifest.cache?.production_root_env ?? ""] ? "production_cache" : "development_cache",
        manifest
      };
    }
    rmSync(target, { recursive: true, force: true });
  }

  if (!existsSync(target)) {
    mkdirSync(path.dirname(target), { recursive: true });
    await runCommand("git", ["clone", "--depth", "1", "--branch", manifest.source.ref ?? "main", manifest.source.repo, target], {
      timeoutMs: options.timeoutMs ?? 300_000
    });
  } else {
    await runCommand("git", ["fetch", "--depth", "1", "origin", manifest.source.ref ?? "main"], {
      cwd: target,
      timeoutMs: options.timeoutMs ?? 300_000
    });
  }

  if (manifest.source.commit) {
    await runCommand("git", ["fetch", "--depth", "1", "origin", manifest.source.commit], {
      cwd: target,
      timeoutMs: options.timeoutMs ?? 300_000
    });
    await runCommand("git", ["checkout", "--detach", manifest.source.commit], {
      cwd: target,
      timeoutMs: options.timeoutMs ?? 300_000
    });
  }
  assertSkillRoot(manifest, skillRootWithinCache(manifest, target));
  return resolveSkillRootInfo(skillId);
}

export async function syncSkillCapability(
  descriptor: CapabilityDescriptor,
  options: CapabilityInstallOptions = {}
): Promise<CapabilityInstallReceipt> {
  const rootInfo = await syncSkillSource(descriptor.legacySkillId ?? descriptor.id, options);
  return installResolvedSkillCapability(descriptor, rootInfo, options);
}

async function installResolvedSkillCapability(
  descriptor: CapabilityDescriptor,
  rootInfo: SkillRootResolution,
  options: SyncSkillOptions
): Promise<CapabilityInstallReceipt> {
  const units = skillInstallUnits(rootInfo);
  const reportPath = skillCapabilityReceiptPath(descriptor, rootInfo);
  const installKey = skillInstallKey(rootInfo);
  const report: SkillCapabilityAdapterReport = {
    schema: "operator.capability.skill-adapter-report.v1",
    id: rootInfo.id,
    root: rootInfo.root,
    source: rootInfo.source,
    manifestPath: rootInfo.manifestPath,
    manifest_sha256: sha256Text(readFileSync(rootInfo.manifestPath)),
    install_key: installKey,
    status: "installed",
    installed_at: new Date().toISOString(),
    receipt_path: reportPath,
    units: [],
    checks: []
  };

  try {
    for (const unit of units) {
      report.units.push(await installSkillUnit(unit, options));
    }
    report.checks = report.units.flatMap((unit) => unit.checks);
    const failedRequired = report.checks.find((check) => check.required && check.status === "failed");
    if (failedRequired) {
      throw new Error(failedRequired.message ?? `Required install check failed: ${failedRequired.name}`);
    }
    report.status = "installed";
    const receipt = skillCapabilityReceiptFromReport(descriptor, report);
    writeCapabilityInstallReceipt(receipt);
    const failedCapabilityCheck = receipt.checks.find((check) => check.required && check.status === "failed");
    if (failedCapabilityCheck) {
      throw new Error(failedCapabilityCheck.message ?? `Required capability check failed: ${failedCapabilityCheck.name}`);
    }
    return receipt;
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : String(error);
    report.checks = report.units.flatMap((unit) => unit.checks);
    const receipt = skillCapabilityReceiptFromReport(descriptor, report);
    writeCapabilityInstallReceipt(receipt);
    throw new CapabilityInstallError(receipt);
  }
}

type SkillInstallUnit = {
  id: string;
  subskillId?: string;
  target: SkillExecutionTarget;
  install?: SkillInstallSpec;
  configuration?: SkillConfigurationSpec;
  validation?: SkillValidationSpec;
  runtime?: SkillRuntimeResolution;
};

function skillInstallUnits(rootInfo: SkillRootResolution): SkillInstallUnit[] {
  const rootTarget = resolveSkillExecutionTarget(rootInfo.id);
  const units: SkillInstallUnit[] = [
    {
      id: rootInfo.id,
      target: rootTarget,
      install: rootInfo.manifest.install,
      configuration: rootInfo.manifest.configuration,
      validation: rootInfo.manifest.validation,
      runtime: resolveSkillRuntimeInfo(rootInfo.id)
    }
  ];
  for (const [subskillId, subskill] of Object.entries(rootInfo.manifest.subskills ?? {})) {
    const target = resolveSkillExecutionTarget(rootInfo.id, subskillId);
    units.push({
      id: `${rootInfo.id}.${subskillId}`,
      subskillId,
      target,
      install: subskill.install,
      configuration: subskill.configuration,
      validation: subskill.validation,
      runtime: resolveSkillRuntimeInfo(rootInfo.id, subskillId)
    });
  }
  return units;
}

async function installSkillUnit(unit: SkillInstallUnit, options: SyncSkillOptions): Promise<SkillCapabilityUnitReport> {
  const checks: SkillInstallCheckResult[] = [];
  const report: SkillCapabilityUnitReport = {
    id: unit.id,
    subskill_id: unit.subskillId,
    root: unit.target.root,
    runtime: unit.runtime,
    checks
  };

  checks.push(...checkRequiredPaths(unit));
  checks.push(...checkRequiredEntrypoints(unit));
  checks.push(...checkRequiredRuntimeCommands(unit));
  checks.push(...checkEnvironment(unit));
  checks.push(...checkSkillConfiguration(unit));
  checks.push(...checkRuntimeCacheKeyFiles(unit));

  if (unit.runtime) {
    checks.push(await ensureRuntimeSetup(unit, options));
  } else {
    checks.push({
      name: `${unit.id}:runtime`,
      status: "passed",
      required: true,
      message: "No dedicated runtime declared; source and manifest checks are the install contract."
    });
  }

  for (const smokeTest of unit.install?.smoke_tests ?? []) {
    checks.push(await runInstallCommand(unit, smokeTest, options, "smoke"));
  }

  for (const capabilityTest of capabilityTestsForUnit(unit)) {
    checks.push(await runInstallCommand(unit, capabilityTest, options, "capability"));
  }

  return report;
}

function checkRequiredPaths(unit: SkillInstallUnit): SkillInstallCheckResult[] {
  const checks: SkillInstallCheckResult[] = [];
  for (const relativePath of unit.target.requiredPaths) {
    const filePath = path.join(unit.target.root, relativePath);
    checks.push({
      name: `${unit.id}:required_path:${relativePath}`,
      status: existsSync(filePath) ? "passed" : "failed",
      required: true,
      message: existsSync(filePath) ? filePath : `Missing required path: ${filePath}`
    });
  }
  return checks;
}

function checkRequiredEntrypoints(unit: SkillInstallUnit): SkillInstallCheckResult[] {
  const checks: SkillInstallCheckResult[] = [];
  for (const entrypointName of unit.target.execution.required_entrypoints ?? []) {
    const relativePath = unit.target.entrypoints[entrypointName];
    const filePath = relativePath ? path.join(unit.target.root, relativePath) : undefined;
    checks.push({
      name: `${unit.id}:required_entrypoint:${entrypointName}`,
      status: filePath && existsSync(filePath) ? "passed" : "failed",
      required: true,
      message: filePath && existsSync(filePath) ? filePath : `Missing required entrypoint ${entrypointName}`
    });
  }
  return checks;
}

function checkRequiredRuntimeCommands(unit: SkillInstallUnit): SkillInstallCheckResult[] {
  return (unit.target.execution.required_commands ?? []).map((commandName) => {
    const command = unit.runtime?.commands[commandName];
    return {
      name: `${unit.id}:required_command:${commandName}`,
      status: command ? "passed" : "failed",
      required: true,
      message: command ? command : `Missing runtime command ${commandName}`
    };
  });
}

function checkEnvironment(unit: SkillInstallUnit): SkillInstallCheckResult[] {
  const checks: SkillInstallCheckResult[] = [];
  const requiredEnv = uniqueStrings([...(unit.install?.required_env ?? []), ...(unit.configuration?.requiredEnv ?? [])]);
  const optionalEnv = uniqueStrings([...(unit.install?.optional_env ?? []), ...(unit.configuration?.optionalEnv ?? [])]).filter(
    (envName) => !requiredEnv.includes(envName)
  );
  for (const envName of requiredEnv) {
    const present = Boolean(process.env[envName]);
    checks.push({
      name: `${unit.id}:required_env:${envName}`,
      status: present ? "passed" : "failed",
      required: true,
      message: present ? `Environment variable ${envName} is configured.` : `Missing required environment variable ${envName}.`
    });
  }
  for (const envName of optionalEnv) {
    const present = Boolean(process.env[envName]);
    checks.push({
      name: `${unit.id}:optional_env:${envName}`,
      status: present ? "passed" : "skipped",
      required: false,
      message: present ? `Environment variable ${envName} is configured.` : `Optional environment variable ${envName} is not configured.`
    });
  }
  return checks;
}

function checkSkillConfiguration(unit: SkillInstallUnit): SkillInstallCheckResult[] {
  const checks: SkillInstallCheckResult[] = [];
  for (const secretName of unit.configuration?.secrets ?? []) {
    const present = Boolean(process.env[secretName]?.trim());
    checks.push({
      name: `${unit.id}:secret_ref:${secretName}`,
      status: present ? "passed" : "failed",
      required: true,
      message: present ? `Secret reference ${secretName} is configured.` : `Missing required secret reference ${secretName}.`
    });
  }
  for (const provider of unit.configuration?.providers ?? []) {
    const required = provider.required !== false;
    if (!provider.interface?.trim()) {
      checks.push({
        name: `${unit.id}:provider:${provider.id}:interface`,
        status: "failed",
        required: true,
        message: `Provider ${provider.id} must declare a compatible interface.`
      });
    }
    for (const [role, envName] of Object.entries(provider.env ?? {})) {
      const present = Boolean(process.env[envName]?.trim());
      checks.push({
        name: `${unit.id}:provider:${provider.id}:${role}:${envName}`,
        status: present ? "passed" : required ? "failed" : "skipped",
        required,
        message: present
          ? `Provider ${provider.id} ${role} is configured by ${envName}.`
          : `${required ? "Missing required" : "Optional"} provider ${provider.id} ${role} environment variable ${envName}.`
      });
    }
  }
  return checks;
}

function checkRuntimeCacheKeyFiles(unit: SkillInstallUnit): SkillInstallCheckResult[] {
  return (unit.runtime?.cache_key_files ?? []).map((file) => ({
    name: `${unit.id}:runtime_cache_key:${file.path}`,
    status: file.missing ? "failed" : "passed",
    required: true,
    message: file.missing ? `Missing runtime cache key file ${file.path}` : file.sha256
  }));
}

async function ensureRuntimeSetup(unit: SkillInstallUnit, options: SyncSkillOptions): Promise<SkillInstallCheckResult> {
  const runtime = unit.runtime;
  if (!runtime) {
    return {
      name: `${unit.id}:runtime_setup`,
      status: "passed",
      required: true,
      message: "No runtime setup required."
    };
  }

  try {
    if (runtime.setup_commands.length === 0) {
      return {
        name: `${unit.id}:runtime_setup`,
        status: "passed",
        required: true,
        message: `Runtime type ${runtime.type} has no local setup commands.`
      };
    }

    if (runtime.setup_complete_path && existsSync(runtime.setup_complete_path) && !options.force) {
      return {
        name: `${unit.id}:runtime_setup`,
        status: "passed",
        required: true,
        message: `Runtime already installed: ${runtime.setup_complete_path}`
      };
    }

    for (const command of runtime.setup_commands) {
      await runShellCommand(command, {
        cwd: runtime.setup_cwd ?? unit.target.root,
        env: runtime.env,
        timeoutMs: options.timeoutMs ?? 600_000
      });
    }

    if (runtime.setup_complete_path && !existsSync(runtime.setup_complete_path)) {
      return {
        name: `${unit.id}:runtime_setup`,
        status: "failed",
        required: true,
        message: `Runtime setup did not create completion marker: ${runtime.setup_complete_path}`
      };
    }
    return {
      name: `${unit.id}:runtime_setup`,
      status: "passed",
      required: true,
      message: runtime.setup_complete_path ? `Runtime installed: ${runtime.setup_complete_path}` : "Runtime setup completed."
    };
  } catch (error) {
    return {
      name: `${unit.id}:runtime_setup`,
      status: "failed",
      required: true,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runInstallCommand(
  unit: SkillInstallUnit,
  installCommand: SkillInstallCommandSpec,
  options: SyncSkillOptions,
  checkKind: "smoke" | "capability"
): Promise<SkillInstallCheckResult> {
  const required = installCommand.required !== false;
  const cwd = installCommand.cwd ? path.resolve(unit.target.root, installCommand.cwd) : unit.target.root;
  const workspace = installCommandWorkspace(unit, installCommand, checkKind);
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  const command = renderRuntimeTemplate(installCommand.command, installTemplateVariables(unit, workspace));
  try {
    const result = await runShellCommand(command, {
      cwd,
      env: unit.runtime?.env,
      timeoutMs: installCommand.timeoutMs ?? installCommand.timeout_ms ?? options.timeoutMs ?? 120_000
    });
    const artifactFailure = checkExpectedArtifacts(workspace, installCommand.expectedArtifacts ?? []).find(
      (check) => check.required && check.status === "failed"
    );
    if (artifactFailure) {
      return {
        name: `${unit.id}:${checkKind}:${installCommand.name}`,
        status: required ? "failed" : "skipped",
        required,
        message: artifactFailure.message,
        stdout: truncate(result.stdout),
        stderr: truncate(result.stderr),
        exit_code: result.exitCode
      };
    }
    return {
      name: `${unit.id}:${checkKind}:${installCommand.name}`,
      status: "passed",
      required,
      message: command,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
      exit_code: result.exitCode
    };
  } catch (error) {
    return {
      name: `${unit.id}:${checkKind}:${installCommand.name}`,
      status: required ? "failed" : "skipped",
      required,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runShellCommand(command: string, options: { cwd: string; timeoutMs?: number; env?: Record<string, string> }) {
  const pipCacheDir = skillPipCacheDir();
  mkdirSync(pipCacheDir, { recursive: true });
  return runCommand("bash", ["-lc", command], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...(options.env ?? {}),
      PIP_CACHE_DIR: pipCacheDir
    },
    timeoutMs: options.timeoutMs
  });
}

function installTemplateVariables(unit: SkillInstallUnit, workspace?: string): Record<string, string> {
  const runtime = unit.runtime;
  const runtimeRoot = runtime?.runtime_root ?? path.join(skillInstallStateRoot(), "runtimeless", sanitizePathSegment(unit.id));
  const venv = runtime ? path.join(runtime.runtime_root, ".venv") : "";
  const variables: Record<string, string> = {
    repo_root: repoRoot(),
    skill_root: unit.target.root,
    source_root: unit.target.sourceRoot,
    runtime_root: runtimeRoot,
    workspace: workspace ?? path.join(skillInstallStateRoot(), "_workspaces", sanitizePathSegment(unit.id), "default"),
    venv,
    python: runtime?.commands.python ?? process.env.OPERATOR_SYSTEM_PYTHON ?? process.env.PYTHON ?? "python3",
    pip: runtime?.commands.pip ?? "pip",
    system_python: process.env.OPERATOR_SYSTEM_PYTHON ?? process.env.PYTHON ?? "python3",
    pip_cache_dir: skillPipCacheDir(),
    setup_cwd: runtime?.setup_cwd ?? unit.target.root,
    setup_complete_path: runtime?.setup_complete_path ?? ""
  };
  for (const [name, value] of Object.entries(runtime?.commands ?? {})) {
    variables[`runtime.commands.${name}`] = value;
  }
  return variables;
}

export function currentSkillCapabilityVersionKey(skillId: string): string {
  return skillInstallKey(resolveSkillRootInfo(skillId));
}

function skillCapabilityReceiptPath(descriptor: CapabilityDescriptor, rootInfo: SkillRootResolution): string {
  return capabilityReceiptPath(descriptor, skillInstallKey(rootInfo));
}

function skillCapabilityReceiptFromReport(descriptor: CapabilityDescriptor, report: SkillCapabilityAdapterReport): CapabilityInstallReceipt {
  const stages = skillCapabilityStagesFromReport(descriptor, report);
  const failedRequired = stages.flatMap((entry) => entry.checks).find((check) => check.required && check.status === "failed");
  return {
    schema: "operator.capability.install.v1",
    capability_id: descriptor.id,
    kind: descriptor.kind,
    adapter_type: descriptor.adapter.type,
    compatibility_level: descriptor.compatibilityLevel,
    source_type: descriptor.sourceType,
    version_key: report.install_key,
    lifecycle_status: failedRequired || report.status === "failed" ? "failed" : "enabled",
    status: failedRequired || report.status === "failed" ? "failed" : "enabled",
    manifest_path: descriptor.manifestPath ?? report.manifestPath,
    manifest_sha256: descriptor.manifestSha256 ?? report.manifest_sha256,
    source: {
      ...descriptor.source,
      type: descriptor.source?.type ?? descriptor.sourceType,
      root: report.root
    },
    receipt_path: report.receipt_path,
    completed_at: report.installed_at,
    stages,
    checks: stages.flatMap((entry) => entry.checks),
    error: report.error
  };
}

function skillCapabilityStagesFromReport(
  descriptor: CapabilityDescriptor,
  report: SkillCapabilityAdapterReport
): CapabilityStageReceipt[] {
  const installChecks: CapabilityCheckResult[] = [];
  const configureChecks: CapabilityCheckResult[] = [];
  const validateChecks: CapabilityCheckResult[] = [];
  for (const check of report.checks) {
    const phase = skillCheckPhase(check);
    const converted = convertSkillCheck(check, phase);
    if (phase === "configure") configureChecks.push(converted);
    else if (phase === "validate") validateChecks.push(converted);
    else installChecks.push(converted);
  }
  const stages: CapabilityStageReceipt[] = [];
  if (installChecks.length) stages.push(stage("install", installChecks));
  if (configureChecks.length) stages.push(stage("configure", configureChecks));
  if (validateChecks.length) stages.push(stage("validate", validateChecks));
  if (report.status === "installed") {
    const registerChecks = checkSkillCapabilityRegistration(descriptor, report);
    stages.push(stage("register", registerChecks));
    if (!registerChecks.some((check) => check.required && check.status === "failed")) {
      stages.push(stage("deploy", checkSkillCapabilityDeployment(descriptor, report)));
    }
    const failedRequired = stages.flatMap((entry) => entry.checks).find((check) => check.required && check.status === "failed");
    if (!failedRequired) stages.push(pass(`${descriptor.id}:enable`, "Capability is enabled for the current environment.", "enable"));
  }
  if (stages.length === 0) {
    stages.push(stage("install", [fail(`${descriptor.id}:install`, report.error ?? "Skill capability install did not produce checks.")]));
  }
  return stages;
}

function checkSkillCapabilityRegistration(descriptor: CapabilityDescriptor, report: SkillCapabilityAdapterReport): CapabilityCheckResult[] {
  return [
    {
      phase: "register",
      name: `${descriptor.id}:registry:descriptor`,
      status: descriptor.legacySkillId === report.id || descriptor.id === report.id ? "passed" : "failed",
      required: true,
      message:
        descriptor.legacySkillId === report.id || descriptor.id === report.id
          ? `Capability descriptor maps to skill ${report.id}.`
          : `Capability descriptor ${descriptor.id} does not map to skill ${report.id}.`
    },
    {
      phase: "register",
      name: `${descriptor.id}:registry:manifest`,
      status: descriptor.manifestPath && existsSync(descriptor.manifestPath) ? "passed" : "failed",
      required: true,
      message:
        descriptor.manifestPath && existsSync(descriptor.manifestPath)
          ? `Capability manifest is registered: ${descriptor.manifestPath}`
          : "Capability manifest path is missing."
    }
  ];
}

function checkSkillCapabilityDeployment(descriptor: CapabilityDescriptor, report: SkillCapabilityAdapterReport): CapabilityCheckResult[] {
  const checks: CapabilityCheckResult[] = [];
  for (const unit of report.units) {
    const rootExists = existsSync(unit.root);
    checks.push({
      phase: "deploy",
      name: `${unit.id}:workspace_binding:root`,
      status: rootExists ? "passed" : "failed",
      required: true,
      message: rootExists ? `Skill source root is bindable: ${unit.root}` : `Skill source root is missing: ${unit.root}`
    });
    const runtimeReady = !unit.runtime?.setup_complete_path || existsSync(unit.runtime.setup_complete_path);
    checks.push({
      phase: "deploy",
      name: `${unit.id}:runtime_binding`,
      status: runtimeReady ? "passed" : "failed",
      required: true,
      message: runtimeReady
        ? "Runtime binding is ready for the skill adapter."
        : `Runtime completion marker is missing: ${unit.runtime?.setup_complete_path}`
    });
  }
  checks.push({
    phase: "deploy",
    name: `${descriptor.id}:adapter:${descriptor.adapter.type}`,
    status: descriptor.adapter.type === "agent-skill" || descriptor.adapter.type === "generic-github" ? "passed" : "failed",
    required: true,
    message:
      descriptor.adapter.type === "agent-skill" || descriptor.adapter.type === "generic-github"
        ? `Skill capability is bound to adapter ${descriptor.adapter.type}.`
        : `Unsupported skill adapter type: ${descriptor.adapter.type}`
  });
  return checks;
}

function skillCheckPhase(check: SkillInstallCheckResult): CapabilityCheckResult["phase"] {
  if (check.name.includes(":capability:")) return "validate";
  if (
    check.name.includes(":required_env:") ||
    check.name.includes(":optional_env:") ||
    check.name.includes(":provider:") ||
    check.name.includes(":secret_ref:")
  ) {
    return "configure";
  }
  return "install";
}

function convertSkillCheck(check: SkillInstallCheckResult, phase: CapabilityCheckResult["phase"]): CapabilityCheckResult {
  return {
    phase,
    name: check.name,
    status: check.status,
    required: check.required,
    message: check.message,
    stdout: check.stdout,
    stderr: check.stderr,
    exit_code: check.exit_code
  };
}

function stage(phase: CapabilityCheckResult["phase"], checks: CapabilityCheckResult[]): CapabilityStageReceipt {
  return {
    phase,
    status: checks.some((check) => check.required && check.status === "failed") ? "failed" : "passed",
    checks
  };
}

function pass(name: string, message: string, phase: CapabilityCheckResult["phase"] = "enable"): CapabilityStageReceipt {
  return {
    phase,
    status: "passed",
    checks: [
      {
        phase,
        name,
        status: "passed",
        required: true,
        message
      }
    ]
  };
}

function fail(name: string, message: string, phase: CapabilityCheckResult["phase"] = "install"): CapabilityCheckResult {
  return {
    phase,
    name,
    status: "failed",
    required: true,
    message
  };
}

function skillInstallKey(rootInfo: SkillRootResolution): string {
  const units = skillInstallUnitsForKey(rootInfo);
  return sha256Text(
    JSON.stringify({
      id: rootInfo.id,
      source: rootInfo.manifest.source,
      source_kind: rootInfo.source,
      root: rootInfo.root,
      manifest_sha256: sha256Text(readFileSync(rootInfo.manifestPath)),
      units
    })
  ).slice(0, 24);
}

function skillInstallUnitsForKey(rootInfo: SkillRootResolution) {
  const entries: Array<{
    id: string;
    root: string;
    required_paths: Array<{ path: string; fingerprint: string }>;
    runtime_cache_key?: string;
    install?: SkillInstallSpec;
    configuration?: SkillConfigurationSpec;
    validation?: SkillValidationSpec;
  }> = [];
  const rootTarget = resolveSkillExecutionTarget(rootInfo.id);
  entries.push({
    id: rootInfo.id,
    root: rootTarget.root,
    required_paths: fingerprintRequiredPaths(rootTarget.root, rootTarget.requiredPaths),
    runtime_cache_key: resolveSkillRuntimeInfo(rootInfo.id)?.cache_key,
    install: rootInfo.manifest.install,
    configuration: rootInfo.manifest.configuration,
    validation: rootInfo.manifest.validation
  });
  for (const [subskillId, subskill] of Object.entries(rootInfo.manifest.subskills ?? {})) {
    const target = resolveSkillExecutionTarget(rootInfo.id, subskillId);
    entries.push({
      id: `${rootInfo.id}.${subskillId}`,
      root: target.root,
      required_paths: fingerprintRequiredPaths(target.root, target.requiredPaths),
      runtime_cache_key: resolveSkillRuntimeInfo(rootInfo.id, subskillId)?.cache_key,
      install: subskill.install,
      configuration: subskill.configuration,
      validation: subskill.validation
    });
  }
  return entries;
}

function capabilityTestsForUnit(unit: SkillInstallUnit): SkillInstallCommandSpec[] {
  const validationTests = [...(unit.validation?.capability_tests ?? []), ...(unit.validation?.capabilityTests ?? [])];
  if (validationTests.length) return validationTests;
  return unit.install?.capability_tests ?? [];
}

function installCommandWorkspace(unit: SkillInstallUnit, installCommand: SkillInstallCommandSpec, checkKind: "smoke" | "capability"): string {
  return path.join(
    skillInstallStateRoot(),
    "_workspaces",
    sanitizePathSegment(unit.id),
    checkKind,
    sanitizePathSegment(installCommand.name)
  );
}

function checkExpectedArtifacts(workspace: string, artifacts: SkillInstallCommandSpec["expectedArtifacts"]): SkillInstallCheckResult[] {
  return (artifacts ?? []).map((artifact) => {
    const artifactPath = path.resolve(workspace, artifact.path);
    if (!existsSync(artifactPath)) {
      return {
        name: `expected_artifact:${artifact.path}`,
        status: "failed",
        required: true,
        message: `Missing expected artifact: ${artifactPath}`
      };
    }
    const stats = statSync(artifactPath);
    if (artifact.type === "file" && !stats.isFile()) {
      return {
        name: `expected_artifact:${artifact.path}`,
        status: "failed",
        required: true,
        message: `Expected artifact is not a file: ${artifactPath}`
      };
    }
    if (artifact.type === "directory" && !stats.isDirectory()) {
      return {
        name: `expected_artifact:${artifact.path}`,
        status: "failed",
        required: true,
        message: `Expected artifact is not a directory: ${artifactPath}`
      };
    }
    if (artifact.minBytes !== undefined && stats.size < artifact.minBytes) {
      return {
        name: `expected_artifact:${artifact.path}`,
        status: "failed",
        required: true,
        message: `Expected artifact is too small: ${stats.size} < ${artifact.minBytes}`
      };
    }
    if (artifact.maxBytes !== undefined && stats.size > artifact.maxBytes) {
      return {
        name: `expected_artifact:${artifact.path}`,
        status: "failed",
        required: true,
        message: `Expected artifact is too large: ${stats.size} > ${artifact.maxBytes}`
      };
    }
    return {
      name: `expected_artifact:${artifact.path}`,
      status: "passed",
      required: true,
      message: `${artifactPath} (${stats.size} bytes)`
    };
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => Boolean(value?.trim())))];
}

function fingerprintRequiredPaths(root: string, requiredPaths: string[]): Array<{ path: string; fingerprint: string }> {
  return requiredPaths.map((relativePath) => {
    const filePath = path.join(root, relativePath);
    if (!existsSync(filePath)) return { path: relativePath, fingerprint: "missing" };
    const stats = statSync(filePath);
    if (stats.isDirectory()) return { path: relativePath, fingerprint: `dir:${stats.mtimeMs}` };
    return { path: relativePath, fingerprint: sha256Text(readFileSync(filePath)) };
  });
}

function truncate(value: string, maxLength = 4000): string | undefined {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;
}

function skillRootCandidates(manifest: SkillManifest): Array<{ source: SkillRootResolution["source"]; root: string }> {
  const candidates: Array<{ source: SkillRootResolution["source"]; root: string }> = [];
  const explicitEnv = manifest.env?.root_override;
  if (explicitEnv && process.env[explicitEnv]) {
    candidates.push({ source: "env_override", root: resolveRepoPath(process.env[explicitEnv] as string) });
  }
  const genericEnv = genericSkillRootEnv(manifest.id);
  if (process.env[genericEnv]) {
    candidates.push({ source: "generic_env_override", root: resolveRepoPath(process.env[genericEnv] as string) });
  }
  const productionEnv = manifest.cache?.production_root_env;
  if (productionEnv && process.env[productionEnv]) {
    candidates.push({
      source: "production_cache",
      root: skillRootWithinCache(manifest, renderSkillPath(manifest, resolveRepoPath(process.env[productionEnv] as string)))
    });
  }
  if (manifest.cache?.development_root) {
    candidates.push({
      source: "development_cache",
      root: skillRootWithinCache(manifest, path.resolve(repoRoot(), manifest.cache.development_root))
    });
  }
  return candidates;
}

function syncTarget(manifest: SkillManifest): string {
  const productionEnv = manifest.cache?.production_root_env;
  if (productionEnv && process.env[productionEnv]) {
    return renderSkillPath(manifest, resolveRepoPath(process.env[productionEnv] as string));
  }
  if (manifest.cache?.development_root) {
    return path.resolve(repoRoot(), manifest.cache.development_root);
  }
  throw new Error(`Skill ${manifest.id} has no cache target.`);
}

function renderSkillPath(manifest: SkillManifest, root: string): string {
  const template = manifest.cache?.production_path_template ?? "{root}/{id}/{commit}";
  const commit = manifest.source?.commit ?? manifest.source?.ref ?? "current";
  return path.resolve(
    template
      .replaceAll("{root}", root)
      .replaceAll("{id}", manifest.id)
      .replaceAll("{commit}", commit)
      .replaceAll("{ref}", manifest.source?.ref ?? "main")
  );
}

function skillRootWithinCache(manifest: SkillManifest, cacheRoot: string): string {
  const subpath = manifest.cache?.root_subpath;
  return subpath ? path.resolve(cacheRoot, subpath) : cacheRoot;
}

function assertSkillRoot(manifest: SkillManifest, root: string): void {
  assertRequiredPaths(manifest.id, root, manifest.required_paths ?? []);
}

function assertRequiredPaths(skillLabel: string, root: string, requiredPaths: string[]): void {
  for (const relativePath of requiredPaths) {
    const filePath = path.join(root, relativePath);
    if (!existsSync(filePath)) {
      throw new Error(`Skill ${skillLabel} is incomplete: missing ${filePath}`);
    }
  }
}

function genericSkillRootEnv(skillId: string): string {
  return `OPERATOR_SKILL_${skillId.replace(/[^a-z0-9]/giu, "_").toUpperCase()}_ROOT`;
}

function runtimeCacheKeyFiles(target: SkillExecutionTarget, runtime: SkillRuntimeSpec): SkillRuntimeResolution["cache_key_files"] {
  return (runtime.cache_key_files ?? []).map((relativePath) => {
    const filePath = path.resolve(target.root, relativePath);
    if (!existsSync(filePath)) {
      return { path: relativePath, missing: true };
    }
    return { path: relativePath, sha256: sha256Text(readFileSync(filePath)) };
  });
}

function runtimeCacheKey(
  target: SkillExecutionTarget,
  runtime: SkillRuntimeSpec,
  files: SkillRuntimeResolution["cache_key_files"]
): string {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      skill_id: target.id,
      subskill_id: target.subskillId,
      source: target.manifest.source,
      runtime,
      files
    })
  );
  return hash.digest("hex").slice(0, 16);
}

function renderRuntimeTemplate(template: string, variables: Record<string, string>): string {
  return Object.entries(variables).reduce((value, [key, replacement]) => value.replaceAll(`{${key}}`, replacement), template);
}
