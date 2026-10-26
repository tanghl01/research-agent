import { createStep, createWorkflow } from "@mastra/core/workflows";
import { operatorTaskInputSchema, workflowDeliverySchema } from "../../../schemas.js";
import {
  buildAraDraftingContextTool,
  buildAraPrivateHandoffTool,
  prepareAraPaperInputsTool,
  renderAraManuscriptTool,
  scoreAraEvidenceTool,
  validateAraPaperDeliveryTool,
  validateAraResultBundleTool
} from "./tools.js";

export const araPaperFromResultsWorkflow = createWorkflow({
  id: "research.paper-from-results",
  description: "Produce ARA paper handoff artifacts from experiment/result bundles through a Mastra-native workflow boundary.",
  inputSchema: operatorTaskInputSchema,
  outputSchema: workflowDeliverySchema,
  metadata: {
    domain: "research.paper",
    output_format: "research",
    runtime: "mastra_tool_workflow",
    paper_engine: "native_ts",
    python_boundary: false,
    legacy_python_engine: "legacy_ara_python",
    upstream_runtime: "ara_result_bundle"
  }
})
  .then(createStep(prepareAraPaperInputsTool))
  .then(createStep(validateAraResultBundleTool))
  .then(createStep(buildAraDraftingContextTool))
  .then(createStep(scoreAraEvidenceTool))
  .then(createStep(renderAraManuscriptTool))
  .then(createStep(buildAraPrivateHandoffTool))
  .then(createStep(validateAraPaperDeliveryTool))
  .commit();
