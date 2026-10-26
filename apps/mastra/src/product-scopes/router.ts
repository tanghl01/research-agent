import { getAgentScope, getSkillScope, getWorkflowScope } from "./catalog.js";
import type { OperatorAgentScope, OperatorScope, OperatorSkillScope, OperatorWorkflowScope } from "./types.js";

export type OperatorResolvedScope =
  | { kind: "agent"; scope: OperatorAgentScope }
  | { kind: "skill"; scope: OperatorSkillScope }
  | { kind: "workflow"; scope: OperatorWorkflowScope }
  | { kind: "none"; scope?: undefined };

export function resolveOperatorScope(scopeId: string | undefined): OperatorResolvedScope {
  if (!scopeId) return { kind: "none" };
  const agent = getAgentScope(scopeId);
  if (agent) return { kind: "agent", scope: agent };
  const skill = getSkillScope(scopeId);
  if (skill) return { kind: "skill", scope: skill };
  const workflow = getWorkflowScope(scopeId);
  if (workflow) return { kind: "workflow", scope: workflow };
  return { kind: "none" };
}

export function getOperatorScope(scopeId: string | undefined): OperatorScope | undefined {
  const resolved = resolveOperatorScope(scopeId);
  return resolved.scope;
}
