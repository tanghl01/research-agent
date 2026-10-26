import type { OperatorAgUiEvent } from "../ag-ui";
import { createServerChatPersistence, createServerConversationSession } from "../operator-backend/conversations";
import { createServerAgentRunPersistence } from "../operator-backend/runs";
import { recordOperatorException } from "./observability";

export type ServerChatPersistenceHandle = NonNullable<Awaited<ReturnType<typeof createServerChatPersistence>>>;
export type ServerConversationSessionHandle = NonNullable<Awaited<ReturnType<typeof createServerConversationSession>>>;
export type ServerAgentRunPersistenceHandle = Awaited<ReturnType<typeof createServerAgentRunPersistence>>;

export async function initializeServerChatPersistence(
  params: Parameters<typeof createServerChatPersistence>[0],
  options: { backendRequired: boolean; runId: string; taskId?: string }
): Promise<ServerChatPersistenceHandle | null> {
  try {
    const persistence = await createServerChatPersistence(params);
    if (!persistence && options.backendRequired) {
      throw new Error("Operator backend is enabled but server chat persistence could not be resolved.");
    }
    return persistence;
  } catch (error) {
    recordOperatorException(
      "operator.chat.server_persistence_init_failed",
      { "operator.run_id": options.runId, "operator.task_id": options.taskId ?? "", "operator.backend_required": options.backendRequired },
      error
    );
    if (options.backendRequired) throw error;
    return null;
  }
}

export async function initializeServerConversationSession(
  params: Parameters<typeof createServerConversationSession>[0],
  options: { backendRequired: boolean; runId: string; taskId?: string }
): Promise<ServerConversationSessionHandle | null> {
  try {
    const session = await createServerConversationSession(params);
    if (!session && options.backendRequired) {
      throw new Error("Operator backend is enabled but server conversation session could not be resolved.");
    }
    return session;
  } catch (error) {
    recordOperatorException(
      "operator.chat.server_conversation_session_init_failed",
      { "operator.run_id": options.runId, "operator.task_id": options.taskId ?? "", "operator.backend_required": options.backendRequired },
      error
    );
    if (options.backendRequired) throw error;
    return null;
  }
}

export async function persistServerChatMessages(
  session: ServerConversationSessionHandle | null,
  params: Parameters<ServerConversationSessionHandle["persistMessages"]>[0],
  options: { backendRequired: boolean; runId: string; taskId?: string }
): Promise<ServerChatPersistenceHandle | null> {
  if (!session) return null;
  try {
    return await session.persistMessages(params);
  } catch (error) {
    recordOperatorException(
      "operator.chat.server_messages_persist_failed",
      { "operator.run_id": options.runId, "operator.task_id": options.taskId ?? "", "operator.backend_required": options.backendRequired },
      error
    );
    if (options.backendRequired) throw error;
    return null;
  }
}

export async function initializeServerRunPersistence(
  params: Parameters<typeof createServerAgentRunPersistence>[0],
  options: { runId: string; taskId?: string }
): Promise<ServerAgentRunPersistenceHandle> {
  try {
    return await createServerAgentRunPersistence(params);
  } catch (error) {
    recordOperatorException(
      "operator.chat.server_run_persistence_init_failed",
      { "operator.run_id": options.runId, "operator.task_id": options.taskId ?? "" },
      error
    );
    throw error;
  }
}

export async function appendServerRunEventAndWait(
  serverRun: ServerAgentRunPersistenceHandle | null,
  event: OperatorAgUiEvent,
  options: { runId: string; taskId?: string }
): Promise<void> {
  if (!serverRun) return;
  try {
    await serverRun.appendEvent(event);
  } catch (error) {
    recordOperatorException(
      "operator.chat.server_run_event_append_failed",
      {
        "operator.run_id": options.runId,
        "operator.task_id": options.taskId ?? "",
        "operator.event_type": event.type
      },
      error
    );
  }
}

export function appendServerRunEvent(
  serverRun: ServerAgentRunPersistenceHandle | null,
  event: OperatorAgUiEvent,
  options: { runId: string; taskId?: string }
): void {
  void appendServerRunEventAndWait(serverRun, event, options);
}
