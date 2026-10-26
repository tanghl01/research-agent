import path from "node:path";
import {
  isActiveRunStatus,
  isRunStatus,
  ReconcileDecisionSchema,
  RunReconcileJobPayloadSchema,
  type ReconcileDecision,
  type RunReconcileJobPayload
} from "@operator/contracts";
import { repoRoot } from "@operator/core";
import { createJobQueueFromEnv, createJobWorkerFromEnv, type JobQueue, type JobWorker, type QueueJob } from "@operator/queue";
import { loadServerTaskRunDetailForReconciler, repairLatestServerTaskRunFromResultForReconciler } from "../operator-backend/runs";
import { readLatestLocalChatRun } from "../operator-local-run-files";

const RECONCILE_QUEUE = "workflow-run";
export const RECONCILE_JOB_NAME = "reconcile-run";

export async function enqueueRunReconciliation(
  payload: RunReconcileJobPayload,
  queue: JobQueue = createJobQueueFromEnv()
): Promise<QueueJob<RunReconcileJobPayload>> {
  return queue.enqueue(RECONCILE_QUEUE, RECONCILE_JOB_NAME, RunReconcileJobPayloadSchema.parse(payload));
}

export function createRunReconcilerWorker(env: Record<string, string | undefined> = process.env): JobWorker {
  return createJobWorkerFromEnv<RunReconcileJobPayload>(
    RECONCILE_QUEUE,
    async (job) => {
      if (job.name !== RECONCILE_JOB_NAME) return;
      await reconcileTaskRun(RunReconcileJobPayloadSchema.parse(job.payload));
    },
    env
  );
}

export async function reconcileTaskRun(payload: RunReconcileJobPayload): Promise<ReconcileDecision> {
  if (!payload.conversationId) {
    return skipped(payload.taskId, "conversation_scope_missing", [{ source: "query", ref: payload.taskId }]);
  }

  const detail = await loadServerTaskRunDetailForReconciler({
    taskId: payload.taskId,
    conversationId: payload.conversationId
  });
  const latestRun = detail?.latestRun;
  if (!detail || !latestRun) {
    return skipped(payload.taskId, "task_or_run_not_found", [{ source: "task_snapshot", ref: payload.taskId }]);
  }

  if (!isRunStatus(latestRun.status) || !isActiveRunStatus(latestRun.status)) {
    return skipped(payload.taskId, "run_not_active", [{ source: "task_snapshot", ref: latestRun.runId }], latestRun.runId);
  }

  if (!detail.workspace) {
    return skipped(payload.taskId, "workspace_missing", [{ source: "task_snapshot", ref: latestRun.runId }], latestRun.runId);
  }

  const workspace = absoluteWorkspace(detail.workspace);
  const localRun = readLatestLocalChatRun(workspace);
  if (!localRun?.result) {
    return skipped(payload.taskId, "terminal_result_missing", [{ source: "chat_result", ref: workspace }], latestRun.runId);
  }

  const repaired = await repairLatestServerTaskRunFromResultForReconciler({
    taskId: payload.taskId,
    conversationId: payload.conversationId,
    result: localRun.result,
    evidence: {
      source: "chat_result",
      path: path.join(workspace, localRun.resultPath),
      reason: payload.reason
    }
  });

  if (!repaired.repaired) {
    return skipped(
      payload.taskId,
      repaired.reason ?? "repair_not_applied",
      [{ source: "chat_result", ref: path.join(workspace, localRun.resultPath) }],
      repaired.runId ?? latestRun.runId
    );
  }

  return ReconcileDecisionSchema.parse({
    taskId: payload.taskId,
    runId: repaired.runId ?? latestRun.runId,
    action: "repaired",
    reason: "terminal_result_applied",
    evidence: [{ source: "chat_result", ref: path.join(workspace, localRun.resultPath) }]
  });
}

function skipped(taskId: string, reason: string, evidence: ReconcileDecision["evidence"], runId?: string): ReconcileDecision {
  return ReconcileDecisionSchema.parse({
    taskId,
    runId,
    action: "skipped",
    reason,
    evidence
  });
}

function absoluteWorkspace(workspace: string): string {
  return path.isAbsolute(workspace) ? workspace : path.join(repoRoot(), workspace);
}
