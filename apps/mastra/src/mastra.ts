import { Mastra } from "@mastra/core/mastra";
import { loadDotenv } from "@operator/core";
import { listMastraAgentImplementations } from "./agents/runtime.js";
import { operatorKnowledgeTools } from "./tools/knowledge.js";
import { operatorWebTools } from "./tools/web.js";
import { industrialDailyReportTools } from "./workflows/industrial/daily-report/tools.js";
import { mastraWorkflowImplementations } from "./workflows/index.js";
import { araPaperWorkflowTools } from "./workflows/research/paper-from-results/tools.js";
import { operatorWorkspace } from "./workspace.js";

loadDotenv();

export const mastra = new Mastra({
  workspace: operatorWorkspace,
  agents: listMastraAgentImplementations(),
  tools: {
    ...operatorWebTools,
    ...operatorKnowledgeTools,
    ...industrialDailyReportTools,
    ...araPaperWorkflowTools
  },
  workflows: mastraWorkflowImplementations
});

export type OperatorMastra = typeof mastra;
