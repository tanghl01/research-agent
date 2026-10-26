import { requireEnabledCapability } from "@operator/core";
import { listEnabledExternalAgentConfigs, selectMainAgentCandidateIds } from "../agents/runtime.js";
import type { OperatorAgentScope } from "./types.js";

export const agentScopes: OperatorAgentScope[] = [];

export function listRuntimeAgentScopes(): OperatorAgentScope[] {
  return listEnabledExternalAgentConfigs().map((agent) => {
    const receipt = requireEnabledCapability(agent.id);
    return {
      id: agent.id,
      kind: "agent" as const,
      displayName: agent.name,
      description: agent.description,
      keywords: ["agent", "mastra", "external", "acp", ...(agent.keywords ?? [])],
      runtime: agent.runtime,
      role: "runtime-agent" as const,
      mastraAgentId: agent.id,
      available: true,
      capabilityReceiptPath: receipt.receipt_path
    };
  });
}

export function getAgentScope(idOrMastraAgentId: string): OperatorAgentScope | undefined {
  return listRuntimeAgentScopes().find((scope) => scope.id === idOrMastraAgentId || scope.mastraAgentId === idOrMastraAgentId);
}

export function getDefaultMainAgentScope(): OperatorAgentScope {
  const agents = listRuntimeAgentScopes();
  const scope = selectMainAgentCandidateIds()
    .map((candidateId) => agents.find((agent) => agent.id === candidateId || agent.mastraAgentId === candidateId))
    .find((agent): agent is OperatorAgentScope => Boolean(agent));
  if (!scope) {
    throw new Error("Default main agent scope is not configured.");
  }
  return scope;
}
