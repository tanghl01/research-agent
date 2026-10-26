import { EventType } from "@ag-ui/core";
import {
  createProductEvent,
  isActiveRunStatus,
  isRunStatus,
  type ArtifactContract,
  type MessageContract,
  type ProductEvent,
  type RunStatus,
  type RuntimeAdapterResult,
  type TaskSnapshot
} from "@operator/contracts";
import { agentRunEvents, agentRuns, artifacts, fileAssets, getDatabase, messages } from "@operator/db";
import type { OperatorConversationMessage as OperatorChatMessage } from "@operator/contracts";
import { asc, desc, eq } from "drizzle-orm";
import { customEvent, isOperatorAgUiEvent, OPERATOR_PROGRESS_ACTIVITY_TYPE, type OperatorAgUiEvent, runError, runStarted } from "../ag-ui";
import type { LegacyMastraChatResult } from "../operator-application/legacy-mastra-chat-result";
import {
  findAccessibleConversation,
  getServerConversationContext,
  type ServerConversationRecord,
  type ServerProjectRecord
} from "./conversations";

export type ServerAgentRunRecord = {
  id: string;
  project_id: string;
  conversation_id: string | null;
  workflow_run_id: string | null;
  agent_id: string;
  agent_version: string;
  status: RunStatus | string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: Record<string, unknown> | null;
  workspace: string | null;
  created_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ServerAgentRunEventRecord = {
  id: string;
  agent_run_id: string;
  seq: number;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type ServerArtifactRecord = {
  id: string;
  project_id: string;
  agent_run_id: string | null;
  job_id: string | null;
  type: string;
  bucket_id: string;
  object_path: string;
  filename: string;
  content_type: string;
  sha256: string;
  size_bytes: number;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

export type ServerRunStore = {
  createAgentRun(params: {
    projectId: string;
    conversationId: string;
    runId: string;
    agentId: string;
    input: Record<string, unknown>;
    workspace: string;
    createdBy: string;
    startedAt: string;
  }): Promise<ServerAgentRunRecord>;
  appendAgentRunEvent(params: { agentRunId: string; kind: string; payload: Record<string, unknown> }): Promise<ServerAgentRunEventRecord>;
  updateAgentRun(params: {
    agentRunId: string;
    status: string;
    output?: Record<string, unknown>;
    error?: Record<string, unknown> | null;
    finishedAt?: string;
  }): Promise<ServerAgentRunRecord>;
  findLatestAgentRun(conversationId: string): Promise<ServerAgentRunRecord | null>;
  listAgentRunEvents(agentRunId: string): Promise<ServerAgentRunEventRecord[]>;
  listArtifactsForRun(agentRunId: string): Promise<ServerArtifactRecord[]>;
  listMessages(
    conversationId: string
  ): Promise<Array<{ id: string; role: OperatorChatMessage["role"] | "tool"; content: string; metadata: Record<string, unknown> }>>;
};

export type ServerAgentRunPersistence = {
  record: ServerAgentRunRecord;
  appendEvent(event: OperatorAgUiEvent): Promise<void>;
  markSucceeded(result: LegacyMastraChatResult, assistantText: string, runtimeResult?: RuntimeAdapterResult): Promise<void>;
  markFailed(error: unknown): Promise<void>;
};

type ServerTaskSnapshotCompatibility = {
  request: {
    run_id?: string;
    messages: OperatorChatMessage[];
  };
  plan: {
    phase?: string;
    trace: TraceEvent[];
    error?: string;
    error_code?: string;
    error_detail?: string;
  };
  events: OperatorAgUiEvent[];
  result?: {
    run_id: string;
    status: "succeeded" | "failed";
    response?: string;
    selected_skills: LegacyMastraChatResult["selected_skills"];
    runs: LegacyMastraChatResult["runs"];
    agent: LegacyMastraChatResult["agent"];
  };
};

export type TraceEvent = {
  kind: "action" | "observation" | "error";
  label: string;
  detail?: string;
  tool?: string;
  timestamp?: string;
};

export class ServerRunError extends Error {
  code?: string;

  constructor(message: string, options?: { code?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "ServerRunError";
    this.code = options?.code;
  }
}

export async function createServerAgentRunPersistence(params: {
  userId: string;
  project: ServerProjectRecord;
  conversation: ServerConversationRecord;
  runId: string;
  workspace: string;
  scopeId?: string;
  messages: OperatorChatMessage[];
  store?: ServerRunStore;
}): Promise<ServerAgentRunPersistence> {
  const store = params.store ?? createServerRunStore();
  const startedAt = new Date().toISOString();
  const record = await store.createAgentRun({
    projectId: params.project.id,
    conversationId: params.conversation.id,
    runId: params.runId,
    agentId: params.scopeId ?? "operator-chat",
    workspace: params.workspace,
    createdBy: params.userId,
    startedAt,
    input: {
      clientRunId: params.runId,
      scopeId: params.scopeId ?? null,
      messageCount: params.messages.length
    }
  });

  return {
    record,
    async appendEvent(event) {
      await store.appendAgentRunEvent({
        agentRunId: record.id,
        kind: event.type,
        payload: eventToPayload(event)
      });
    },
    async markSucceeded(result, assistantText, runtimeResult) {
      await store.updateAgentRun({
        agentRunId: record.id,
        status: result.status,
        output: {
          clientRunId: params.runId,
          assistantText,
          result,
          runtimeResult
        },
        error:
          result.status === "failed"
            ? {
                message: result.agent.error ?? "Operator task failed",
                code: result.agent.error_code ?? "OPERATOR_TASK_FAILED",
                detail: result.agent.error_detail
              }
            : null,
        finishedAt: new Date().toISOString()
      });
      const threadId = params.conversation.client_task_id ?? params.conversation.id;
      await store.appendAgentRunEvent({
        agentRunId: record.id,
        kind: result.status === "succeeded" ? EventType.RUN_FINISHED : EventType.RUN_ERROR,
        payload:
          result.status === "succeeded"
            ? eventToPayload({
                type: EventType.RUN_FINISHED,
                threadId,
                runId: params.runId,
                timestamp: Date.now(),
                outcome: { type: "success" },
                result
              })
            : eventToPayload(runError(result.agent.error ?? "Operator task failed", result.agent.error_code ?? "OPERATOR_TASK_FAILED"))
      });
    },
    async markFailed(error) {
      const normalized = normalizeRunError(error);
      await store.updateAgentRun({
        agentRunId: record.id,
        status: "failed",
        output: {
          clientRunId: params.runId
        },
        error: normalized,
        finishedAt: new Date().toISOString()
      });
      await store.appendAgentRunEvent({
        agentRunId: record.id,
        kind: EventType.RUN_ERROR,
        payload: eventToPayload(runError(stringValue(normalized.message) ?? "Operator task failed", stringValue(normalized.code)))
      });
    }
  };
}

export async function loadServerTaskRunDetail(taskId: string | null | undefined): Promise<TaskSnapshot | null> {
  if (!isSafeTaskId(taskId)) return null;

  const context = await getServerConversationContext();
  if (!context) return null;
  const conversation = await findAccessibleConversation(context, taskId);
  if (!conversation) return null;

  return loadServerTaskRunDetailForConversation(taskId, conversation.id);
}

export async function loadServerTaskRunDetailForReconciler(params: {
  taskId: string | null | undefined;
  conversationId?: string | null;
}): Promise<TaskSnapshot | null> {
  const conversationId = params.conversationId;
  if (!isSafeTaskId(params.taskId) || !conversationId || !isUuid(conversationId)) return null;
  return loadServerTaskRunDetailForConversation(params.taskId, conversationId);
}

async function loadServerTaskRunDetailForConversation(taskId: string, conversationId: string): Promise<TaskSnapshot | null> {
  const store = createServerRunStore();
  const runMessages = await store.listMessages(conversationId);
  const chatMessages = messagesToChatMessages(runMessages);
  const run = await store.findLatestAgentRun(conversationId);
  if (!run) {
    return {
      taskId,
      conversationId,
      exists: true,
      messages: messagesToContracts(taskId, conversationId, chatMessages),
      productEvents: [],
      agUiEvents: [],
      events: [],
      artifacts: [],
      backend: "server",
      compatibility: {
        request: {
          messages: chatMessages
        },
        plan: {
          phase: "queued",
          trace: []
        },
        events: []
      } satisfies ServerTaskSnapshotCompatibility
    };
  }

  const events = await store.listAgentRunEvents(run.id);
  const runArtifacts = await store.listArtifactsForRun(run.id);
  return taskRunDetailFromRecords({
    taskId,
    run,
    events,
    messages: chatMessages,
    artifacts: runArtifacts
  });
}

export async function repairLatestServerTaskRunFromResult(params: {
  taskId: string;
  result: LegacyMastraChatResult;
  evidence: Record<string, unknown>;
}): Promise<{ repaired: boolean; runId?: string; reason?: string }> {
  if (!isSafeTaskId(params.taskId)) return { repaired: false, reason: "invalid_task_id" };

  const context = await getServerConversationContext();
  if (!context) return { repaired: false, reason: "no_context" };
  const conversation = await findAccessibleConversation(context, params.taskId);
  if (!conversation) return { repaired: false, reason: "conversation_not_found" };

  return repairLatestServerTaskRunForConversation({
    taskId: params.taskId,
    conversationId: conversation.id,
    result: params.result,
    evidence: params.evidence
  });
}

export async function repairLatestServerTaskRunFromResultForReconciler(params: {
  taskId: string;
  conversationId?: string | null;
  result: LegacyMastraChatResult;
  evidence: Record<string, unknown>;
}): Promise<{ repaired: boolean; runId?: string; reason?: string }> {
  if (!isSafeTaskId(params.taskId)) return { repaired: false, reason: "invalid_task_id" };
  const conversationId = params.conversationId;
  if (!conversationId || !isUuid(conversationId)) return { repaired: false, reason: "conversation_scope_missing" };

  return repairLatestServerTaskRunForConversation({
    taskId: params.taskId,
    conversationId,
    result: params.result,
    evidence: params.evidence
  });
}

async function repairLatestServerTaskRunForConversation(params: {
  taskId: string;
  conversationId: string;
  result: LegacyMastraChatResult;
  evidence: Record<string, unknown>;
}): Promise<{ repaired: boolean; runId?: string; reason?: string }> {
  const store = createServerRunStore();
  const run = await store.findLatestAgentRun(params.conversationId);
  if (!run) return { repaired: false, reason: "run_not_found" };
  const status = contractRunStatus(run.status);
  if (!isActiveRunStatus(status)) return { repaired: false, runId: stringValue(run.input.clientRunId) ?? run.id, reason: "not_active" };

  const clientRunId = stringValue(run.input.clientRunId) ?? params.result.run_id ?? run.id;
  const finishedAt = new Date().toISOString();
  await store.updateAgentRun({
    agentRunId: run.id,
    status: params.result.status,
    output: {
      ...run.output,
      clientRunId,
      result: params.result,
      reconciler: {
        repairedAt: finishedAt,
        evidence: params.evidence
      }
    },
    error:
      params.result.status === "failed"
        ? {
            message: params.result.agent.error ?? "Operator task failed",
            code: params.result.agent.error_code ?? "OPERATOR_TASK_FAILED",
            detail: params.result.agent.error_detail
          }
        : null,
    finishedAt
  });
  await store.appendAgentRunEvent({
    agentRunId: run.id,
    kind: params.result.status === "succeeded" ? EventType.RUN_FINISHED : EventType.RUN_ERROR,
    payload:
      params.result.status === "succeeded"
        ? eventToPayload({
            type: EventType.RUN_FINISHED,
            threadId: params.taskId,
            runId: clientRunId,
            timestamp: Date.now(),
            outcome: { type: "success" },
            result: params.result
          })
        : eventToPayload(
            runError(params.result.agent.error ?? "Operator task failed", params.result.agent.error_code ?? "OPERATOR_TASK_FAILED")
          )
  });

  return { repaired: true, runId: clientRunId };
}

export function taskRunDetailFromRecords(params: {
  taskId: string;
  run: ServerAgentRunRecord;
  events: ServerAgentRunEventRecord[];
  messages: OperatorChatMessage[];
  artifacts?: ServerArtifactRecord[];
}): TaskSnapshot {
  const clientRunId = stringValue(params.run.input.clientRunId) ?? stringValue(params.run.output.clientRunId) ?? params.run.id;
  const error = params.run.error ?? undefined;
  const result = legacyMastraChatResultValue(params.run.output.result);
  const assistantText = stringValue(params.run.output.assistantText);
  const trace = runEventsToTrace(params.events);
  const agUiEvents = runEventsToAgUiEvents(params.events, {
    threadId: params.taskId,
    runId: clientRunId,
    startedAt: params.run.started_at ?? params.run.created_at
  });
  const productEvents = runEventsToProductEvents(params.events, {
    taskId: params.taskId,
    runId: clientRunId
  });
  const failed = params.run.status === "failed";
  const succeeded = params.run.status === "succeeded";
  const status = contractRunStatus(params.run.status);
  const compatibility = {
    request: {
      run_id: clientRunId,
      messages: params.messages
    },
    plan: {
      phase: params.run.status,
      trace,
      error: failed ? stringValue(error?.message) : undefined,
      error_code: failed ? stringValue(error?.code) : undefined,
      error_detail: failed ? stringValue(error?.detail) : undefined
    },
    events: agUiEvents,
    result:
      succeeded || failed
        ? {
            run_id: clientRunId,
            status: succeeded ? "succeeded" : "failed",
            response: succeeded ? (result?.response ?? assistantText) : undefined,
            selected_skills: result?.selected_skills ?? [],
            runs: result?.runs ?? [],
            agent:
              result?.agent ??
              (fallbackAgent(params.run.agent_id, {
                error: failed ? stringValue(error?.message) : undefined,
                error_code: failed ? stringValue(error?.code) : undefined,
                error_detail: failed ? stringValue(error?.detail) : undefined
              }) as LegacyMastraChatResult["agent"])
          }
        : undefined
  } satisfies ServerTaskSnapshotCompatibility;

  return {
    taskId: params.taskId,
    conversationId: params.run.conversation_id ?? undefined,
    workspace: params.run.workspace ?? undefined,
    exists: true,
    latestRun: {
      runId: clientRunId,
      status,
      startedAt: params.run.started_at ?? undefined,
      finishedAt: params.run.finished_at ?? undefined,
      error: params.run.error,
      output: params.run.output
    },
    messages: messagesToContracts(params.taskId, params.run.conversation_id ?? params.taskId, params.messages, clientRunId),
    events: productEvents,
    productEvents,
    agUiEvents,
    artifacts: (params.artifacts ?? []).map((artifact) =>
      artifactContractFromRecord(artifact, { taskId: params.taskId, runId: clientRunId })
    ),
    backend: "server",
    compatibility
  };
}

export function runEventsToTrace(events: ServerAgentRunEventRecord[]): TraceEvent[] {
  return events.flatMap((event) => traceFromEvent(event)).slice(-80);
}

export function runEventsToAgUiEvents(
  events: ServerAgentRunEventRecord[],
  fallback: { threadId: string; runId: string; startedAt?: string }
): OperatorAgUiEvent[] {
  return events.flatMap((event) => agUiEventFromRecord(event, fallback)).slice(-120);
}

export function runEventsToProductEvents(events: ServerAgentRunEventRecord[], fallback: { taskId: string; runId: string }): ProductEvent[] {
  return events.flatMap((event) => productEventFromRecord(event, fallback)).slice(-120);
}

export function createServerRunStore(): ServerRunStore {
  const db = getDatabase();

  return {
    async createAgentRun(params) {
      const [row] = await db
        .insert(agentRuns)
        .values({
          projectId: params.projectId,
          conversationId: params.conversationId,
          agentId: params.agentId,
          agentVersion: "0.1.0",
          status: "running",
          input: params.input,
          output: {},
          workspacePath: params.workspace,
          createdBy: params.createdBy,
          startedAt: new Date(params.startedAt)
        })
        .returning();
      if (!row) throw new ServerRunError("Failed to create agent run.");
      return agentRunFromRow(row);
    },

    async appendAgentRunEvent(params) {
      const [last] = await db
        .select({ seq: agentRunEvents.seq })
        .from(agentRunEvents)
        .where(eq(agentRunEvents.agentRunId, params.agentRunId))
        .orderBy(desc(agentRunEvents.seq))
        .limit(1);
      const [row] = await db
        .insert(agentRunEvents)
        .values({
          agentRunId: params.agentRunId,
          seq: (last?.seq ?? 0) + 1,
          kind: params.kind,
          payload: params.payload
        })
        .returning();
      if (!row) throw new ServerRunError("Failed to append agent run event.");
      return agentRunEventFromRow(row);
    },

    async updateAgentRun(params) {
      const [row] = await db
        .update(agentRuns)
        .set({
          status: runStatusValue(params.status),
          output: params.output,
          error: "error" in params ? params.error : undefined,
          finishedAt: params.finishedAt ? new Date(params.finishedAt) : undefined,
          updatedAt: new Date()
        })
        .where(eq(agentRuns.id, params.agentRunId))
        .returning();
      if (!row) throw new ServerRunError("Failed to update agent run.");
      return agentRunFromRow(row);
    },

    async findLatestAgentRun(conversationId) {
      const [row] = await db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.conversationId, conversationId))
        .orderBy(desc(agentRuns.createdAt))
        .limit(1);
      return row ? agentRunFromRow(row) : null;
    },

    async listAgentRunEvents(agentRunId) {
      const rows = await db.select().from(agentRunEvents).where(eq(agentRunEvents.agentRunId, agentRunId)).orderBy(asc(agentRunEvents.seq));
      return rows.map(agentRunEventFromRow);
    },

    async listArtifactsForRun(agentRunId) {
      const rows = await db
        .select({ artifact: artifacts, file: fileAssets })
        .from(artifacts)
        .innerJoin(fileAssets, eq(artifacts.fileAssetId, fileAssets.id))
        .where(eq(artifacts.agentRunId, agentRunId))
        .orderBy(asc(artifacts.createdAt));
      return rows.map(({ artifact, file }) => artifactFromRows(artifact, file));
    },

    async listMessages(conversationId) {
      const rows = await db
        .select({ id: messages.id, role: messages.role, content: messages.content, metadata: messages.metadata })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.createdAt));
      return rows;
    }
  };
}

function fallbackAgent(
  agentId: string,
  error: Pick<LegacyMastraChatResult["agent"], "error" | "error_code" | "error_detail">
): LegacyMastraChatResult["agent"] {
  return {
    id: agentId,
    role: "default_main_execution_agent",
    runtime: "mastra-acp-agent",
    execution_status: error.error ? "failed" : "used",
    conversation_ids: [],
    trace: [],
    fallback_used: false,
    ...error
  };
}

function artifactContractFromRecord(record: ServerArtifactRecord, context: { taskId: string; runId: string }): ArtifactContract {
  return {
    id: record.id,
    taskId: context.taskId,
    runId: context.runId,
    name: record.filename,
    type: record.type,
    path: stringValue(record.metadata.workspace_path) ?? record.object_path,
    mimeType: record.content_type,
    sizeBytes: Number(record.size_bytes),
    sha256: record.sha256 || undefined,
    metadata: record.metadata,
    href: `/api/operator/artifacts/${record.id}/download`,
    downloadHref: `/api/operator/artifacts/${record.id}/download?download=1`,
    createdAt: record.created_at
  };
}

function traceFromEvent(event: ServerAgentRunEventRecord): TraceEvent[] {
  const payload = event.payload;
  const timestamp = timestampString(payload.timestamp) ?? event.created_at;
  if (event.kind === EventType.RUN_STARTED) {
    return [{ kind: "action", label: "运行开始", timestamp }];
  }
  if (event.kind === EventType.ACTIVITY_SNAPSHOT && payload.activityType === OPERATOR_PROGRESS_ACTIVITY_TYPE) {
    const content = isRecord(payload.content) ? payload.content : {};
    return [
      {
        kind: "action",
        label: stringValue(content.label) ?? "Agent 正在执行",
        detail: stringValue(content.detail),
        timestamp
      }
    ];
  }
  if (event.kind === EventType.RUN_FINISHED) {
    return [{ kind: "observation", label: "运行完成", timestamp }];
  }
  if (event.kind === EventType.RUN_ERROR) {
    return [
      {
        kind: "error",
        label: stringValue(payload.message) ?? "运行失败",
        detail: stringValue(payload.code),
        timestamp
      }
    ];
  }
  if (event.kind === EventType.CUSTOM && payload.name === "operator.agent_trace") {
    const value = isRecord(payload.value) ? payload.value : undefined;
    const kind = value?.kind === "observation" || value?.kind === "error" ? value.kind : "action";
    return [
      {
        kind,
        label: stringValue(value?.label) ?? stringValue(value?.tool) ?? "Agent 事件",
        detail: stringValue(value?.detail),
        tool: stringValue(value?.tool),
        timestamp: timestampString(value?.timestamp) ?? timestamp
      }
    ];
  }
  if (event.kind === EventType.STEP_STARTED || event.kind === EventType.STEP_FINISHED) {
    return [
      {
        kind: event.kind === "STEP_STARTED" ? "action" : "observation",
        label: stringValue(payload.stepName) ?? event.kind,
        timestamp
      }
    ];
  }
  return [];
}

function agUiEventFromRecord(
  event: ServerAgentRunEventRecord,
  fallback: { threadId: string; runId: string; startedAt?: string }
): OperatorAgUiEvent[] {
  const payload = event.payload;
  const type = stringValue(payload.type) ?? event.kind;
  const threadId = stringValue(payload.threadId) ?? fallback.threadId;
  const runId = stringValue(payload.runId) ?? fallback.runId;
  const timestamp = timestampMs(payload.timestamp) ?? timestampMs(event.created_at) ?? Date.now();

  if (isOperatorAgUiEvent(payload)) return [payload];

  switch (type) {
    case EventType.RUN_STARTED:
      return [runStarted(threadId, runId, timestamp)];
    case EventType.ACTIVITY_SNAPSHOT: {
      const candidate = { ...payload, timestamp };
      return isOperatorAgUiEvent(candidate) ? [candidate] : [];
    }
    case EventType.STEP_STARTED:
    case EventType.STEP_FINISHED: {
      const stepName = stringValue(payload.stepName);
      return stepName ? [{ type, timestamp, stepName }] : [];
    }
    case EventType.CUSTOM: {
      const name = stringValue(payload.name);
      if (!name) return [];
      return [customEvent(name, payload.value, timestamp)];
    }
    case EventType.RUN_FINISHED:
      return [
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId,
          timestamp,
          outcome: { type: "success" },
          result: payload.result
        }
      ];
    case EventType.RUN_ERROR:
      return [
        runError(stringValue(payload.message) ?? stringValue(payload.error) ?? "Operator task failed", stringValue(payload.code), timestamp)
      ];
    default:
      return [];
  }
}

function productEventFromRecord(event: ServerAgentRunEventRecord, fallback: { taskId: string; runId: string }): ProductEvent[] {
  const kind = productEventKindFromRecord(event);
  if (!kind) return [];
  return [
    createProductEvent({
      source: "/operator/web",
      taskId: fallback.taskId,
      runId: fallback.runId,
      seq: event.seq,
      kind,
      timestamp: event.created_at,
      payload: event.payload
    })
  ];
}

function productEventKindFromRecord(event: ServerAgentRunEventRecord): ProductEvent["kind"] | undefined {
  if (event.kind === EventType.RUN_STARTED) return "run.started";
  if (event.kind === EventType.RUN_FINISHED) return "run.succeeded";
  if (event.kind === EventType.RUN_ERROR) return "run.failed";
  if (event.kind === EventType.ACTIVITY_SNAPSHOT) return "run.progress";
  if (event.kind === EventType.CUSTOM && event.payload.name === "operator.artifact_registration_error")
    return "artifact.finalization_failed";
  if (event.kind === EventType.CUSTOM) return "runtime.trace";
  return undefined;
}

function eventToPayload(event: OperatorAgUiEvent): Record<string, unknown> {
  return JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
}

function messagesToChatMessages(
  runMessages: Array<{ id: string; role: OperatorChatMessage["role"] | "tool"; content: string; metadata?: Record<string, unknown> }>
): OperatorChatMessage[] {
  return runMessages
    .filter((message): message is OperatorChatMessage => isChatRole(message.role))
    .map((message) => ({
      id: messageIdFromRow(message),
      role: message.role,
      content: message.content
    }));
}

function messagesToContracts(
  taskId: string,
  conversationId: string,
  runMessages: OperatorChatMessage[],
  runId?: string
): MessageContract[] {
  return runMessages.map((message) => ({
    id: message.id,
    conversationId,
    taskId,
    runId: message.role === "assistant" ? runId : undefined,
    role: message.role,
    content: message.content,
    createdAt: new Date(0).toISOString(),
    metadata: {}
  }));
}

function agentRunFromRow(row: typeof agentRuns.$inferSelect): ServerAgentRunRecord {
  return {
    id: row.id,
    project_id: row.projectId,
    conversation_id: row.conversationId ?? null,
    workflow_run_id: row.workflowRunId ?? null,
    agent_id: row.agentId,
    agent_version: row.agentVersion,
    status: row.status,
    input: row.input,
    output: row.output,
    error: row.error,
    workspace: row.workspacePath ?? null,
    created_by: row.createdBy ?? null,
    started_at: row.startedAt?.toISOString() ?? null,
    finished_at: row.finishedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

function agentRunEventFromRow(row: typeof agentRunEvents.$inferSelect): ServerAgentRunEventRecord {
  return {
    id: row.id,
    agent_run_id: row.agentRunId,
    seq: row.seq,
    kind: row.kind,
    payload: row.payload,
    created_at: row.createdAt.toISOString()
  };
}

function artifactFromRows(artifact: typeof artifacts.$inferSelect, file: typeof fileAssets.$inferSelect): ServerArtifactRecord {
  return {
    id: artifact.id,
    project_id: artifact.projectId,
    agent_run_id: artifact.agentRunId ?? null,
    job_id: artifact.jobId ?? null,
    type: artifact.type,
    bucket_id: file.bucket,
    object_path: file.objectKey,
    filename: file.filename,
    content_type: file.contentType,
    sha256: file.sha256,
    size_bytes: file.sizeBytes,
    metadata: artifact.metadata,
    created_by: artifact.createdBy ?? null,
    created_at: artifact.createdAt.toISOString()
  };
}

function isChatRole(role: OperatorChatMessage["role"] | "tool"): role is OperatorChatMessage["role"] {
  return role === "user" || role === "assistant" || role === "system";
}

function messageIdFromRow(row: { id: string; metadata?: Record<string, unknown> }): string {
  // Client-provided message ids can repeat when a task is retried or restored.
  // The persisted row id is the canonical conversation-level id exposed to assistant-ui.
  return row.id;
}

function legacyMastraChatResultValue(value: unknown): LegacyMastraChatResult | undefined {
  if (!isRecord(value) || typeof value.run_id !== "string" || typeof value.status !== "string") return undefined;
  return value as unknown as LegacyMastraChatResult;
}

function normalizeRunError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      code: "OPERATOR_CHAT_ROUTE_ERROR"
    };
  }
  return {
    message: String(error),
    code: "OPERATOR_CHAT_ROUTE_ERROR"
  };
}

type AgentRunInsert = typeof agentRuns.$inferInsert;

function runStatusValue(status: string): AgentRunInsert["status"] {
  if (isRunStatus(status)) {
    return status as AgentRunInsert["status"];
  }
  return "failed";
}

function contractRunStatus(status: string): RunStatus {
  return isRunStatus(status) ? status : "failed";
}

function isSafeTaskId(taskId: string | null | undefined): taskId is string {
  return Boolean(taskId && !taskId.includes("/") && !taskId.includes("\\"));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timestampString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
