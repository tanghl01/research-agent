import { createJobQueueFromEnv, createJobWorkerFromEnv, type JobQueue, type JobWorker } from "@operator/queue";
import type { LegacyMastraChatResult, LegacyOperatorChatAttachment, LegacyOperatorChatMessage } from "./legacy-mastra-chat-result";
import { withOperatorSpan } from "./observability";
import { runOperatorAgentInProcess, type OperatorAgentInProcessRunParams } from "./operator-agent-in-process-runner";

const AGENT_RUN_QUEUE = "agent-run";
const RUN_AGENT_JOB_NAME = "run-agent";
const DEFAULT_AGENT_RUN_QUEUE_WAIT_MS = 65 * 60 * 1000;

type Env = Record<string, string | undefined>;

export type OperatorRuntimeMessage = LegacyOperatorChatMessage;
export type OperatorRuntimeAttachment = LegacyOperatorChatAttachment;
export type OperatorRuntimeResult = LegacyMastraChatResult;
export type OperatorAgentRunExecutionMode = "in-process" | "queue";

export type OperatorAgentRunJobPayload = Record<string, unknown> & {
  messages: OperatorRuntimeMessage[];
  attachments: OperatorRuntimeAttachment[];
  runId: string;
  workspace: string;
  scopeId?: string;
  taskId?: string;
};

export type OperatorRunCommandOptions = {
  env?: Env;
  queue?: JobQueue;
  inProcessRunner?: (params: OperatorAgentInProcessRunParams) => Promise<OperatorRuntimeResult>;
};

export async function executeOperatorRunCommand(
  params: OperatorAgentRunJobPayload & {
    onAgentTrace: (trace: unknown) => void;
  },
  options: OperatorRunCommandOptions = {}
): Promise<OperatorRuntimeResult> {
  const env = options.env ?? process.env;
  const mode = resolveAgentRunExecutionMode(env);
  return withOperatorSpan(
    "operator.agent.run",
    {
      "operator.run_id": params.runId,
      "operator.task_id": params.taskId ?? "",
      "operator.scope_id": params.scopeId ?? "",
      "operator.attachment_count": params.attachments.length,
      "operator.execution_mode": mode
    },
    async () => {
      if (mode === "queue") {
        return executeQueuedOperatorRun(params, { env, queue: options.queue });
      }
      return (options.inProcessRunner ?? runOperatorAgentInProcess)({
        messages: params.messages,
        attachments: params.attachments,
        runId: params.runId,
        workspace: params.workspace,
        scopeId: params.scopeId,
        onAgentTrace: params.onAgentTrace
      });
    }
  );
}

export function createOperatorAgentRunWorker(env: Env = process.env): JobWorker {
  return createJobWorkerFromEnv<OperatorAgentRunJobPayload>(
    AGENT_RUN_QUEUE,
    async (job) => {
      if (job.name !== RUN_AGENT_JOB_NAME) return undefined;
      return runOperatorAgentInProcess({
        messages: job.payload.messages,
        attachments: job.payload.attachments,
        runId: job.payload.runId,
        workspace: job.payload.workspace,
        scopeId: job.payload.scopeId,
        onAgentTrace: () => undefined
      });
    },
    env
  );
}

export function resolveAgentRunExecutionMode(env: Env = process.env): OperatorAgentRunExecutionMode {
  const explicit = env.OPERATOR_AGENT_RUN_EXECUTION_MODE?.trim().toLowerCase();
  if (explicit === "queue" || explicit === "bullmq") return "queue";
  if (explicit === "in-process" || explicit === "in_process" || explicit === "direct") return "in-process";
  if (env.NODE_ENV === "production" && env.OPERATOR_ALLOW_IN_PROCESS_AGENT_RUN !== "true") return "queue";
  return "in-process";
}

async function executeQueuedOperatorRun(
  params: OperatorAgentRunJobPayload,
  options: { env: Env; queue?: JobQueue }
): Promise<OperatorRuntimeResult> {
  const queue = options.queue ?? createJobQueueFromEnv(options.env);
  if (!queue.enqueueAndWait) {
    throw new Error("Operator agent run queue does not support waiting for worker results.");
  }
  const waitMs = positiveInteger(options.env.OPERATOR_AGENT_RUN_QUEUE_WAIT_MS, DEFAULT_AGENT_RUN_QUEUE_WAIT_MS);
  const { result } = await queue.enqueueAndWait<OperatorAgentRunJobPayload, OperatorRuntimeResult>(
    AGENT_RUN_QUEUE,
    RUN_AGENT_JOB_NAME,
    params,
    { timeoutMs: waitMs }
  );
  return result;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
