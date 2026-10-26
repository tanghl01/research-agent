import { requireEnabledCapability } from "@operator/core";
import { listOperatorWorkflowCatalog, type OperatorWorkflowCatalogEntry } from "@operator/contracts";
import type { OperatorWorkflowScope } from "./types.js";

const workflowMastraKeys: Record<string, OperatorWorkflowScope["mastraKey"]> = {
  "system.skill2workflow": "skill2WorkflowWorkflow",
  "industrial.daily-monitoring-report": "industrialDailyReportWorkflow",
  "research.paper-from-results": "araPaperFromResultsWorkflow"
};

export const workflowScopes: OperatorWorkflowScope[] = listOperatorWorkflowCatalog().map(toMastraWorkflowScope);

export function listWorkflowScopes(): OperatorWorkflowScope[] {
  return [...workflowScopes];
}

export function listRuntimeWorkflowScopes(): OperatorWorkflowScope[] {
  return workflowScopes.map((scope) => {
    try {
      const receipt = requireEnabledCapability(scope.workflowId);
      return {
        ...scope,
        available: true,
        capabilityReceiptPath: receipt.receipt_path
      };
    } catch (error) {
      return {
        ...scope,
        available: false,
        unavailableReason: error instanceof Error ? error.message : "Workflow capability receipt is unavailable."
      };
    }
  });
}

export function getWorkflowScope(idOrWorkflowId: string): OperatorWorkflowScope | undefined {
  return workflowScopes.find(
    (scope) => scope.id === idOrWorkflowId || scope.workflowId === idOrWorkflowId || scope.mastraKey === idOrWorkflowId
  );
}

export function getRuntimeWorkflowScope(idOrWorkflowId: string): OperatorWorkflowScope | undefined {
  return listRuntimeWorkflowScopes().find(
    (scope) => scope.id === idOrWorkflowId || scope.workflowId === idOrWorkflowId || scope.mastraKey === idOrWorkflowId
  );
}

function toMastraWorkflowScope(workflow: OperatorWorkflowCatalogEntry): OperatorWorkflowScope {
  const mastraKey = workflowMastraKeys[workflow.id];
  if (!mastraKey) {
    throw new Error(`Workflow Mastra adapter key is missing for ${workflow.id}`);
  }
  return {
    ...workflow,
    kind: "workflow",
    mastraKey,
    executionMode: "deterministic-mastra-workflow"
  };
}
