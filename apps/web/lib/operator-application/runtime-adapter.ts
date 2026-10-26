import { createProductEvent, type OperatorErrorCode, type RuntimeAdapterResult, RuntimeAdapterResultSchema } from "@operator/contracts";
import type {
  LegacyOperatorChatMessage as OperatorChatMessage,
  LegacyMastraChatResult
} from "./legacy-mastra-chat-result";

export function operatorChatResultToRuntimeAdapterResult(params: {
  result: LegacyMastraChatResult;
  taskId: string;
  conversationId: string;
  turnId: string;
  userMessageId: string;
  messages: OperatorChatMessage[];
  startedAt: string;
  finishedAt?: string;
}): RuntimeAdapterResult {
  const finishedAt = params.finishedAt ?? new Date().toISOString();
  return RuntimeAdapterResultSchema.parse({
    identity: {
      taskId: params.taskId,
      conversationId: params.conversationId,
      runId: params.result.run_id,
      turnId: params.turnId,
      userMessageId: params.userMessageId
    },
    status: params.result.status,
    response: params.result.response,
    output: { result: params.result },
    artifacts: [],
    attempts: [
      {
        runtimeId: params.result.agent.id,
        provider: providerFromRuntime(params.result.agent.runtime),
        status: params.result.status === "succeeded" ? "succeeded" : "failed",
        startedAt: params.startedAt,
        finishedAt,
        error:
          params.result.status === "failed"
            ? {
                code: normalizeOperatorErrorCode(params.result.agent.error_code),
                message: params.result.agent.error ?? "Operator runtime failed",
                detail: params.result.agent.error_detail,
                source: "runtime"
              }
            : undefined
      }
    ],
    trace: (params.result.agent.trace ?? []).map((trace, index) =>
      createProductEvent({
        source: "/operator/mastra",
        taskId: params.taskId,
        runId: params.result.run_id,
        seq: index + 1,
        kind: "runtime.trace",
        timestamp: timestampFromTrace(trace) ?? finishedAt,
        payload: isRecord(trace) ? trace : { value: trace }
      })
    ),
    error:
      params.result.status === "failed"
        ? {
            code: normalizeOperatorErrorCode(params.result.agent.error_code),
            message: params.result.agent.error ?? "Operator runtime failed",
            detail: params.result.agent.error_detail,
            source: "runtime"
          }
        : undefined,
    startedAt: params.startedAt,
    finishedAt
  });
}

function providerFromRuntime(runtime: string): RuntimeAdapterResult["attempts"][number]["provider"] {
  if (runtime.includes("acp")) return "acp";
  if (runtime.includes("codex")) return "codex";
  if (runtime.includes("claude")) return "claude";
  if (runtime.includes("openhands")) return "openhands";
  if (runtime.includes("deepseek")) return "deepseek";
  if (runtime.includes("mastra")) return "mastra";
  return "other";
}

function normalizeOperatorErrorCode(code: string | undefined): OperatorErrorCode {
  if (code === "OPERATOR_ACP_CONNECTION_CLOSED") return "OPERATOR_ACP_CONNECTION_CLOSED";
  if (code === "OPERATOR_RUNTIME_TIMEOUT") return "OPERATOR_RUNTIME_TIMEOUT";
  if (code === "OPERATOR_RUNTIME_EMPTY_RESPONSE") return "OPERATOR_RUNTIME_EMPTY_RESPONSE";
  if (code === "OPERATOR_RUNTIME_PROTOCOL_ERROR") return "OPERATOR_RUNTIME_PROTOCOL_ERROR";
  if (code === "OPERATOR_RUNTIME_CANCELLED") return "OPERATOR_RUNTIME_CANCELLED";
  if (code === "OPERATOR_RUNTIME_NOT_CONFIGURED") return "OPERATOR_RUNTIME_NOT_CONFIGURED";
  return "OPERATOR_UNKNOWN_ERROR";
}

function timestampFromTrace(trace: unknown): string | undefined {
  if (!isRecord(trace)) return undefined;
  const value = trace.timestamp;
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
