import { industrialDailyReportWorkflow } from "./industrial/daily-report/workflow.js";
import { araPaperFromResultsWorkflow } from "./research/paper-from-results/workflow.js";
import { skill2WorkflowWorkflow } from "./system/skill2workflow/workflow.js";

export const mastraWorkflowImplementations = {
  skill2WorkflowWorkflow,
  industrialDailyReportWorkflow,
  araPaperFromResultsWorkflow
} as const;

export type OperatorWorkflowImplementationKey = keyof typeof mastraWorkflowImplementations;
