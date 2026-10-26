import { crawlerConfigFromRecord, crawlKnowledgeSource, rulesFromRecord } from "@operator/knowledge-ingestion/crawler";
import { runKnowledgeSourceIngestion } from "@operator/knowledge-ingestion/ingestion";
import { getDatabase } from "@operator/db";
import { createJobWorkerFromEnv, type JobWorker } from "@operator/queue";
import { getOperatorBackendRuntimeStatus } from "./config";
import { getObjectStorage } from "./object-storage";
import { KNOWLEDGE_QUEUE, KNOWLEDGE_SOURCE_RUN_JOB, ServerKnowledgeError, type KnowledgeSourceRunPayload } from "./knowledge";

export async function runKnowledgeSourceNow(payload: KnowledgeSourceRunPayload) {
  const status = getOperatorBackendRuntimeStatus();
  if (!status.serviceConfigured) {
    throw new ServerKnowledgeError("Operator backend service is not configured.", {
      status: 503,
      code: "BACKEND_NOT_CONFIGURED"
    });
  }
  return runKnowledgeSourceIngestion({
    db: getDatabase(),
    storage: getObjectStorage(),
    bucket: status.buckets.knowledge,
    sourceId: payload.sourceId,
    runType: payload.runType ?? "manual",
    trigger: payload.trigger ?? "manual",
    crawl: async (source, runId) =>
      crawlKnowledgeSource({
        baseUrl: source.baseUrl,
        rules: rulesFromRecord(source.rules),
        crawlerConfig: crawlerConfigFromRecord(source.crawlerConfig),
        runId
      })
  });
}

export function createKnowledgeIngestionWorker(env: Record<string, string | undefined> = process.env): JobWorker {
  return createJobWorkerFromEnv<KnowledgeSourceRunPayload>(
    KNOWLEDGE_QUEUE,
    async (job) => {
      if (job.name !== KNOWLEDGE_SOURCE_RUN_JOB) return undefined;
      return runKnowledgeSourceNow(job.payload);
    },
    env
  );
}
