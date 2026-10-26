import path from "node:path";
import { repoRoot } from "@operator/core";
import { createUIMessageStream, createUIMessageStreamResponse, generateId } from "ai";
import { z } from "zod";
import { agUiEventPart, customEvent, type OperatorAgUiEvent, runError, runStarted } from "@/lib/ag-ui";
import { parseJsonBody, validationErrorResponse } from "@/lib/api/schema";
import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { runAndPersistOperatorChat } from "@/lib/operator-application/operator-chat-execution-service";
import {
  mergeHistoricalMessages,
  mergeWorkspaceAttachments,
  normalizeOperatorChatInput,
  resolveRunWorkspaceId,
  resolveServerRunWorkspace,
  titleFromRawMessages
} from "@/lib/operator-application/operator-chat-request-service";
import { recordOperatorException } from "@/lib/operator-application/observability";
import { buildRuntimeAgUiEvents } from "@/lib/operator-application/runtime-ag-ui-adapter";
import { createOperatorRunProgressEmitter } from "@/lib/operator-application/run-progress-service";
import {
  appendServerRunEvent,
  initializeServerConversationSession,
  initializeServerRunPersistence,
  persistServerChatMessages
} from "@/lib/operator-application/server-run-session-service";
import { uploadServerUserAttachments } from "@/lib/operator-backend/artifacts";
import { getOperatorBackendRuntimeStatus } from "@/lib/operator-backend/config";

export const runtime = "nodejs";
export const maxDuration = 3900;

const chatRequestSchema = z.object({
  messages: z.array(z.unknown()).optional().default([])
});

export async function POST(req: Request) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId") ?? undefined;
  const scopeId = url.searchParams.get("scope") ?? undefined;
  let body: z.infer<typeof chatRequestSchema>;
  try {
    assertSameOrigin(req);
    await consumeRateLimit(req, { namespace: "operator-chat", points: 30, durationSeconds: 60 });
    body = await parseJsonBody(req, chatRequestSchema);
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
  const runId = `web_${generateId()}`;
  const backendRequired = getOperatorBackendRuntimeStatus().enabled;
  const scopedTaskId = taskId && taskId !== "home" ? taskId : undefined;
  const serverSession = await initializeServerConversationSession(
    {
      request: req,
      taskId: scopedTaskId,
      title: titleFromRawMessages(body.messages ?? [])
    },
    { backendRequired, runId, taskId }
  );
  const workspaceTaskId = !serverSession && scopedTaskId ? resolveRunWorkspaceId(scopedTaskId) : undefined;
  const workspace = serverSession
    ? resolveServerRunWorkspace({
        userId: serverSession.userId,
        projectId: serverSession.project.id,
        conversationId: serverSession.conversation.id,
        runId
      })
    : workspaceTaskId
      ? `tmp/runs/web/${workspaceTaskId}`
      : `tmp/runs/web/${runId}`;
  const workspaceAbsolute = path.join(repoRoot(), workspace);
  const normalized = normalizeOperatorChatInput(body.messages ?? [], workspaceAbsolute);
  const currentMessages = normalized.messages;
  const uploadedAttachments = mergeWorkspaceAttachments(workspaceAbsolute, normalized.attachments);
  const serverPersistence = serverSession
    ? await persistServerChatMessages(
        serverSession,
        {
          currentMessages,
          metadata: {
            scopeId: scopeId ?? null
          }
        },
        { backendRequired, runId, taskId }
      )
    : null;
  const messages =
    serverPersistence?.messagesForRun ??
    (workspaceTaskId ? mergeHistoricalMessages(path.join(repoRoot(), "tmp/runs/web", workspaceTaskId), currentMessages) : currentMessages);
  const serverRun = serverPersistence
    ? await initializeServerRunPersistence(
        {
          userId: serverPersistence.userId,
          project: serverPersistence.project,
          conversation: serverPersistence.conversation,
          runId,
          workspace,
          scopeId,
          messages
        },
        { runId, taskId }
      )
    : null;
  if (serverPersistence && normalized.attachments.length) {
    await uploadServerUserAttachments({
      projectId: serverPersistence.project.id,
      createdBy: serverPersistence.userId,
      attachments: normalized.attachments
    }).catch((error) => {
      recordOperatorException(
        "operator.chat.upload_user_attachments_failed",
        { "operator.run_id": runId, "operator.task_id": taskId ?? "", "operator.attachment_count": normalized.attachments.length },
        error
      );
    });
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const threadId = taskId ?? runId;
      const startedAt = new Date();
      const writeStreamPart = (part: Parameters<typeof writer.write>[0]) => {
        try {
          writer.write(part);
        } catch {
          // The browser may disconnect while the agent continues in-process.
        }
      };
      const progress = createOperatorRunProgressEmitter({
        threadId,
        runId,
        startedAtMs: startedAt.getTime(),
        onEvent: (event) => {
          writeStreamPart(agUiEventPart(event));
          appendServerRunEvent(serverRun, event, { runId, taskId });
        }
      });
      const writeProgress = (label: string, detail?: string) => {
        progress.emit(label, detail);
      };
      const writeAgentTrace = (trace: unknown) => {
        const event = customEvent("operator.agent_trace", trace);
        writeStreamPart(agUiEventPart(event));
        appendServerRunEvent(serverRun, event, { runId, taskId });
      };
      const started: OperatorAgUiEvent = runStarted(threadId, runId, startedAt.getTime());
      writeStreamPart(agUiEventPart(started));
      appendServerRunEvent(serverRun, started, { runId, taskId });
      writeProgress("正在连接 Agent", scopeId ? `执行范围：${scopeId}` : "等待 Agent 接收任务");
      progress.startHeartbeat("Agent 正在执行", "等待实时输出或最终结果");

      const executionPromise = runAndPersistOperatorChat({
        messages,
        attachments: uploadedAttachments,
        runId,
        workspace,
        scopeId,
        onAgentTrace: writeAgentTrace,
        serverPersistence,
        serverRun,
        taskId
      });

      try {
        const execution = await executionPromise;
        const resultForPersistence = execution.result;
        writeProgress("Agent 执行完成", "正在整理结果");

        for (const event of buildRuntimeAgUiEvents(resultForPersistence, threadId, { includeTrace: false })) {
          writeStreamPart(agUiEventPart(event));
        }

        const textId = `ag-ui-result-${runId}`;
        writeStreamPart({ type: "text-start", id: textId });
        writeStreamPart({
          type: "text-delta",
          id: textId,
          delta: execution.assistantText
        });
        writeStreamPart({ type: "text-end", id: textId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed: OperatorAgUiEvent = runError(message, "OPERATOR_CHAT_ROUTE_ERROR");
        writeStreamPart(agUiEventPart(failed));
        const textId = `operator-error-${runId}`;
        writeStreamPart({ type: "text-start", id: textId });
        writeStreamPart({
          type: "text-delta",
          id: textId,
          delta: `任务执行失败。\n\n错误：${message}\n`
        });
        writeStreamPart({ type: "text-end", id: textId });
      } finally {
        progress.stop();
      }
    },
    onError: (error) => {
      return error instanceof Error ? error.message : String(error);
    }
  });

  const response = createUIMessageStreamResponse({ stream });
  if (serverPersistence?.setCookie) response.headers.append("set-cookie", serverPersistence.setCookie);
  return response;
}
