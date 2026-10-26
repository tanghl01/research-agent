import { writeJson, workspacePath } from "@operator/core";
import type { OperatorTaskInputData, WorkflowDeliveryData } from "./schemas.js";
import { operatorTaskInputSchema } from "./schemas.js";
import { mastra } from "./mastra.js";
import { requireWorkflowScope, type OperatorWorkflowScope } from "./product-scopes/catalog.js";

export type RunWorkflowOptions = {
  input: unknown;
  workspace?: string;
  workflowId?: string;
};

export async function runWorkflow(options: RunWorkflowOptions) {
  const parsed = operatorTaskInputSchema.parse({
    ...(typeof options.input === "object" && options.input ? options.input : {}),
    workspace: options.workspace ?? (options.input as Partial<OperatorTaskInputData> | undefined)?.workspace
  });
  const runId = parsed.run_id ?? `wr_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const inputData = { ...parsed, run_id: runId };
  const selected = selectWorkflow(inputData, options);
  const workflow = mastra.getWorkflow(selected.mastraKey);
  const run = await workflow.createRun({ runId });
  const result = await run.start({ inputData });

  const delivery = result.status === "success" ? (result.result as WorkflowDeliveryData) : undefined;
  const workspace = delivery?.workspace ?? inputData.workspace ?? "";
  const routing = {
    kind: selected.kind,
    scope_id: selected.id,
    mastra_key: selected.mastraKey,
    workflow_id: selected.workflowId,
    reason: "explicit registered workflow scope"
  };
  const payload = {
    run_id: runId,
    workflow_id: selected.workflowId,
    mastra_status: result.status,
    status: result.status === "success" ? "succeeded" : "failed",
    workspace,
    routing,
    result: delivery,
    error: result.status === "failed" ? String(result.error?.message ?? result.error) : null,
    steps: result.steps
  };

  if (workspace) {
    if (delivery?.artifacts) {
      writeJson(workspacePath(workspace, "artifact_manifest.json"), {
        version: "1.0",
        workflow_run_id: runId,
        artifacts: delivery.artifacts
      });
    }
    writeJson(workspacePath(workspace, "workflow_run.json"), payload);
  }

  return payload;
}

function selectWorkflow(inputData: OperatorTaskInputData, options: RunWorkflowOptions): OperatorWorkflowScope {
  const workflowId = options.workflowId ?? inputData.workflow_id ?? "system.skill2workflow";
  return requireWorkflowScope(workflowId);
}
