import { createOperatorAgentRunWorker } from "../lib/operator-application/run-command-service";
import { createKnowledgeIngestionWorker } from "../lib/operator-backend/knowledge-worker";
import { createRunReconcilerWorker } from "../lib/operator-application/run-reconciler-service";

const workers = [createOperatorAgentRunWorker(), createRunReconcilerWorker(), createKnowledgeIngestionWorker()];
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[operator] received ${signal}; shutting down workers.`);
  await Promise.all(workers.map((worker) => worker.close()));
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

console.info("[operator] BullMQ workers started: agent-run/run-agent, workflow-run/reconcile-run, and knowledge-ingestion/knowledge-source-run.");
await new Promise(() => undefined);
