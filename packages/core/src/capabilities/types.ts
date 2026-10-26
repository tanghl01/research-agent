export type CapabilityKind = "skill" | "workflow" | "agent" | "tool" | "package";

export type CapabilitySourceType = "bundled" | "imported";

export type CapabilityCompatibilityLevel = "operator-native" | "operator-compatible" | "generic-open-source";

export type CapabilityAdapterType =
  | "agent-skill"
  | "mastra-workflow"
  | "langgraph"
  | "acp-agent"
  | "mcp-tool"
  | "generic-github";

export type CapabilityLifecycleStatus =
  | "discovered"
  | "resolved"
  | "planned"
  | "installed"
  | "configured"
  | "validated"
  | "registered"
  | "deployed"
  | "enabled"
  | "failed"
  | "disabled"
  | "stale"
  | "deprecated"
  | "removed";

export type CapabilitySourceRef = {
  type: CapabilitySourceType;
  provider?: "github" | "local" | "oci" | string;
  repo?: string;
  ref?: string;
  commit?: string;
  root?: string;
};

export type CapabilityProviderSpec = {
  id: string;
  interface: string;
  required?: boolean;
  env?: Record<string, string>;
  compatibleProviders?: string[];
};

export type CapabilityConfigurationSpec = {
  requiredEnv?: string[];
  optionalEnv?: string[];
  providers?: CapabilityProviderSpec[];
  secrets?: string[];
};

export type CapabilityCommandSpec = {
  name: string;
  command: string;
  cwd?: string;
  timeout_ms?: number;
  timeoutMs?: number;
  required?: boolean;
};

export type CapabilityExpectedArtifact = {
  path: string;
  type?: string;
  minBytes?: number;
  maxBytes?: number;
};

export type CapabilityTestSpec = CapabilityCommandSpec & {
  type?: "golden-example" | "smoke" | "health" | string;
  source?: "upstream-example" | "operator-golden-example" | "upstream-example-or-operator-curated-example" | string;
  expectedArtifacts?: CapabilityExpectedArtifact[];
};

export type CapabilityValidationSpec = {
  requiredPaths?: string[];
  smokeTests?: CapabilityCommandSpec[];
  capabilityTests?: CapabilityTestSpec[];
};

export type CapabilityRuntimeSpec = {
  type?: "none" | "python" | "python_venv" | "node" | "container" | "external" | string;
  manager?: "uv" | "uv-or-venv" | "pip" | "pnpm" | "npm" | "external" | string;
  commands?: Record<string, string>;
  cacheKeyFiles?: string[];
};

export type CapabilityExposureSpec = {
  scopes?: Array<{
    id: string;
    surface?: "chat" | "admin" | "runtime" | string;
    enabledByDefault?: boolean;
  }>;
  artifacts?: Array<{
    type: string;
    formats?: string[];
  }>;
};

export type CapabilityManifest = {
  $schema?: string;
  apiVersion?: string;
  kind: CapabilityKind;
  id: string;
  displayName?: string;
  description?: string;
  source?: CapabilitySourceRef;
  adapter: {
    type: CapabilityAdapterType;
    entrypoints?: Record<string, string>;
  };
  runtime?: CapabilityRuntimeSpec;
  configuration?: CapabilityConfigurationSpec;
  validation?: CapabilityValidationSpec;
  exposure?: CapabilityExposureSpec;
  security?: Record<string, unknown>;
  license?: Record<string, unknown>;
};

export type CapabilityDescriptor = CapabilityManifest & {
  manifestPath?: string;
  manifestSha256?: string;
  compatibilityLevel: CapabilityCompatibilityLevel;
  sourceType: CapabilitySourceType;
  legacySkillId?: string;
};

export type CapabilityCheckStatus = "passed" | "failed" | "skipped";

export type CapabilityCheckPhase = "install" | "configure" | "validate" | "register" | "deploy" | "enable" | "health";

export type CapabilityCheckResult = {
  phase: CapabilityCheckPhase;
  name: string;
  status: CapabilityCheckStatus;
  required: boolean;
  message?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
};

export type CapabilityStageReceipt = {
  phase: CapabilityCheckPhase;
  status: "passed" | "failed" | "skipped";
  checks: CapabilityCheckResult[];
};

export type CapabilityInstallReceipt = {
  schema: "operator.capability.install.v1";
  capability_id: string;
  kind: CapabilityKind;
  adapter_type: CapabilityAdapterType;
  compatibility_level: CapabilityCompatibilityLevel;
  source_type: CapabilitySourceType;
  version_key: string;
  lifecycle_status: CapabilityLifecycleStatus;
  status: "enabled" | "failed";
  manifest_path?: string;
  manifest_sha256?: string;
  source?: CapabilitySourceRef;
  receipt_path: string;
  completed_at: string;
  stages: CapabilityStageReceipt[];
  checks: CapabilityCheckResult[];
  error?: string;
};

export type CapabilityInstallOptions = {
  force?: boolean;
  timeoutMs?: number;
  kind?: CapabilityKind;
  includeExternal?: boolean;
  includeGeneric?: boolean;
};

export type CapabilityInstallRequest = CapabilityInstallOptions & {
  capabilityId: string;
  environment?: "development" | "internal" | "production";
  actor?: {
    type: "system" | "admin" | "developer";
    id: string;
  };
};

export type CapabilityDetectResult = {
  compatibilityLevel: CapabilityCompatibilityLevel;
  adapterType: CapabilityAdapterType;
  kind: CapabilityKind;
  features: string[];
  reason: string;
};

export class CapabilityInstallError extends Error {
  readonly receipt: CapabilityInstallReceipt;

  constructor(receipt: CapabilityInstallReceipt) {
    super(`Capability installation failed for ${receipt.capability_id}: ${receipt.error ?? "unknown error"}`);
    this.name = "CapabilityInstallError";
    this.receipt = receipt;
  }
}

export class CapabilityInstallBatchError extends Error {
  readonly receipts: CapabilityInstallReceipt[];

  constructor(receipts: CapabilityInstallReceipt[]) {
    const failed = receipts.filter((receipt) => receipt.status === "failed");
    super(`Capability installation failed for ${failed.length} capability package(s): ${failed.map((receipt) => receipt.capability_id).join(", ")}`);
    this.name = "CapabilityInstallBatchError";
    this.receipts = receipts;
  }
}
