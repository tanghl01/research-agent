import { describe, expect, test } from "vitest";
import type {
  BootstrapDriveSpace,
  BootstrapMembership,
  BootstrapOrganization,
  BootstrapProfile,
  OperatorBootstrapResult
} from "./bootstrap";
import {
  ensureConversation,
  ensureDefaultProject,
  filterAppendableMessages,
  mergeChatMessages,
  type ServerConversationRecord,
  type ServerConversationStore,
  type ServerMessageRecord,
  type ServerProjectRecord
} from "./conversations";
import type { OperatorSessionUser } from "./session";

const userId = "00000000-0000-4000-8000-000000000001";
const orgId = "00000000-0000-4000-8000-000000000010";
const projectId = "00000000-0000-4000-8000-000000000020";
const conversationId = "00000000-0000-4000-8000-000000000030";

describe("Operator server conversation persistence", () => {
  test("creates the default project when the user does not have one", async () => {
    const created: Array<{ orgId: string; userId: string }> = [];
    const store = createFakeStore({
      findDefaultProject: async () => null,
      createDefaultProject: async (params) => {
        created.push(params);
        return projectRecord({ id: projectId, org_id: params.orgId, created_by: params.userId });
      }
    });

    const project = await ensureDefaultProject(createContext(store));

    expect(project.id).toBe(projectId);
    expect(created).toEqual([{ orgId, userId }]);
  });

  test("reuses a conversation by client task id and updates placeholder titles", async () => {
    const existing = conversationRecord({ title: "新任务", client_task_id: "task_local_1" });
    const updates: Array<{ conversationId: string; title?: string }> = [];
    const store = createFakeStore({
      findConversation: async (params) => {
        expect(params).toMatchObject({
          projectIds: [projectId],
          clientTaskId: "task_local_1"
        });
        return existing;
      },
      updateConversation: async (params) => {
        updates.push(params);
        return { ...existing, title: params.title ?? existing.title };
      }
    });

    const conversation = await ensureConversation(createContext(store), {
      project: projectRecord(),
      taskId: "task_local_1",
      title: "Analyze RNA-seq differential expression"
    });

    expect(conversation.id).toBe(conversationId);
    expect(conversation.title).toBe("Analyze RNA-seq differential expression");
    expect(updates).toEqual([
      {
        conversationId,
        title: "Analyze RNA-seq differential expression"
      }
    ]);
  });

  test("creates a conversation with the client task id when none exists", async () => {
    let created: { projectId: string; userId: string; title: string; clientTaskId?: string } | undefined;
    const store = createFakeStore({
      findConversation: async () => null,
      createConversation: async (params) => {
        created = params;
        return conversationRecord({
          project_id: params.projectId,
          created_by: params.userId,
          title: params.title,
          client_task_id: params.clientTaskId ?? null
        });
      }
    });

    await ensureConversation(createContext(store), {
      project: projectRecord(),
      taskId: "task_local_2",
      title: "Draft a project plan"
    });

    expect(created).toEqual({
      projectId,
      userId,
      title: "Draft a project plan",
      clientTaskId: "task_local_2"
    });
  });

  test("merges database history with the current request without duplicating the tail", () => {
    expect(
      mergeChatMessages(
        [
          { id: "existing-user", role: "user", content: "hello" },
          { id: "existing-assistant", role: "assistant", content: "hi" }
        ],
        [
          { id: "current-assistant", role: "assistant", content: "hi" },
          { id: "current-user", role: "user", content: "next" }
        ]
      )
    ).toEqual([
      { id: "existing-user", role: "user", content: "hello" },
      { id: "existing-assistant", role: "assistant", content: "hi" },
      { id: "current-user", role: "user", content: "next" }
    ]);
  });

  test("filters only immediately duplicated messages before inserting", () => {
    const existing: Array<Pick<ServerMessageRecord, "role" | "content">> = [
      { role: "user", content: "same" },
      { role: "assistant", content: "done" }
    ];

    expect(
      filterAppendableMessages(existing, [
        { id: "current-assistant", role: "assistant", content: "done" },
        { id: "current-user", role: "user", content: "same" }
      ])
    ).toEqual([{ id: "current-user", role: "user", content: "same" }]);
  });
});

function createContext(store: ServerConversationStore) {
  const user: OperatorSessionUser = {
    id: userId,
    email: "ada@example.com",
    phone: null,
    displayName: "Ada",
    avatarUrl: null,
    isGuest: false
  };
  return {
    user,
    bootstrap: bootstrapResult(),
    store
  };
}

function createFakeStore(overrides: Partial<ServerConversationStore> = {}): ServerConversationStore {
  return {
    async listUserOrganizationIds() {
      return [orgId];
    },
    async findDefaultProject() {
      return projectRecord();
    },
    async createDefaultProject(params) {
      return projectRecord({ org_id: params.orgId, created_by: params.userId });
    },
    async listProjectsForOrganizations() {
      return [projectRecord()];
    },
    async listConversations() {
      return [conversationRecord()];
    },
    async findConversation() {
      return conversationRecord();
    },
    async createConversation(params) {
      return conversationRecord({
        project_id: params.projectId,
        created_by: params.userId,
        title: params.title,
        client_task_id: params.clientTaskId ?? null
      });
    },
    async updateConversation(params) {
      return conversationRecord({ id: params.conversationId, title: params.title ?? "新任务" });
    },
    async listMessages() {
      return [];
    },
    async insertMessages() {
      return [];
    },
    ...overrides
  };
}

function bootstrapResult(): OperatorBootstrapResult {
  const profile: BootstrapProfile = {
    id: userId,
    display_name: "Ada",
    email: "ada@example.com",
    phone: null,
    avatar_url: null,
    status: "active"
  };
  const organization: BootstrapOrganization = {
    id: orgId,
    name: "Ada personal",
    kind: "personal",
    plan: "free",
    status: "active",
    created_by: userId
  };
  const membership: BootstrapMembership = {
    id: "membership_1",
    org_id: orgId,
    user_id: userId,
    role: "owner"
  };
  const drive: BootstrapDriveSpace = {
    id: "drive_1",
    owner_type: "user",
    owner_user_id: userId,
    owner_org_id: null,
    quota_bytes: 1,
    used_bytes: 0,
    plan: "free"
  };
  return { profile, organization, membership, drive };
}

function projectRecord(overrides: Partial<ServerProjectRecord> = {}): ServerProjectRecord {
  return {
    id: projectId,
    org_id: orgId,
    name: "Default",
    workspace_type: "operator-web",
    status: "active",
    created_by: userId,
    created_at: "2026-06-16T00:00:00.000Z",
    updated_at: "2026-06-16T00:00:00.000Z",
    ...overrides
  };
}

function conversationRecord(overrides: Partial<ServerConversationRecord> = {}): ServerConversationRecord {
  return {
    id: conversationId,
    project_id: projectId,
    client_task_id: "task_local_1",
    title: "新任务",
    status: "active",
    created_by: userId,
    created_at: "2026-06-16T00:00:00.000Z",
    updated_at: "2026-06-16T00:00:00.000Z",
    ...overrides
  };
}
