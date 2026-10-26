import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { listSkillManifests, type SkillManifest } from "./skills.js";
import { listAcpAgentCapabilityDescriptors } from "./acp-agents.js";
import { repoRoot } from "../workspace.js";
import type {
  CapabilityAdapterType,
  CapabilityCommandSpec,
  CapabilityDescriptor,
  CapabilityKind,
  CapabilityManifest,
  CapabilityProviderSpec,
  CapabilitySourceType,
  CapabilityTestSpec
} from "./types.js";

export type CapabilityManifestListOptions = {
  includeLegacySkills?: boolean;
};

export type SyncableCapabilityOptions = {
  kind?: CapabilityKind;
  includeExternal?: boolean;
  includeGeneric?: boolean;
};

export function capabilityManifestDir(): string {
  return path.resolve(process.env.OPERATOR_CAPABILITY_MANIFEST_DIR || path.join(repoRoot(), "capabilities", "manifests"));
}

export function loadCapabilityManifest(capabilityId: string): { manifest: CapabilityManifest; manifestPath: string } {
  const manifestPath = path.join(capabilityManifestDir(), `${capabilityId}.capability.json`);
  if (!existsSync(manifestPath)) {
    throw new Error(`Capability manifest not found for ${capabilityId}: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CapabilityManifest;
  assertCapabilityManifest(manifest, manifestPath);
  return { manifest, manifestPath };
}

export function listNativeCapabilityManifestIds(): string[] {
  const dir = capabilityManifestDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((filename) => filename.endsWith(".capability.json"))
    .map((filename) => filename.slice(0, -".capability.json".length))
    .sort((left, right) => left.localeCompare(right));
}

export function listCapabilityDescriptors(options: CapabilityManifestListOptions = {}): CapabilityDescriptor[] {
  const native = listNativeCapabilityManifestIds().map((id) => {
    const { manifest, manifestPath } = loadCapabilityManifest(id);
    return toCapabilityDescriptor(manifest, manifestPath);
  });

  const nativeIds = new Set(native.map((descriptor) => descriptor.id));
  const acpAgents = listAcpAgentCapabilityDescriptors().filter((descriptor) => !nativeIds.has(descriptor.id));
  const declared = [...native, ...acpAgents];
  if (options.includeLegacySkills === false) return declared.sort((left, right) => left.id.localeCompare(right.id));

  const declaredIds = new Set(declared.map((descriptor) => descriptor.id));
  const legacy = listSkillManifests()
    .map(({ manifest, manifestPath }) => capabilityDescriptorFromSkillManifest(manifest, manifestPath))
    .filter((descriptor) => !declaredIds.has(descriptor.id));
  return [...declared, ...legacy].sort((left, right) => left.id.localeCompare(right.id));
}

export function listSyncableCapabilityDescriptors(options: SyncableCapabilityOptions = {}): CapabilityDescriptor[] {
  return listCapabilityDescriptors().filter((descriptor) => {
    if (options.kind && descriptor.kind !== options.kind) return false;
    if (!options.includeGeneric && descriptor.compatibilityLevel === "generic-open-source") return false;
    if (!options.includeExternal && descriptor.legacySkillId && descriptor.adapter.type === "generic-github") return false;
    return true;
  });
}

export function getCapabilityDescriptor(capabilityId: string): CapabilityDescriptor | undefined {
  return listCapabilityDescriptors().find((descriptor) => descriptor.id === capabilityId || descriptor.legacySkillId === capabilityId);
}

export function requireCapabilityDescriptor(capabilityId: string): CapabilityDescriptor {
  const descriptor = getCapabilityDescriptor(capabilityId);
  if (!descriptor) {
    throw new Error(`Capability package is not registered: ${capabilityId}`);
  }
  return descriptor;
}

export function toCapabilityDescriptor(manifest: CapabilityManifest, manifestPath?: string): CapabilityDescriptor {
  assertCapabilityManifest(manifest, manifestPath ?? manifest.id);
  return {
    ...manifest,
    manifestPath,
    manifestSha256: manifestPath && existsSync(manifestPath) ? sha256Text(readFileSync(manifestPath)) : undefined,
    compatibilityLevel: "operator-native",
    sourceType: manifest.source?.type ?? "bundled"
  };
}

export function capabilityDescriptorFromSkillManifest(manifest: SkillManifest, manifestPath: string): CapabilityDescriptor {
  const kind = skillManifestCapabilityKind(manifest);
  const adapterType = skillManifestAdapterType(manifest);
  const sourceType: CapabilitySourceType = manifest.source ? "imported" : "bundled";
  return {
    id: manifest.id,
    kind,
    displayName: manifest.display_name ?? manifest.id,
    description: manifest.description,
    source: {
      type: sourceType,
      provider: manifest.source?.type === "git" ? "github" : "local",
      repo: manifest.source?.repo,
      ref: manifest.source?.ref,
      commit: manifest.source?.commit
    },
    adapter: {
      type: adapterType,
      entrypoints: manifest.entrypoints
    },
    runtime: manifest.runtime
      ? {
          type: manifest.runtime.type,
          commands: manifest.runtime.commands,
          cacheKeyFiles: manifest.runtime.cache_key_files
        }
      : undefined,
    configuration: {
      requiredEnv: uniqueStrings([...(manifest.install?.required_env ?? []), ...(manifest.configuration?.requiredEnv ?? [])]),
      optionalEnv: uniqueStrings([...(manifest.install?.optional_env ?? []), ...(manifest.configuration?.optionalEnv ?? [])]),
      providers: normalizedLegacyProviders(manifest),
      secrets: manifest.configuration?.secrets ?? []
    },
    validation: {
      requiredPaths: manifest.required_paths ?? [],
      smokeTests: normalizedLegacyCommands(manifest.install?.smoke_tests ?? []),
      capabilityTests: normalizeLegacyCapabilityTests(manifest)
    },
    license: manifest.license,
    manifestPath,
    manifestSha256: sha256Text(readFileSync(manifestPath)),
    compatibilityLevel: adapterType === "generic-github" ? "generic-open-source" : "operator-compatible",
    sourceType,
    legacySkillId: manifest.id
  };
}

function skillManifestCapabilityKind(manifest: SkillManifest): CapabilityKind {
  if (manifest.kind === "external_agent_package") return "agent";
  return "skill";
}

function skillManifestAdapterType(manifest: SkillManifest): CapabilityAdapterType {
  if (manifest.kind === "external_agent_package") return "generic-github";
  return "agent-skill";
}

function normalizedLegacyCommands(commands: CapabilityCommandSpec[] | undefined): CapabilityCommandSpec[] {
  return (commands ?? []).map((command) => ({ ...command }));
}

function normalizeLegacyCapabilityTests(manifest: SkillManifest): CapabilityTestSpec[] {
  const declared =
    manifest.validation?.capability_tests ?? manifest.validation?.capabilityTests ?? manifest.install?.capability_tests ?? [];
  return declared.map((test) => ({ ...test }));
}

function normalizedLegacyProviders(manifest: SkillManifest): CapabilityProviderSpec[] {
  const declared = manifest.configuration?.providers ?? [];
  if (declared.length) return declared;
  const requiredEnv = new Set(manifest.install?.required_env ?? []);
  const optionalEnv = new Set(manifest.install?.optional_env ?? []);
  const providers: CapabilityProviderSpec[] = [];
  if (requiredEnv.has("QINYAN_API_KEY")) {
    providers.push({
      id: "qinyan-openapi",
      interface: "qinyan-openapi",
      required: true,
      env: { apiKey: "QINYAN_API_KEY" },
      compatibleProviders: ["qinyan"]
    });
  }
  if (requiredEnv.has("OPERATOR_PACKY_IMAGE_API_KEY") || optionalEnv.has("OPERATOR_PACKY_IMAGE_API_KEY")) {
    providers.push({
      id: "image-generation",
      interface: "openai-compatible-image-generation",
      required: requiredEnv.has("OPERATOR_PACKY_IMAGE_API_KEY"),
      env: {
        apiKey: "OPERATOR_PACKY_IMAGE_API_KEY",
        baseUrl: "OPERATOR_PACKY_IMAGE_BASE_URL",
        model: "OPERATOR_PACKY_IMAGE_MODEL"
      },
      compatibleProviders: ["packy", "openai-compatible"]
    });
  }
  return providers;
}

function assertCapabilityManifest(manifest: CapabilityManifest, label: string): void {
  if (!manifest.id) throw new Error(`Capability manifest is missing id: ${label}`);
  if (!manifest.kind) throw new Error(`Capability manifest is missing kind: ${label}`);
  if (!manifest.adapter?.type) throw new Error(`Capability manifest is missing adapter.type: ${label}`);
}

function sha256Text(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => Boolean(value?.trim())))];
}
