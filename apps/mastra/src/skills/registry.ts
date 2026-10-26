import {
  listSkillSubskills,
  resolveSkillExecutionTarget,
  resolveSkillAdapterFiles,
  resolveSkillRuntimeInfo,
  requireEnabledCapability,
  type SkillAdapterFile,
  type SkillExecutionTarget,
  type SkillManifest,
  type CapabilityInstallReceipt,
  type SkillRuntimeResolution
} from "@operator/core";
import { listOperatorSkillCatalog as listProductSkillCatalog, type OperatorSkillCatalogEntry } from "@operator/contracts";

export const OPERATOR_MASTRA_SKILLS_ROOT = "skills/mastra";

export type { OperatorSkillCatalogEntry, OperatorSkillOutputFormat } from "@operator/contracts";

export type ResolvedOperatorSkill = OperatorSkillCatalogEntry & {
  root: string;
  sourceRoot: string;
  manifest: SkillManifest;
  manifestPath: string;
  source: string;
  entrypoints: Record<string, string>;
  requiredPaths: string[];
  executionTarget: SkillExecutionTarget;
  adapters: SkillAdapterFile[];
  runtime?: SkillRuntimeResolution;
  capabilityReceipt: CapabilityInstallReceipt;
  subskills: ResolvedOperatorSubskill[];
};

export type ResolvedOperatorSubskill = {
  id: string;
  displayName: string;
  description: string;
  root: string;
  sourceRoot: string;
  entrypoints: Record<string, string>;
  requiredPaths: string[];
  executionTarget: SkillExecutionTarget;
  adapters: SkillAdapterFile[];
  runtime?: SkillRuntimeResolution;
};

export const operatorSkillCatalog: OperatorSkillCatalogEntry[] = listProductSkillCatalog();

export function listOperatorSkillCatalog(): OperatorSkillCatalogEntry[] {
  return listProductSkillCatalog();
}

export function getOperatorSkillByMastraName(name: string): OperatorSkillCatalogEntry | undefined {
  return listProductSkillCatalog().find((skill) => skill.mastraName === name);
}

export function resolveOperatorSkill(skill: OperatorSkillCatalogEntry): ResolvedOperatorSkill {
  const capabilityReceipt = requireEnabledCapability(skill.skillId);
  const target = resolveSkillExecutionTarget(skill.skillId, skill.subskillId);
  return {
    ...skill,
    root: target.root,
    sourceRoot: target.sourceRoot,
    manifest: target.manifest,
    manifestPath: target.manifestPath,
    source: target.source,
    entrypoints: target.entrypoints,
    requiredPaths: target.requiredPaths,
    executionTarget: target,
    adapters: resolveSkillAdapterFiles(skill.skillId, skill.subskillId),
    runtime: resolveSkillRuntimeInfo(skill.skillId, skill.subskillId),
    capabilityReceipt,
    subskills: skill.subskillId ? [] : resolveOperatorSubskills(skill.skillId)
  };
}

function resolveOperatorSubskills(skillId: string): ResolvedOperatorSubskill[] {
  return listSkillSubskills(skillId).map(({ id, manifest }) => {
    const target = resolveSkillExecutionTarget(skillId, id);
    return {
      id,
      displayName: manifest.display_name ?? id,
      description: manifest.description ?? "",
      root: target.root,
      sourceRoot: target.sourceRoot,
      entrypoints: target.entrypoints,
      requiredPaths: target.requiredPaths,
      executionTarget: target,
      adapters: resolveSkillAdapterFiles(skillId, id),
      runtime: resolveSkillRuntimeInfo(skillId, id)
    };
  });
}

export function tryResolveOperatorSkill(skill: OperatorSkillCatalogEntry): ResolvedOperatorSkill | undefined {
  try {
    return resolveOperatorSkill(skill);
  } catch {
    return undefined;
  }
}

export function listResolvedOperatorSkills(): ResolvedOperatorSkill[] {
  return listOperatorSkillCatalog()
    .map((skill) => tryResolveOperatorSkill(skill))
    .filter((skill): skill is ResolvedOperatorSkill => Boolean(skill));
}
