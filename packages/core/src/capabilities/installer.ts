import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { runCommand } from "../process.js";
import {
  resolveSkillRootInfo,
  resolveSkillRuntimeInfo,
  skillPipCacheDir,
  currentSkillCapabilityVersionKey,
  requireInstalledSkillCapability,
  resolveSkillCapabilityReceipt,
  syncSkillCapability
} from "./skills.js";
import { extractEnvReferences, getAcpAgentCapabilityConfig } from "./acp-agents.js";
import { repoRoot } from "../workspace.js";
import { listSyncableCapabilityDescriptors, requireCapabilityDescriptor, type SyncableCapabilityOptions } from "./registry.js";
import {
  capabilityInstallStateRoot,
  capabilityReceiptPath,
  resolveRepoPath,
  sanitizePathSegment,
  sha256Text,
  writeCapabilityInstallReceipt
} from "./receipts.js";
import type {
  CapabilityCheckResult,
  CapabilityDescriptor,
  CapabilityInstallOptions,
  CapabilityInstallReceipt,
  CapabilityProviderSpec,
  CapabilityStageReceipt,
  CapabilityTestSpec
} from "./types.js";
import { CapabilityInstallBatchError, CapabilityInstallError } from "./types.js";

export async function syncCapability(capabilityId: string, options: CapabilityInstallOptions = {}): Promise<CapabilityInstallReceipt> {
  const descriptor = requireCapabilityDescriptor(capabilityId);
  if (descriptor.legacySkillId) {
    return syncSkillCapability(descriptor, options);
  }
  return syncNativeCapability(descriptor, options);
}

export async function syncCapabilityDescriptors(
  descriptors: readonly CapabilityDescriptor[],
  options: CapabilityInstallOptions = {}
): Promise<CapabilityInstallReceipt[]> {
  const receipts: CapabilityInstallReceipt[] = [];
  const failures: CapabilityInstallReceipt[] = [];
  for (const descriptor of descriptors) {
    try {
      receipts.push(await syncCapability(descriptor.id, options));
    } catch (error) {
      if (error instanceof CapabilityInstallError) {
        receipts.push(error.receipt);
        failures.push(error.receipt);
        continue;
      }
      throw error;
    }
  }
  if (failures.length) {
    throw new CapabilityInstallBatchError(receipts);
  }
  return receipts;
}

export async function syncAllCapabilities(
  options: CapabilityInstallOptions & SyncableCapabilityOptions = {}
): Promise<CapabilityInstallReceipt[]> {
  if (options.kind === "skill") {
    const descriptors = listSyncableCapabilityDescriptors(options);
    return syncCapabilityDescriptors(descriptors, options);
  }
  return syncCapabilityDescriptors(listSyncableCapabilityDescriptors(options), options);
}

export function resolveCapabilityInstallReceipt(capabilityId: string): CapabilityInstallReceipt | undefined {
  const descriptor = requireCapabilityDescriptor(capabilityId);
  if (descriptor.legacySkillId) {
    return resolveSkillCapabilityReceipt(descriptor.legacySkillId);
  }
  const versionKey = currentCapabilityVersionKey(descriptor);
  const receiptPath = capabilityReceiptPath(descriptor, versionKey);
  if (!existsSync(receiptPath)) return undefined;
  try {
    return JSON.parse(readFileSync(receiptPath, "utf8")) as CapabilityInstallReceipt;
  } catch {
    return undefined;
  }
}

export function requireInstalledCapability(capabilityId: string): CapabilityInstallReceipt {
  const descriptor = requireCapabilityDescriptor(capabilityId);
  if (descriptor.legacySkillId) {
    return requireInstalledSkillCapability(descriptor.legacySkillId);
  }
  const versionKey = currentCapabilityVersionKey(descriptor);
  const receiptPath = capabilityReceiptPath(descriptor, versionKey);
  if (!existsSync(receiptPath)) {
    throw new Error(
      [
        `Capability ${capabilityId} is not installed through the Operator capability lifecycle.`,
        `Expected install receipt: ${receiptPath}`,
        `Run "pnpm capabilities:sync ${capabilityId}" or "pnpm capabilities:sync --all".`
      ].join("\n")
    );
  }
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as CapabilityInstallReceipt;
  if (receipt.version_key !== versionKey) {
    throw new Error(`Capability ${capabilityId} install receipt is stale. Run "pnpm capabilities:sync ${capabilityId}".`);
  }
  if (receipt.status !== "enabled") {
    throw new Error(`Capability ${capabilityId} lifecycle status is ${receipt.lifecycle_status}: ${receipt.error ?? receiptPath}`);
  }
  return receipt;
}

export const requireEnabledCapability = requireInstalledCapability;

export function checkCapabilityConfiguration(descriptor: CapabilityDescriptor): CapabilityCheckResult[] {
  if (descriptor.adapter.type === "acp-agent") {
    const config = getAcpAgentCapabilityConfig(descriptor.id);
    return config
      ? validateAcpAgentCapabilityConfig(config)
      : [fail(`${descriptor.id}:acp_config`, "ACP agent configuration is not registered in the capability layer.", "configure")];
  }

  const checks: CapabilityCheckResult[] = [];
  const requiredEnv = new Set(descriptor.configuration?.requiredEnv ?? []);
  for (const envName of requiredEnv) {
    checks.push(envCheck("configure", `${descriptor.id}:required_env:${envName}`, envName, true));
  }
  for (const envName of descriptor.configuration?.optionalEnv ?? []) {
    if (requiredEnv.has(envName)) continue;
    checks.push(envCheck("configure", `${descriptor.id}:optional_env:${envName}`, envName, false));
  }
  for (const provider of descriptor.configuration?.providers ?? []) {
    checks.push(...providerChecks(descriptor, provider));
  }
  for (const secretName of descriptor.configuration?.secrets ?? []) {
    checks.push(envCheck("configure", `${descriptor.id}:secret_ref:${secretName}`, secretName, true));
  }
  if (checks.length === 0) {
    checks.push({
      phase: "configure",
      name: `${descriptor.id}:configuration:none`,
      status: "passed",
      required: true,
      message: "Capability does not declare required external configuration."
    });
  }
  return checks;
}

export function validateAcpAgentCapabilityConfig(config: {
  id: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
}): CapabilityCheckResult[] {
  const checks: CapabilityCheckResult[] = [
    {
      phase: "configure",
      name: `${config.id}:acp_command`,
      status: config.command?.trim() ? "passed" : "failed",
      required: true,
      message: config.command?.trim() ? `ACP command configured: ${config.command}` : "ACP command is missing."
    }
  ];
  if (config.cwd) {
    const cwd = resolveAcpConfigPath(config.cwd);
    checks.push({
      phase: "configure",
      name: `${config.id}:acp_cwd`,
      status: existsSync(cwd) ? "passed" : "failed",
      required: true,
      message: existsSync(cwd) ? `ACP cwd exists: ${cwd}` : `ACP cwd does not exist: ${config.cwd}`
    });
  }
  for (const value of Object.values(config.env ?? {})) {
    for (const envName of extractEnvReferences(value)) {
      checks.push(envCheck("configure", `${config.id}:acp_env:${envName}`, envName, true));
    }
  }
  return checks;
}

async function syncNativeCapability(
  descriptor: CapabilityDescriptor,
  options: CapabilityInstallOptions
): Promise<CapabilityInstallReceipt> {
  const stages: CapabilityStageReceipt[] = [];
  let receipt = baseReceipt(descriptor, currentCapabilityVersionKey(descriptor), "planned", []);
  try {
    const installChecks = checkNativeRequiredPaths(descriptor);
    stages.push(stage("install", installChecks));
    assertNoFailedRequired(installChecks);
    const configureChecks = checkCapabilityConfiguration(descriptor);
    stages.push(stage("configure", configureChecks));
    assertNoFailedRequired(configureChecks);
    const validateChecks = await runCapabilityValidation(descriptor, options);
    stages.push(stage("validate", validateChecks));
    assertNoFailedRequired(validateChecks);
    stages.push(stage("register", checkNativeCapabilityRegistration(descriptor)));
    assertNoFailedRequired(stages.at(-1)?.checks ?? []);
    stages.push(stage("deploy", checkNativeCapabilityDeployment(descriptor)));
    assertNoFailedRequired(stages.at(-1)?.checks ?? []);
    stages.push(pass(`${descriptor.id}:enable`, "Capability is enabled for the current environment.", "enable"));
    receipt = baseReceipt(descriptor, currentCapabilityVersionKey(descriptor), "enabled", stages);
    writeCapabilityInstallReceipt(receipt);
    return receipt;
  } catch (error) {
    receipt = baseReceipt(descriptor, currentCapabilityVersionKey(descriptor), "failed", stages);
    receipt.error = error instanceof Error ? error.message : String(error);
    if (receipt.checks.length === 0) receipt.stages = [stage("install", [fail(`${descriptor.id}:install`, receipt.error)])];
    receipt.checks = receipt.stages.flatMap((entry) => entry.checks);
    writeCapabilityInstallReceipt(receipt);
    throw new CapabilityInstallError(receipt);
  }
}

async function runCapabilityValidation(
  descriptor: CapabilityDescriptor,
  options: CapabilityInstallOptions
): Promise<CapabilityCheckResult[]> {
  if (descriptor.adapter.type === "acp-agent") {
    return validateAcpAgentRuntime(descriptor, options);
  }
  const tests = descriptor.validation?.capabilityTests ?? [];
  if (tests.length === 0) {
    return [
      {
        phase: "validate",
        name: `${descriptor.id}:capability_tests:missing`,
        status: "failed",
        required: true,
        message: "Capability must declare at least one capability test before it can be enabled."
      }
    ];
  }
  const checks: CapabilityCheckResult[] = [];
  for (const test of tests) {
    checks.push(await runCapabilityTest(descriptor, test, options));
  }
  return checks;
}

async function validateAcpAgentRuntime(
  descriptor: CapabilityDescriptor,
  options: CapabilityInstallOptions
): Promise<CapabilityCheckResult[]> {
  const config = getAcpAgentCapabilityConfig(descriptor.id);
  if (!config) {
    return [fail(`${descriptor.id}:acp_config`, "ACP agent configuration is not registered in the capability layer.", "validate")];
  }
  const command = shellQuote(config.command);
  try {
    const result = await runCommand("bash", ["-lc", `command -v ${command}`], {
      cwd: repoRoot(),
      env: process.env,
      timeoutMs: options.timeoutMs ?? 30_000
    });
    return [
      {
        phase: "validate",
        name: `${descriptor.id}:acp_command_available`,
        status: "passed",
        required: true,
        message: `ACP command is executable: ${config.command}`,
        stdout: truncate(result.stdout),
        stderr: truncate(result.stderr),
        exit_code: result.exitCode
      }
    ];
  } catch (error) {
    return [
      {
        phase: "validate",
        name: `${descriptor.id}:acp_command_available`,
        status: "failed",
        required: true,
        message: error instanceof Error ? error.message : String(error)
      }
    ];
  }
}

async function runCapabilityTest(
  descriptor: CapabilityDescriptor,
  test: CapabilityTestSpec,
  options: CapabilityInstallOptions
): Promise<CapabilityCheckResult> {
  const required = test.required !== false;
  const workspace = path.join(
    capabilityInstallStateRoot(),
    "_workspaces",
    sanitizePathSegment(descriptor.id),
    sanitizePathSegment(test.name)
  );
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  const root = capabilityRoot(descriptor);
  const cwd = test.cwd ? path.resolve(root, test.cwd) : root;
  const command = renderCapabilityTemplate(test.command, descriptor, workspace);
  try {
    const result = await runCommand("bash", ["-lc", command], {
      cwd,
      env: {
        ...process.env,
        PIP_CACHE_DIR: skillPipCacheDir()
      },
      timeoutMs: test.timeoutMs ?? test.timeout_ms ?? options.timeoutMs ?? 120_000
    });
    const artifactCheck = checkExpectedArtifacts(workspace, test.expectedArtifacts ?? []);
    const failedArtifact = artifactCheck.find((check) => check.status === "failed" && check.required);
    if (failedArtifact) {
      return {
        phase: "validate",
        name: `${descriptor.id}:capability:${test.name}`,
        status: "failed",
        required,
        message: failedArtifact.message,
        stdout: truncate(result.stdout),
        stderr: truncate(result.stderr),
        exit_code: result.exitCode
      };
    }
    return {
      phase: "validate",
      name: `${descriptor.id}:capability:${test.name}`,
      status: "passed",
      required,
      message: command,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
      exit_code: result.exitCode
    };
  } catch (error) {
    return {
      phase: "validate",
      name: `${descriptor.id}:capability:${test.name}`,
      status: required ? "failed" : "skipped",
      required,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkExpectedArtifacts(workspace: string, artifacts: CapabilityTestSpec["expectedArtifacts"]): CapabilityCheckResult[] {
  return (artifacts ?? []).map((artifact) => {
    const artifactPath = path.resolve(workspace, artifact.path);
    if (!existsSync(artifactPath)) {
      return fail(`expected_artifact:${artifact.path}`, `Missing expected artifact: ${artifactPath}`, "validate");
    }
    const stats = statSync(artifactPath);
    if (artifact.minBytes !== undefined && stats.size < artifact.minBytes) {
      return fail(`expected_artifact:${artifact.path}`, `Expected artifact is too small: ${stats.size} < ${artifact.minBytes}`, "validate");
    }
    if (artifact.maxBytes !== undefined && stats.size > artifact.maxBytes) {
      return fail(`expected_artifact:${artifact.path}`, `Expected artifact is too large: ${stats.size} > ${artifact.maxBytes}`, "validate");
    }
    return {
      phase: "validate",
      name: `expected_artifact:${artifact.path}`,
      status: "passed",
      required: true,
      message: `${artifactPath} (${stats.size} bytes)`
    };
  });
}

function providerChecks(descriptor: CapabilityDescriptor, provider: CapabilityProviderSpec): CapabilityCheckResult[] {
  const checks: CapabilityCheckResult[] = [];
  const required = provider.required !== false;
  for (const [role, envName] of Object.entries(provider.env ?? {})) {
    checks.push(envCheck("configure", `${descriptor.id}:provider:${provider.id}:${role}:${envName}`, envName, required));
  }
  if (!provider.interface) {
    checks.push(
      fail(
        `${descriptor.id}:provider:${provider.id}:interface`,
        `Provider ${provider.id} must declare a compatible interface.`,
        "configure"
      )
    );
  }
  return checks;
}

function checkNativeRequiredPaths(descriptor: CapabilityDescriptor): CapabilityCheckResult[] {
  const root = capabilityRoot(descriptor);
  const paths = descriptor.validation?.requiredPaths ?? [];
  if (paths.length === 0) {
    return [
      {
        phase: "install",
        name: `${descriptor.id}:required_paths:none`,
        status: "passed",
        required: true,
        message: "Capability does not declare required local paths."
      }
    ];
  }
  return paths.map((relativePath) => {
    const filePath = path.resolve(root, relativePath);
    return {
      phase: "install",
      name: `${descriptor.id}:required_path:${relativePath}`,
      status: existsSync(filePath) ? "passed" : "failed",
      required: true,
      message: existsSync(filePath) ? filePath : `Missing required path: ${filePath}`
    };
  });
}

function checkNativeCapabilityRegistration(descriptor: CapabilityDescriptor): CapabilityCheckResult[] {
  if (descriptor.adapter.type === "acp-agent") {
    return [
      {
        phase: "register",
        name: `${descriptor.id}:agent_descriptor_registered`,
        status: getAcpAgentCapabilityConfig(descriptor.id) ? "passed" : "failed",
        required: true,
        message: getAcpAgentCapabilityConfig(descriptor.id)
          ? "ACP agent descriptor is registered in the capability layer."
          : "ACP agent descriptor is missing from the capability layer."
      }
    ];
  }
  return [
    {
      phase: "register",
      name: `${descriptor.id}:adapter_registered`,
      status: descriptor.adapter.type ? "passed" : "failed",
      required: true,
      message: descriptor.adapter.type
        ? `Capability adapter is registered: ${descriptor.adapter.type}`
        : "Capability adapter type is missing."
    }
  ];
}

function checkNativeCapabilityDeployment(descriptor: CapabilityDescriptor): CapabilityCheckResult[] {
  if (descriptor.adapter.type === "acp-agent") {
    const config = getAcpAgentCapabilityConfig(descriptor.id);
    return [
      {
        phase: "deploy",
        name: `${descriptor.id}:runtime_binding`,
        status: config?.command ? "passed" : "failed",
        required: true,
        message: config?.command ? `ACP runtime binding is available: ${config.command}` : "ACP runtime binding is unavailable."
      }
    ];
  }
  return [
    {
      phase: "deploy",
      name: `${descriptor.id}:source_bound`,
      status: capabilityRoot(descriptor) ? "passed" : "failed",
      required: true,
      message: `Capability source root is bound: ${capabilityRoot(descriptor)}`
    }
  ];
}

function capabilityRoot(descriptor: CapabilityDescriptor): string {
  if (descriptor.legacySkillId) return resolveSkillRootInfo(descriptor.legacySkillId).root;
  if (descriptor.source?.root) return resolveRepoPath(descriptor.source.root);
  if (descriptor.manifestPath) return path.dirname(descriptor.manifestPath);
  return repoRoot();
}

function renderCapabilityTemplate(command: string, descriptor: CapabilityDescriptor, workspace: string): string {
  const root = capabilityRoot(descriptor);
  let rendered = command
    .replaceAll("{repo_root}", repoRoot())
    .replaceAll("{capability_root}", root)
    .replaceAll("{skill_root}", root)
    .replaceAll("{workspace}", workspace);
  if (descriptor.legacySkillId) {
    const runtime = resolveSkillRuntimeInfo(descriptor.legacySkillId);
    rendered = rendered
      .replaceAll("{runtime_root}", runtime?.runtime_root ?? "")
      .replaceAll("{python}", runtime?.commands.python ?? process.env.OPERATOR_SYSTEM_PYTHON ?? process.env.PYTHON ?? "python3")
      .replaceAll("{pip}", runtime?.commands.pip ?? "pip");
    for (const [name, value] of Object.entries(runtime?.commands ?? {})) {
      rendered = rendered.replaceAll(`{runtime.commands.${name}}`, value);
    }
  }
  return rendered;
}

function baseReceipt(
  descriptor: CapabilityDescriptor,
  versionKey: string,
  lifecycleStatus: CapabilityInstallReceipt["lifecycle_status"] | "pending",
  stages: CapabilityStageReceipt[]
): CapabilityInstallReceipt {
  const normalizedStatus = lifecycleStatus === "enabled" ? "enabled" : "failed";
  const receiptPath = capabilityReceiptPath(descriptor, versionKey === "pending" ? currentCapabilityVersionKey(descriptor) : versionKey);
  return {
    schema: "operator.capability.install.v1",
    capability_id: descriptor.id,
    kind: descriptor.kind,
    adapter_type: descriptor.adapter.type,
    compatibility_level: descriptor.compatibilityLevel,
    source_type: descriptor.sourceType,
    version_key: versionKey === "pending" ? currentCapabilityVersionKey(descriptor) : versionKey,
    lifecycle_status: lifecycleStatus === "pending" ? "planned" : lifecycleStatus,
    status: normalizedStatus,
    manifest_path: descriptor.manifestPath,
    manifest_sha256: descriptor.manifestSha256,
    source: descriptor.source,
    receipt_path: receiptPath,
    completed_at: new Date().toISOString(),
    stages,
    checks: stages.flatMap((entry) => entry.checks)
  };
}

function currentCapabilityVersionKey(descriptor: CapabilityDescriptor): string {
  if (descriptor.legacySkillId) {
    return currentSkillCapabilityVersionKey(descriptor.legacySkillId);
  }
  return sha256Text(
    JSON.stringify({
      id: descriptor.id,
      kind: descriptor.kind,
      adapter: descriptor.adapter,
      source: descriptor.source,
      manifest_sha256: descriptor.manifestSha256,
      runtime: descriptor.runtime,
      configuration: descriptor.configuration,
      validation: descriptor.validation,
      exposure: descriptor.exposure
    })
  ).slice(0, 24);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function resolveAcpConfigPath(value: string): string {
  return resolveRepoPath(resolveAcpConfigValue(value));
}

function resolveAcpConfigValue(value: string): string {
  return value.replace(/\$(?:\{([A-Z0-9_]+)\}|([A-Z0-9_]+))/gu, (_match, braced: string, bare: string) => {
    const name = braced ?? bare;
    if (name === "OPERATOR_REPO_ROOT") return process.env.OPERATOR_REPO_ROOT ?? repoRoot();
    return process.env[name] ?? "";
  });
}

function stage(phase: CapabilityCheckResult["phase"], checks: CapabilityCheckResult[] | CapabilityStageReceipt): CapabilityStageReceipt {
  if (!Array.isArray(checks)) return checks;
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

function envCheck(phase: CapabilityCheckResult["phase"], name: string, envName: string, required: boolean): CapabilityCheckResult {
  const present = Boolean(process.env[envName]?.trim());
  return {
    phase,
    name,
    status: present ? "passed" : required ? "failed" : "skipped",
    required,
    message: present
      ? `Environment reference ${envName} is configured.`
      : `${required ? "Missing required" : "Optional"} environment reference ${envName}.`
  };
}

function assertNoFailedRequired(checks: CapabilityCheckResult[]): void {
  const failed = checks.find((check) => check.required && check.status === "failed");
  if (failed) throw new Error(failed.message ?? `Required capability check failed: ${failed.name}`);
}

function truncate(value: string, maxLength = 4000): string | undefined {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;
}
