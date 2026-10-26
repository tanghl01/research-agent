import { conversations, getDatabase, messages, organizationMemberships, projects } from "@operator/db";
import { createOperatorMessageId, type OperatorConversationMessage as OperatorChatMessage } from "@operator/contracts";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import type { OperatorTask } from "@/lib/tasks";
import { bootstrapOperatorUser, type OperatorBootstrapResult } from "./bootstrap";
import { getOperatorBackendRuntimeStatus } from "./config";
import { getOperatorSessionUser, getOrCreateOperatorSessionUser, type OperatorSessionUser } from "./session";

const DEFAULT_PROJECT_NAME = "默认项目";
const WORKSPACE_TYPE = "operator-web";

export type ServerTask = OperatorTask & {
  source: "server";
  projectId: string;
  conversationId: string;
};

export type ServerProjectRecord = {
  id: string;
  org_id: string;
  name: string;
  workspace_type: string;
  status: "active" | "archived";
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ServerConversationRecord = {
  id: string;
  project_id: string;
  client_task_id: string | null;
  title: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ServerMessageRecord = {
  id: string;
  conversation_id: string;
  role: OperatorChatMessage["role"] | "tool";
  content: string;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

export type ServerMessageInsert = {
  conversation_id: string;
  role: OperatorChatMessage["role"];
  content: string;
  metadata: Record<string, unknown>;
  created_by: string | null;
};

export type ServerConversationStore = {
  listUserOrganizationIds(userId: string): Promise<string[]>;
  findDefaultProject(params: { orgId: string; userId: string }): Promise<ServerProjectRecord | null>;
  createDefaultProject(params: { orgId: string; userId: string }): Promise<ServerProjectRecord>;
  listProjectsForOrganizations(orgIds: string[]): Promise<ServerProjectRecord[]>;
  listConversations(projectIds: string[]): Promise<ServerConversationRecord[]>;
  findConversation(params: {
    projectIds: string[];
    conversationId?: string;
    clientTaskId?: string;
  }): Promise<ServerConversationRecord | null>;
  createConversation(params: {
    projectId: string;
    userId: string;
    title: string;
    clientTaskId?: string;
  }): Promise<ServerConversationRecord>;
  updateConversation(params: { conversationId: string; title?: string }): Promise<ServerConversationRecord>;
  listMessages(conversationId: string): Promise<ServerMessageRecord[]>;
  insertMessages(rows: ServerMessageInsert[]): Promise<ServerMessageRecord[]>;
};

export type ServerConversationContext = {
  user: OperatorSessionUser;
  bootstrap: OperatorBootstrapResult;
  store: ServerConversationStore;
  setCookie?: string | null;
};

export type ServerChatPersistence = {
  userId: string;
  project: ServerProjectRecord;
  conversation: ServerConversationRecord;
  messagesForRun: OperatorChatMessage[];
  setCookie?: string | null;
  appendAssistantMessage(content: string, metadata?: Record<string, unknown>): Promise<void>;
};

export type ServerConversationSession = {
  userId: string;
  project: ServerProjectRecord;
  conversation: ServerConversationRecord;
  setCookie?: string | null;
  persistMessages(params: { currentMessages: OperatorChatMessage[]; metadata?: Record<string, unknown> }): Promise<ServerChatPersistence>;
};

export type ServerTaskEventScope = {
  userId: string;
  projectId: string;
  conversationId: string;
  taskId: string;
};

export type ResolvedServerSession = {
  user: OperatorSessionUser;
  setCookie?: string | null;
};

export class ServerConversationError extends Error {
  code?: string;

  constructor(message: string, options?: { code?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "ServerConversationError";
    this.code = options?.code;
  }
}

export async function listServerConversationTasks(): Promise<ServerTask[] | null> {
  const context = await getServerConversationContext();
  if (!context) return null;

  const orgIds = await context.store.listUserOrganizationIds(context.user.id);
  if (!orgIds.length) return [];
  const projects = await context.store.listProjectsForOrganizations(orgIds);
  const projectIds = projects.map((project) => project.id);
  const rows = await context.store.listConversations(projectIds);
  return rows.map((conversation) => toServerTask(conversation));
}

export async function loadServerTaskMessages(taskId: string | null | undefined): Promise<OperatorChatMessage[] | null> {
  if (!isSafeTaskId(taskId)) return null;

  const context = await getServerConversationContext();
  if (!context) return null;

  const conversation = await findAccessibleConversation(context, taskId);
  if (!conversation) return [];
  const rows = await context.store.listMessages(conversation.id);
  return messagesToChatMessages(rows);
}

export async function createServerChatPersistence(params: {
  request?: Request;
  session?: ResolvedServerSession;
  taskId?: string;
  title?: string;
  currentMessages: OperatorChatMessage[];
  metadata?: Record<string, unknown>;
}): Promise<ServerChatPersistence | null> {
  const session = await createServerConversationSession({
    request: params.request,
    session: params.session,
    taskId: params.taskId,
    title: params.title ?? titleFromMessages(params.currentMessages) ?? "新任务"
  });
  if (!session) return null;
  return session.persistMessages({
    currentMessages: params.currentMessages,
    metadata: params.metadata
  });
}

export async function createServerConversationSession(params: {
  request?: Request;
  session?: ResolvedServerSession;
  taskId?: string;
  title?: string;
}): Promise<ServerConversationSession | null> {
  const context = await getServerConversationContext({ request: params.request, session: params.session, allowGuest: true });
  if (!context) return null;

  const project = await ensureDefaultProject(context);
  const conversation = await ensureConversation(context, {
    project,
    taskId: params.taskId,
    title: params.title ?? "新任务"
  });
  return createConversationSessionHandle(context, project, conversation);
}

function createConversationSessionHandle(
  context: ServerConversationContext,
  project: ServerProjectRecord,
  conversation: ServerConversationRecord
): ServerConversationSession {
  return {
    userId: context.user.id,
    project,
    conversation,
    setCookie: context.setCookie,
    async persistMessages({ currentMessages, metadata }) {
      return persistServerConversationMessages({
        context,
        project,
        conversation,
        setCookie: context.setCookie,
        currentMessages,
        metadata
      });
    }
  };
}

async function persistServerConversationMessages(params: {
  context: ServerConversationContext;
  project: ServerProjectRecord;
  conversation: ServerConversationRecord;
  setCookie?: string | null;
  currentMessages: OperatorChatMessage[];
  metadata?: Record<string, unknown>;
}): Promise<ServerChatPersistence> {
  const existingRows = await params.context.store.listMessages(params.conversation.id);
  const existingMessages = messagesToChatMessages(existingRows);
  const messagesForRun = mergeChatMessages(existingMessages, params.currentMessages);
  const userRows = filterAppendableMessages(existingRows, params.currentMessages).map((message) =>
    toMessageInsert(params.conversation.id, params.context.user.id, message, params.metadata)
  );
  if (userRows.length) await params.context.store.insertMessages(userRows);

  return {
    userId: params.context.user.id,
    project: params.project,
    conversation: params.conversation,
    messagesForRun,
    setCookie: params.setCookie,
    async appendAssistantMessage(content, metadata) {
      const normalized = content.trim();
      if (!normalized) return;
      const rows = await params.context.store.listMessages(params.conversation.id);
      const [message] = filterAppendableMessages(rows, [
        { id: createOperatorMessageId("assistant"), role: "assistant", content: normalized }
      ]);
      if (!message) return;
      await params.context.store.insertMessages([toMessageInsert(params.conversation.id, null, message, metadata)]);
    }
  };
}

export async function getServerConversationContext(
  options: { request?: Request; session?: ResolvedServerSession; allowGuest?: boolean } = {}
): Promise<ServerConversationContext | null> {
  const status = getOperatorBackendRuntimeStatus();
  if (!status.enabled || !status.serviceConfigured) return null;

  const session = options.session
    ? ({ enabled: true, authenticated: true, user: options.session.user, error: null, setCookie: options.session.setCookie } as const)
    : options.allowGuest
      ? await getOrCreateOperatorSessionUser(options.request)
      : await getOperatorSessionUser(options.request);
  if (!session.authenticated) return null;

  const bootstrap = await bootstrapOperatorUser(session.user);
  return {
    user: session.user,
    bootstrap,
    store: createServerConversationStore(),
    setCookie: "setCookie" in session ? session.setCookie : null
  };
}

export async function ensureDefaultProject(context: ServerConversationContext): Promise<ServerProjectRecord> {
  const orgId = context.bootstrap.organization.id;
  const existing = await context.store.findDefaultProject({ orgId, userId: context.user.id });
  if (existing) return existing;
  return context.store.createDefaultProject({ orgId, userId: context.user.id });
}

export async function ensureConversation(
  context: ServerConversationContext,
  params: { project: ServerProjectRecord; taskId?: string; title: string }
): Promise<ServerConversationRecord> {
  const clientTaskId = isSafeTaskId(params.taskId) ? params.taskId : undefined;
  const existing = clientTaskId
    ? await context.store.findConversation({
        projectIds: [params.project.id],
        conversationId: isUuid(clientTaskId) ? clientTaskId : undefined,
        clientTaskId
      })
    : null;

  if (existing) {
    if (shouldUpdateTitle(existing.title, params.title)) {
      return context.store.updateConversation({ conversationId: existing.id, title: params.title });
    }
    return existing;
  }

  try {
    return await context.store.createConversation({
      projectId: params.project.id,
      userId: context.user.id,
      title: params.title,
      clientTaskId
    });
  } catch (error) {
    if (!isUniqueViolation(error) || !clientTaskId) throw error;
    const createdByConcurrentRequest = await context.store.findConversation({
      projectIds: [params.project.id],
      clientTaskId
    });
    if (createdByConcurrentRequest) return createdByConcurrentRequest;
    throw error;
  }
}

export function mergeChatMessages(existingMessages: OperatorChatMessage[], currentMessages: OperatorChatMessage[]): OperatorChatMessage[] {
  const merged = [...existingMessages];
  for (const message of currentMessages) {
    const previous = merged.at(-1);
    if (sameMessage(previous, message)) continue;
    merged.push(message);
  }
  return merged.slice(-12);
}

export function filterAppendableMessages(
  existingRows: Array<Pick<ServerMessageRecord, "role" | "content">>,
  messages: OperatorChatMessage[]
): OperatorChatMessage[] {
  const sequence = existingRows.map((row) => ({ role: row.role, content: row.content }));
  const appendable: OperatorChatMessage[] = [];
  for (const message of messages) {
    const previous = sequence.at(-1);
    if (sameMessage(previous, message)) continue;
    sequence.push(message);
    appendable.push(message);
  }
  return appendable;
}

export function createServerConversationStore(): ServerConversationStore {
  const db = getDatabase();

  return {
    async listUserOrganizationIds(userId) {
      const rows = await db
        .select({ orgId: organizationMemberships.orgId })
        .from(organizationMemberships)
        .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "active")));
      return rows.map((row) => row.orgId);
    },

    async findDefaultProject({ orgId, userId }) {
      const [row] = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.orgId, orgId),
            eq(projects.createdBy, userId),
            eq(projects.projectType, WORKSPACE_TYPE),
            eq(projects.status, "active")
          )
        )
        .orderBy(asc(projects.createdAt))
        .limit(1);
      return row ? projectFromRow(row) : null;
    },

    async createDefaultProject({ orgId, userId }) {
      const [row] = await db
        .insert(projects)
        .values({
          orgId,
          name: DEFAULT_PROJECT_NAME,
          projectType: WORKSPACE_TYPE,
          status: "active",
          createdBy: userId
        })
        .returning();
      if (!row) throw new ServerConversationError("Failed to create default project.");
      return projectFromRow(row);
    },

    async listProjectsForOrganizations(orgIds) {
      if (!orgIds.length) return [];
      const rows = await db
        .select()
        .from(projects)
        .where(and(inArray(projects.orgId, orgIds), eq(projects.status, "active")))
        .orderBy(desc(projects.updatedAt));
      return rows.map(projectFromRow);
    },

    async listConversations(projectIds) {
      if (!projectIds.length) return [];
      const rows = await db
        .select()
        .from(conversations)
        .where(and(inArray(conversations.projectId, projectIds), eq(conversations.status, "active")))
        .orderBy(desc(conversations.updatedAt));
      return rows.map(conversationFromRow);
    },

    async findConversation({ projectIds, conversationId, clientTaskId }) {
      if (!projectIds.length) return null;
      const idFilter =
        conversationId && clientTaskId
          ? or(eq(conversations.id, conversationId), eq(conversations.clientTaskId, clientTaskId))
          : conversationId
            ? eq(conversations.id, conversationId)
            : clientTaskId
              ? eq(conversations.clientTaskId, clientTaskId)
              : undefined;
      if (!idFilter) return null;

      const [row] = await db
        .select()
        .from(conversations)
        .where(and(inArray(conversations.projectId, projectIds), eq(conversations.status, "active"), idFilter))
        .limit(1);
      return row ? conversationFromRow(row) : null;
    },

    async createConversation({ projectId, userId, title, clientTaskId }) {
      const [row] = await db
        .insert(conversations)
        .values({
          projectId,
          clientTaskId: clientTaskId ?? null,
          title,
          status: "active",
          createdBy: userId
        })
        .returning();
      if (!row) throw new ServerConversationError("Failed to create conversation.");
      return conversationFromRow(row);
    },

    async updateConversation({ conversationId, title }) {
      const [row] = await db
        .update(conversations)
        .set({ title, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId))
        .returning();
      if (!row) throw new ServerConversationError("Failed to update conversation.");
      return conversationFromRow(row);
    },

    async listMessages(conversationId) {
      const rows = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));
      return rows.map(messageFromRow);
    },

    async insertMessages(rows) {
      if (!rows.length) return [];
      const inserted = await db
        .insert(messages)
        .values(
          rows.map((row) => ({
            conversationId: row.conversation_id,
            role: row.role,
            content: row.content,
            metadata: row.metadata,
            createdBy: row.created_by
          }))
        )
        .returning();
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, rows[0].conversation_id));
      return inserted.map(messageFromRow);
    }
  };
}

export async function findAccessibleConversation(
  context: ServerConversationContext,
  taskId: string
): Promise<ServerConversationRecord | null> {
  const orgIds = await context.store.listUserOrganizationIds(context.user.id);
  if (!orgIds.length) return null;
  const projects = await context.store.listProjectsForOrganizations(orgIds);
  return context.store.findConversation({
    projectIds: projects.map((project) => project.id),
    conversationId: isUuid(taskId) ? taskId : undefined,
    clientTaskId: taskId
  });
}

export async function resolveServerTaskEventScope(taskId: string | null | undefined): Promise<ServerTaskEventScope | null> {
  if (!isSafeTaskId(taskId)) return null;

  const context = await getServerConversationContext();
  if (!context) return null;

  const conversation = await findAccessibleConversation(context, taskId);
  if (!conversation) return null;

  return {
    userId: context.user.id,
    projectId: conversation.project_id,
    conversationId: conversation.id,
    taskId: conversation.client_task_id ?? conversation.id
  };
}

function toServerTask(conversation: ServerConversationRecord): ServerTask {
  return {
    id: conversation.client_task_id ?? conversation.id,
    title: conversation.title,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
    source: "server",
    projectId: conversation.project_id,
    conversationId: conversation.id
  };
}

function toMessageInsert(
  conversationId: string,
  userId: string | null,
  message: OperatorChatMessage,
  metadata: Record<string, unknown> | undefined
): ServerMessageInsert {
  return {
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    metadata: {
      ...(metadata ?? {}),
      messageId: message.id
    },
    created_by: message.role === "user" ? userId : null
  };
}

function messagesToChatMessages(rows: ServerMessageRecord[]): OperatorChatMessage[] {
  return rows
    .filter((row): row is ServerMessageRecord & { role: OperatorChatMessage["role"] } => isChatRole(row.role))
    .map((row) => ({
      id: messageIdFromRow(row),
      role: row.role,
      content: row.content
    }));
}

function projectFromRow(row: typeof projects.$inferSelect): ServerProjectRecord {
  return {
    id: row.id,
    org_id: row.orgId,
    name: row.name,
    workspace_type: row.projectType,
    status: row.status === "archived" ? "archived" : "active",
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

function conversationFromRow(row: typeof conversations.$inferSelect): ServerConversationRecord {
  return {
    id: row.id,
    project_id: row.projectId,
    client_task_id: row.clientTaskId ?? null,
    title: row.title,
    status: row.status,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

function messageFromRow(row: typeof messages.$inferSelect): ServerMessageRecord {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    role: row.role,
    content: row.content,
    metadata: row.metadata,
    created_by: row.createdBy ?? null,
    created_at: row.createdAt.toISOString()
  };
}

function isChatRole(role: ServerMessageRecord["role"]): role is OperatorChatMessage["role"] {
  return role === "user" || role === "assistant" || role === "system";
}

function titleFromMessages(messages: OperatorChatMessage[]): string | undefined {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim());
  if (!firstUserMessage) return undefined;
  const normalized = firstUserMessage.content.replace(/\s+/gu, " ").trim();
  return normalized.length > 32 ? `${normalized.slice(0, 32)}...` : normalized;
}

function shouldUpdateTitle(existingTitle: string, nextTitle: string): boolean {
  return Boolean(nextTitle && (existingTitle === "新任务" || nextTitle.length > existingTitle.length));
}

function sameMessage(
  left: Pick<ServerMessageRecord, "role" | "content"> | OperatorChatMessage | undefined,
  right: OperatorChatMessage | undefined
): boolean {
  return Boolean(left && right && left.role === right.role && left.content.trim() === right.content.trim());
}

function messageIdFromRow(row: ServerMessageRecord): string {
  // Client-provided message ids can repeat when a task is retried or restored.
  // The persisted row id is the canonical conversation-level id exposed to assistant-ui.
  return row.id;
}

function isSafeTaskId(taskId: string | null | undefined): taskId is string {
  return Boolean(taskId && !taskId.includes("/") && !taskId.includes("\\"));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === "23505";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
