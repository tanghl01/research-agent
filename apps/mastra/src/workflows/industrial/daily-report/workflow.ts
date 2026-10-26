import { createStep, createWorkflow } from "@mastra/core/workflows";
import { operatorTaskInputSchema, workflowDeliverySchema } from "../../../schemas.js";
import { prepareIndustrialMonitoringDataTool, renderIndustrialDailyReportTool, validateIndustrialDailyReportTool } from "./tools.js";

export const industrialDailyReportWorkflow = createWorkflow({
  id: "industrial.daily-monitoring-report",
  description: "Generate a LaTeX/PDF daily monitoring report from industrial visual findings and meter readings.",
  inputSchema: operatorTaskInputSchema,
  outputSchema: workflowDeliverySchema,
  metadata: {
    domain: "industrial.monitoring",
    output_format: "pdf",
    runtime: "mastra_tool_workflow",
    report_engine: "latex"
  }
})
  .then(createStep(prepareIndustrialMonitoringDataTool))
  .then(createStep(renderIndustrialDailyReportTool))
  .then(createStep(validateIndustrialDailyReportTool))
  .commit();
