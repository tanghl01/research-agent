import { loadDotenv } from "@operator/core";
import { listUserScopeSelectionCatalog as listProductUserScopeSelectionCatalog } from "@operator/contracts";
import { agentScopes, getAgentScope, getDefaultMainAgentScope, listRuntimeAgentScopes } from "./agent-scopes.js";
import { getSkillScope, listRuntimeSkillScopes, listSkillScopes, requireSkillScope } from "./skill-scopes.js";
import { toolScopes } from "./tool-scopes.js";
import type { OperatorScope, OperatorScopeSelectionCatalog, OperatorWorkflowScope } from "./types.js";
import {
  getRuntimeWorkflowScope,
  getWorkflowScope,
  listRuntimeWorkflowScopes,
  listWorkflowScopes,
  workflowScopes
} from "./workflow-scopes.js";

loadDotenv();

export * from "./types.js";
export { agentScopes, getAgentScope, getDefaultMainAgentScope, listRuntimeAgentScopes };
export { getSkillScope, listRuntimeSkillScopes, listSkillScopes, requireSkillScope };
export { skillScopePolicies, type SkillScopePolicy } from "./policies.js";
export { toolScopes };
export { getWorkflowScope, listRuntimeWorkflowScopes, listWorkflowScopes, workflowScopes };

export function listScopeSelectionCatalog(): OperatorScopeSelectionCatalog {
  return {
    agents: listRuntimeAgentScopes(),
    skills: listSkillScopes(),
    workflows: listWorkflowScopes(),
    tools: [...toolScopes]
  };
}

export function listRuntimeScopeSelectionCatalog(): OperatorScopeSelectionCatalog {
  return {
    agents: listRuntimeAgentScopes(),
    skills: listRuntimeSkillScopes(),
    workflows: listRuntimeWorkflowScopes(),
    tools: [...toolScopes]
  };
}

export function listUserScopeSelectionCatalog(): OperatorScopeSelectionCatalog {
  const productCatalog = listProductUserScopeSelectionCatalog();
  const userSkillIds = new Set(productCatalog.skills.map((skill) => skill.id));
  const userWorkflowIds = new Set(productCatalog.workflows.map((workflow) => workflow.id));
  const userToolIds = new Set(productCatalog.tools.map((tool) => tool.id));
  return {
    agents: [],
    skills: listRuntimeSkillScopes().filter((skill) => userSkillIds.has(skill.id)),
    workflows: listRuntimeWorkflowScopes().filter((workflow) => userWorkflowIds.has(workflow.id) && workflow.available),
    tools: toolScopes.filter((tool) => userToolIds.has(tool.id))
  };
}

export function listExecutableScopeSelectionCatalog(): OperatorScopeSelectionCatalog {
  const catalog = listRuntimeScopeSelectionCatalog();
  return {
    ...catalog,
    agents: catalog.agents.filter((agent) => agent.available !== false),
    skills: catalog.skills.filter((skill) => skill.available),
    workflows: catalog.workflows.filter((workflow) => workflow.available !== false)
  };
}

export function listAllScopes(): OperatorScope[] {
  const catalog = listScopeSelectionCatalog();
  return [...catalog.agents, ...catalog.skills, ...catalog.workflows, ...catalog.tools];
}

export function requireWorkflowScope(idOrWorkflowId: string): OperatorWorkflowScope {
  const scope = getRuntimeWorkflowScope(idOrWorkflowId);
  if (!scope) {
    throw new Error(
      `Workflow scope is not registered: ${idOrWorkflowId}. PPT generation is exposed as Mastra Workspace Skills, not as Operator workflow adapters.`
    );
  }
  if (scope.available === false) {
    throw new Error(`Workflow scope is not enabled through the Operator capability lifecycle: ${idOrWorkflowId}. ${scope.unavailableReason ?? ""}`.trim());
  }
  return scope;
}
