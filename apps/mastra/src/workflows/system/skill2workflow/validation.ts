import { validateArtifactManifestContains, validateFileExists, validateMinFileSize } from "@operator/core";
import { createTool } from "@mastra/core/tools";
import { renderedDeckSchema, workflowDeliverySchema, type RenderedDeckData } from "../../../schemas.js";

export const validateSkill2WorkflowDeliveryTool = createTool({
  id: "operator.skill2workflow.validate",
  description: "Validate the generated skill-to-workflow pack delivery contract.",
  inputSchema: renderedDeckSchema,
  outputSchema: workflowDeliverySchema,
  execute: async (inputData) => {
    const workflow = requiredOutput(inputData, "workflow");
    const tools = requiredOutput(inputData, "tools");
    const registration = requiredOutput(inputData, "registration");
    const consistencySpec = requiredOutput(inputData, "consistencySpec");
    const consistencyReport = requiredOutput(inputData, "consistencyReport");
    const analysis = requiredOutput(inputData, "analysis");
    const manifest = requiredOutput(inputData, "artifactManifest");
    const checks = [
      validateFileExists(inputData.workspace, workflow),
      validateFileExists(inputData.workspace, tools),
      validateFileExists(inputData.workspace, registration),
      validateFileExists(inputData.workspace, consistencySpec),
      validateFileExists(inputData.workspace, consistencyReport),
      validateFileExists(inputData.workspace, analysis),
      validateMinFileSize(inputData.workspace, workflow, 1_000),
      validateArtifactManifestContains(inputData.workspace, manifest, "ts"),
      validateArtifactManifestContains(inputData.workspace, manifest, "json")
    ];
    return { ...inputData, validation: { validated: true as const, checks } };
  }
});

function requiredOutput(inputData: RenderedDeckData, key: string): string {
  const value = inputData.outputs[key];
  if (!value) {
    throw new Error(`Workflow output is missing required key: ${key}`);
  }
  return value;
}
