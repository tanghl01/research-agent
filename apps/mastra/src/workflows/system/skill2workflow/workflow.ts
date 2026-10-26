import { createStep, createWorkflow } from "@mastra/core/workflows";
import { pptWorkflowInputSchema, workflowDeliverySchema } from "../../../schemas.js";
import { normalizeBriefTool } from "../../shared/brief.js";
import { analyzeSkillWithCodexTool, generateSkillWorkflowPackTool, prepareSkillSourceTool } from "./tools.js";
import { validateSkill2WorkflowDeliveryTool } from "./validation.js";

export const skill2WorkflowWorkflow = createWorkflow({
  id: "system.skill2workflow",
  description: "Convert an open-source text-heavy skill into a Mastra workflow pack registered for Operator.",
  inputSchema: pptWorkflowInputSchema,
  outputSchema: workflowDeliverySchema,
  metadata: {
    domain: "system.workflow_conversion",
    skill_id: "skill2workflow",
    output_format: "workflow_pack",
    runtime: "mastra_tool_workflow",
    backend_llm: "codex_cli"
  }
})
  .then(createStep(normalizeBriefTool))
  .then(createStep(prepareSkillSourceTool))
  .then(createStep(analyzeSkillWithCodexTool))
  .then(createStep(generateSkillWorkflowPackTool))
  .then(createStep(validateSkill2WorkflowDeliveryTool))
  .commit();
