import path from "node:path";
import { EventType } from "@ag-ui/core";
import { type ArtifactRecord, readJson } from "@operator/core";
import type { OperatorConversationMessage as OperatorChatMessage } from "@operator/contracts";
import { customEvent, type OperatorAgUiEvent, runError } from "../ag-ui";
import { rewriteRegisteredArtifactLinks, type ServerArtifactRegistration } from "../operator-backend/artifacts";
import { operatorTaskAgUiEventChannel, publishOperatorTaskAgUiEvent } from "../operator-task-events";
import { artifactFinalizationErrorMessage, finalizeServerRunArtifacts } from "./artifact-finalization-service";
import type { LegacyOperatorChatAttachment as OperatorChatAttachment } from "./legacy-mastra-chat-result";
import { recordOperatorException } from "./observability";
import { buildRuntimeAgUiEvents } from "./runtime-ag-ui-adapter";
import { operatorChatResultToRuntimeAdapterResult } from "./runtime-adapter";
import { summarizeOperatorRuntimeResult } from "./runtime-result-summary";
import { executeOperatorRunCommand, type OperatorRuntimeResult } from "./run-command-service";
import {
  appendServerRunEventAndWait,
  type ServerAgentRunPersistenceHandle,
  type ServerChatPersistenceHandle
} from "./server-run-session-service";

const SERVER_RUN_ARTIFACT_REGISTRATION_TIMEOUT_MS = 30_000;

export type CompletedOperatorChatExecution = {
  result: OperatorRuntimeResult;
  artifacts: ArtifactRecord[];
  artifactRegistrations: ServerArtifactRegistration[];
  assistantText: string;
};

export async function runAndPersistOperatorChat(params: {
  messages: OperatorChatMessage[];
  attachments: OperatorChatAttachment[];
  runId: string;
  workspace: string;
  scopeId?: string;
  onAgentTrace: (trace: unknown) => void;
  serverPersistence: ServerChatPersistenceHandle | null;
  serverRun: ServerAgentRunPersistenceHandle | null;
  taskId?: string;
}): Promise<CompletedOperatorChatExecution> {
  const startedAt = new Date().toISOString();
  try {
    const result = await executeOperatorRunCommand({
      messages: params.messages,
      attachments: params.attachments,
      runId: params.runId,
      workspace: params.workspace,
      scopeId: params.scopeId,
      taskId: params.taskId,
      onAgentTrace: params.onAgentTrace
    });

    const artifacts = readArtifactManifest(result);
    const assistantTextBeforeArtifactFinalization = summarizeOperatorRuntimeResult(result, {
      artifacts,
      messages: params.messages
    });
    const runtimeResult = operatorChatResultToRuntimeAdapterResult({
      result,
      taskId: params.taskId ?? params.runId,
      conversationId: params.serverPersistence?.conversation.id ?? params.taskId ?? params.runId,
      turnId: `${params.runId}:turn`,
      userMessageId: latestUserMessageId(params.messages) ?? params.runId,
      messages: params.messages,
      startedAt,
      finishedAt: new Date().toISOString()
    });
    if (params.serverRun) await params.serverRun.markSucceeded(result, assistantTextBeforeArtifactFinalization, runtimeResult);
    publishTerminalTaskEvent(params.taskId, result, taskEventChannelId(params.serverPersistence));

    const artifactFinalization =
      params.serverPersistence && params.serverRun
        ? await finalizeServerRunArtifacts({
            projectId: params.serverPersistence.project.id,
            agentRunId: params.serverRun.record.id,
            workspace: result.workspace,
            artifacts,
            createdBy: params.serverPersistence.userId,
            timeoutMs: SERVER_RUN_ARTIFACT_REGISTRATION_TIMEOUT_MS
          })
        : { registrations: [] };
    const artifactRegistrations = artifactFinalization.registrations;
    const resultForPersistence: OperatorRuntimeResult = artifactRegistrations.length
      ? {
          ...result,
          response: result.response ? rewriteRegisteredArtifactLinks(result.response, artifactRegistrations) : result.response
        }
      : result;
    const assistantText = rewriteRegisteredArtifactLinks(
      summarizeOperatorRuntimeResult(resultForPersistence, {
        artifacts,
        messages: params.messages
      }),
      artifactRegistrations
    );

    if (params.taskId) {
      for (const event of buildRuntimeAgUiEvents(resultForPersistence, params.taskId, { includeTrace: false })) {
        if (isTerminalAgUiEvent(event)) continue;
        await appendServerRunEventAndWait(params.serverRun, event, { runId: params.runId, taskId: params.taskId });
      }
      if (artifactFinalization.error) {
        await appendServerRunEventAndWait(
          params.serverRun,
          customEvent("operator.artifact_registration_error", {
            message: artifactFinalizationErrorMessage(artifactFinalization.error),
            artifactCount: artifacts.length
          }),
          { runId: params.runId, taskId: params.taskId }
        );
      }
    }
    await appendServerAssistantMessage(
      params.serverPersistence,
      assistantText,
      {
        runId: params.runId,
        scopeId: params.scopeId ?? null,
        status: result.status
      },
      { runId: params.runId, taskId: params.taskId }
    );

    return {
      result: resultForPersistence,
      artifacts,
      artifactRegistrations,
      assistantText
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (params.serverRun) await params.serverRun.markFailed(error);
    await appendServerAssistantMessage(
      params.serverPersistence,
      `任务执行失败。\n\n错误：${message}\n`,
      {
        runId: params.runId,
        scopeId: params.scopeId ?? null,
        status: "failed"
      },
      { runId: params.runId, taskId: params.taskId }
    );
    publishOperatorTaskFailureEvent(params.taskId, message, taskEventChannelId(params.serverPersistence));
    throw error;
  }
}

function isTerminalAgUiEvent(event: OperatorAgUiEvent): boolean {
  return event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR;
}

async function appendServerAssistantMessage(
  serverPersistence: ServerChatPersistenceHandle | null,
  content: string,
  metadata: Record<string, unknown>,
  options: { runId: string; taskId?: string }
): Promise<void> {
  if (!serverPersistence) return;
  try {
    await serverPersistence.appendAssistantMessage(content, metadata);
  } catch (error) {
    recordOperatorException(
      "operator.chat.server_assistant_message_append_failed",
      { "operator.run_id": options.runId, "operator.task_id": options.taskId ?? "" },
      error
    );
  }
}

function latestUserMessageId(messages: OperatorChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && message.id) return message.id;
  }
  return undefined;
}

function publishTerminalTaskEvent(taskId: string | undefined, result: OperatorRuntimeResult, channelId?: string): void {
  if (!taskId || taskId === "home") return;
  const terminalEvent = buildRuntimeAgUiEvents(result, taskId, { includeTrace: false }).find(isTerminalAgUiEvent);
  if (!terminalEvent) return;
  void publishOperatorTaskAgUiEvent({ taskId, event: terminalEvent, source: "live" }, { channelId }).catch((error) => {
    recordOperatorException(
      "operator.chat.task_terminal_event_publish_failed",
      { "operator.task_id": taskId, "operator.event_type": terminalEvent.type },
      error
    );
  });
}

function publishOperatorTaskFailureEvent(taskId: string | undefined, message: string, channelId?: string): void {
  if (!taskId || taskId === "home") return;
  void publishOperatorTaskAgUiEvent(
    {
      taskId,
      event: runError(message, "OPERATOR_CHAT_ROUTE_ERROR"),
      source: "live"
    },
    { channelId }
  ).catch((error) => {
    recordOperatorException("operator.chat.task_failure_event_publish_failed", { "operator.task_id": taskId }, error);
  });
}

function taskEventChannelId(serverPersistence: ServerChatPersistenceHandle | null): string | undefined {
  if (!serverPersistence) return undefined;
  return operatorTaskAgUiEventChannel({
    userId: serverPersistence.userId,
    projectId: serverPersistence.project.id,
    conversationId: serverPersistence.conversation.id,
    taskId: serverPersistence.conversation.client_task_id ?? serverPersistence.conversation.id
  });
}

type ArtifactManifestFile = {
  artifacts?: ArtifactRecord[];
};

function readArtifactManifest(result: { workspace: string; outputs?: { artifactManifest?: string } }): ArtifactRecord[] {
  const manifestPath = result.outputs?.artifactManifest ?? "output/artifact_manifest.json";
  return safeReadJson<ArtifactManifestFile>(path.join(result.workspace, manifestPath))?.artifacts ?? [];
}

function safeReadJson<T>(filePath: string): T | undefined {
  try {
    return readJson<T>(filePath);
  } catch {
    return undefined;
  }
}
