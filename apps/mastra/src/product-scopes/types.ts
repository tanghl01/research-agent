import type {
  OperatorProductOutputContract,
  OperatorProductOutputFormat,
  OperatorProductScopeKind,
  OperatorSkillCatalogEntry
} from "@operator/contracts";
import type { OperatorAgentRuntimeKind } from "../agents/runtime.js";
import type { OperatorWorkflowImplementationKey } from "../workflows/index.js";

export type OperatorScopeKind = OperatorProductScopeKind;
export type OperatorOutputFormat = OperatorProductOutputFormat;
export type OperatorOutputContract = OperatorProductOutputContract;

export type OperatorScopeBase = {
  id: string;
  kind: OperatorScopeKind;
  displayName: string;
  description: string;
  keywords: string[];
};

export type OperatorAgentScope = OperatorScopeBase & {
  kind: "agent";
  runtime: OperatorAgentRuntimeKind;
  role: "runtime-agent";
  mastraAgentId?: string;
  available?: boolean;
  unavailableReason?: string;
  capabilityReceiptPath?: string;
};

export type OperatorSkillScope = OperatorScopeBase & {
  kind: "skill";
  skillId: string;
  mastraName: string;
  runtime: "mastra-workspace-skill";
  outputFormat: OperatorSkillCatalogEntry["outputFormat"];
  outputContract: OperatorOutputContract;
  selectionGuidance: string;
  executionGuidance: string;
  available?: boolean;
  unavailableReason?: string;
  sourceRoot?: string;
};

export type OperatorWorkflowScope = OperatorScopeBase & {
  kind: "workflow";
  workflowId: string;
  mastraKey: OperatorWorkflowImplementationKey;
  executionMode: "deterministic-mastra-workflow";
  outputContract?: OperatorOutputContract;
  available?: boolean;
  unavailableReason?: string;
  capabilityReceiptPath?: string;
};

export type OperatorToolScope = OperatorScopeBase & {
  kind: "tool";
  runtime: "mastra-tool";
};

export type OperatorScope = OperatorAgentScope | OperatorSkillScope | OperatorWorkflowScope | OperatorToolScope;

export type OperatorScopeSelectionCatalog = {
  agents: OperatorAgentScope[];
  skills: OperatorSkillScope[];
  workflows: OperatorWorkflowScope[];
  tools: OperatorToolScope[];
};
