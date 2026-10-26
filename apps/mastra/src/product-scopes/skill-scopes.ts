import { listOperatorSkillCatalog, listResolvedOperatorSkills, resolveOperatorSkill, type OperatorSkillCatalogEntry } from "../skills/registry.js";
import { skillScopePolicies } from "./policies.js";
import type { OperatorSkillScope } from "./types.js";

export function listSkillScopes(): OperatorSkillScope[] {
  return listOperatorSkillCatalog().map((skill) => {
    const policy = skillScopePolicies[skill.mastraName];
    if (!policy) {
      throw new Error(`Skill scope policy is missing for ${skill.mastraName}`);
    }
    return {
      id: skill.mastraName,
      kind: "skill",
      skillId: skill.skillId,
      mastraName: skill.mastraName,
      displayName: skill.displayName,
      description: skill.description,
      keywords: skill.keywords,
      runtime: "mastra-workspace-skill",
      outputFormat: skill.outputFormat,
      outputContract: policy.outputContract,
      selectionGuidance: policy.selectionGuidance,
      executionGuidance: policy.executionGuidance
    };
  });
}

export function listRuntimeSkillScopes(): OperatorSkillScope[] {
  const resolved = new Map(listResolvedOperatorSkills().map((skill) => [skill.mastraName, skill]));
  return listSkillScopes().map((scope) => {
    const resolvedSkill = resolved.get(scope.mastraName);
    if (resolvedSkill) {
      return {
        ...scope,
        available: true,
        sourceRoot: resolvedSkill.root
      };
    }
    const catalogEntry = listOperatorSkillCatalog().find((skill) => skill.mastraName === scope.mastraName);
    const unavailableReason = catalogEntry
      ? unavailableSkillReason(catalogEntry)
      : "Skill manifest is not registered in the Operator skill catalog.";
    return {
      ...scope,
      available: false,
      unavailableReason
    };
  });
}

export function getSkillScope(idOrMastraName: string): OperatorSkillScope | undefined {
  return listSkillScopes().find((scope) => scope.id === idOrMastraName || scope.mastraName === idOrMastraName);
}

export function requireSkillScope(idOrMastraName: string): OperatorSkillScope {
  const scope = getSkillScope(idOrMastraName);
  if (!scope) {
    throw new Error(`Skill scope is not registered: ${idOrMastraName}`);
  }
  return scope;
}

function unavailableSkillReason(skill: OperatorSkillCatalogEntry): string {
  try {
    resolveOperatorSkill(skill);
    return "Skill is available.";
  } catch (error) {
    return error instanceof Error ? error.message : "Skill source or install receipt is unavailable.";
  }
}
