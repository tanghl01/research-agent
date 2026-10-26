import {
  bigint,
  boolean,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userStatus = pgEnum("user_status", ["active", "disabled", "deleted"]);
export const organizationKind = pgEnum("organization_kind", ["personal", "team", "enterprise"]);
export const organizationStatus = pgEnum("organization_status", ["active", "suspended", "deleted"]);
export const membershipRole = pgEnum("membership_role", ["owner", "admin", "member", "viewer"]);
export const membershipStatus = pgEnum("membership_status", ["active", "invited", "removed"]);
export const workspaceKind = pgEnum("workspace_kind", ["general", "research", "ppt", "legal", "teacher", "finance", "maker"]);
export const recordStatus = pgEnum("record_status", ["active", "archived", "deleted"]);
export const messageRole = pgEnum("message_role", ["user", "assistant", "system", "tool"]);
export const runStatus = pgEnum("run_status", ["queued", "running", "paused", "waiting", "skipped", "succeeded", "failed", "cancelled"]);
export const workflowStepType = pgEnum("workflow_step_type", ["llm", "tool", "mastra_agent", "validation", "human_review"]);
export const productScopeKind = pgEnum("product_scope_kind", ["skill", "workflow", "tool", "workspace", "agent"]);
export const productScopeSource = pgEnum("product_scope_source", ["github", "local", "self_hosted", "marketplace"]);
export const artifactVisibility = pgEnum("artifact_visibility", ["private", "organization", "project"]);
export const driveOwnerType = pgEnum("drive_owner_type", ["user", "organization"]);
export const actorType = pgEnum("actor_type", ["user", "service_account", "system"]);
export const platformRoleStatus = pgEnum("platform_role_status", ["active", "revoked"]);
export const creditAccountOwnerType = pgEnum("credit_account_owner_type", ["user", "organization"]);
export const creditAccountStatus = pgEnum("credit_account_status", ["active", "frozen", "closed"]);
export const knowledgeVisibility = pgEnum("knowledge_visibility", ["public", "organization", "private"]);
export const knowledgeRecordStatus = pgEnum("knowledge_record_status", ["active", "paused", "archived", "deleted", "stale"]);
export const knowledgeArchiveMemberStatus = pgEnum("knowledge_archive_member_status", ["parsed", "skipped", "failed"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: userStatus("status").notNull().default("active"),
  primaryEmail: text("primary_email"),
  primaryPhone: text("primary_phone"),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  ...timestamps
});

export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    email: text("email"),
    phone: text("phone"),
    rawProfile: jsonb("raw_profile").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps
  },
  (table) => ({
    providerSubjectUnique: unique("user_identities_provider_subject_unique").on(table.provider, table.providerSubject),
    userIdx: index("user_identities_user_idx").on(table.userId)
  })
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionHash: text("session_hash").notNull(),
    userAgent: text("user_agent"),
    ipAddress: inet("ip_address"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    sessionHashUnique: unique("user_sessions_hash_unique").on(table.sessionHash),
    sessionHashIdx: index("user_sessions_hash_idx").on(table.sessionHash),
    userIdx: index("user_sessions_user_idx").on(table.userId)
  })
);

export const phoneLoginChallenges = pgTable(
  "phone_login_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: text("purpose").notNull().default("login"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    phoneCreatedIdx: index("phone_login_challenges_phone_created_idx").on(table.phone, table.createdAt),
    expiresIdx: index("phone_login_challenges_expires_idx").on(table.expiresAt)
  })
);

export const platformUserRoles = pgTable(
  "platform_user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: platformRoleStatus("status").notNull().default("active"),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => ({
    userRoleUnique: unique("platform_user_roles_user_role_unique").on(table.userId, table.role),
    userIdx: index("platform_user_roles_user_idx").on(table.userId),
    roleStatusIdx: index("platform_user_roles_role_status_idx").on(table.role, table.status)
  })
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: organizationKind("kind").notNull(),
    plan: text("plan").notNull().default("free"),
    status: organizationStatus("status").notNull().default("active"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps
  },
  (table) => ({
    createdByIdx: index("organizations_created_by_idx").on(table.createdBy),
    personalUnique: uniqueIndex("organizations_personal_created_by_unique").on(table.createdBy).where(sql`${table.kind} = 'personal'`)
  })
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    status: membershipStatus("status").notNull().default("active"),
    ...timestamps
  },
  (table) => ({
    memberUnique: unique("organization_memberships_org_user_unique").on(table.orgId, table.userId),
    orgIdx: index("organization_memberships_org_idx").on(table.orgId),
    userIdx: index("organization_memberships_user_idx").on(table.userId)
  })
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    kind: workspaceKind("kind").notNull().default("general"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    status: recordStatus("status").notNull().default("active"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps
  },
  (table) => ({
    orgKeyUnique: unique("workspaces_org_key_unique").on(table.orgId, table.key),
    orgIdx: index("workspaces_org_idx").on(table.orgId)
  })
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    projectType: text("project_type").notNull().default("operator-web"),
    status: recordStatus("status").notNull().default("active"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps
  },
  (table) => ({
    orgIdx: index("projects_org_idx").on(table.orgId, table.updatedAt),
    workspaceIdx: index("projects_workspace_idx").on(table.workspaceId)
  })
);

export const projectEvents = pgTable(
  "project_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    projectIdx: index("project_events_project_idx").on(table.projectId, table.createdAt)
  })
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clientTaskId: text("client_task_id"),
    title: text("title").notNull(),
    status: recordStatus("status").notNull().default("active"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps
  },
  (table) => ({
    projectIdx: index("conversations_project_idx").on(table.projectId, table.updatedAt),
    projectClientTaskUnique: uniqueIndex("conversations_project_client_task_id_idx")
      .on(table.projectId, table.clientTaskId)
      .where(sql`${table.clientTaskId} is not null`)
  })
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    conversationIdx: index("messages_conversation_idx").on(table.conversationId, table.createdAt)
  })
);

export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    version: text("version").notNull(),
    name: text("name").notNull(),
    workspaceKind: workspaceKind("workspace_kind"),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => ({
    keyVersionUnique: unique("workflow_definitions_key_version_unique").on(table.key, table.version)
  })
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    workflowDefinitionId: uuid("workflow_definition_id").references(() => workflowDefinitions.id, { onDelete: "set null" }),
    status: runStatus("status").notNull().default("queued"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
    error: jsonb("error").$type<Record<string, unknown> | null>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => ({
    projectIdx: index("workflow_runs_project_idx").on(table.projectId, table.createdAt)
  })
);

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowRunId: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    stepType: workflowStepType("step_type").notNull(),
    status: runStatus("status").notNull().default("queued"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
    error: jsonb("error").$type<Record<string, unknown> | null>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => ({
    runIdx: index("workflow_steps_run_idx").on(table.workflowRunId)
  })
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id, { onDelete: "set null" }),
    workflowStepId: uuid("workflow_step_id").references(() => workflowSteps.id, { onDelete: "set null" }),
    agentId: text("agent_id").notNull(),
    agentVersion: text("agent_version").notNull().default("0.1.0"),
    runtimeProvider: text("runtime_provider").notNull().default("mastra"),
    status: runStatus("status").notNull().default("queued"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
    error: jsonb("error").$type<Record<string, unknown> | null>(),
    workspacePath: text("workspace_path"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => ({
    projectIdx: index("agent_runs_project_idx").on(table.projectId, table.createdAt),
    conversationIdx: index("agent_runs_conversation_idx").on(table.conversationId, table.createdAt),
    createdByIdx: index("agent_runs_created_by_idx").on(table.createdBy, table.createdAt)
  })
);

export const agentRunEvents = pgTable(
  "agent_run_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    runSeqUnique: unique("agent_run_events_run_seq_unique").on(table.agentRunId, table.seq),
    runIdx: index("agent_run_events_run_idx").on(table.agentRunId, table.createdAt)
  })
);

export const productScopes = pgTable("product_scopes", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  kind: productScopeKind("kind").notNull(),
  source: productScopeSource("source").notNull().default("local"),
  sourceUrl: text("source_url"),
  manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("active"),
  ...timestamps
});

export const workspaceProductScopes = pgTable(
  "workspace_product_scopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productScopeId: uuid("product_scope_id")
      .notNull()
      .references(() => productScopes.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({})
  },
  (table) => ({
    workspaceProductScopeUnique: unique("workspace_product_scopes_unique").on(table.workspaceId, table.productScopeId)
  })
);

export const fileAssets = pgTable(
  "file_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storageProvider: text("storage_provider").notNull(),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (table) => ({
    objectUnique: unique("file_assets_object_unique").on(table.storageProvider, table.bucket, table.objectKey),
    shaIdx: index("file_assets_sha_idx").on(table.sha256)
  })
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id, { onDelete: "set null" }),
    workflowStepId: uuid("workflow_step_id").references(() => workflowSteps.id, { onDelete: "set null" }),
    fileAssetId: uuid("file_asset_id")
      .notNull()
      .references(() => fileAssets.id),
    jobId: text("job_id"),
    type: text("type").notNull(),
    name: text("name").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    projectIdx: index("artifacts_project_idx").on(table.projectId, table.createdAt),
    runIdx: index("artifacts_agent_run_idx").on(table.agentRunId)
  })
);

export const knowledgeSpaces = pgTable(
  "knowledge_spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    domainType: text("domain_type").notNull().default("general"),
    visibility: knowledgeVisibility("visibility").notNull().default("public"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    status: knowledgeRecordStatus("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => ({
    keyUnique: unique("knowledge_spaces_key_unique").on(table.key),
    statusIdx: index("knowledge_spaces_status_idx").on(table.status)
  })
);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => knowledgeSpaces.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("page"),
    baseUrl: text("base_url").notNull(),
    rules: jsonb("rules").$type<Record<string, unknown>>().notNull().default({}),
    crawlerAdapter: text("crawler_adapter").notNull().default("crawlee"),
    schedule: text("schedule"),
    scheduleTimezone: text("schedule_timezone").notNull().default("Asia/Shanghai"),
    crawlerConfig: jsonb("crawler_config").$type<Record<string, unknown>>().notNull().default({}),
    status: knowledgeRecordStatus("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => ({
    spaceIdx: index("knowledge_sources_space_idx").on(table.spaceId, table.status),
    baseUrlIdx: index("knowledge_sources_base_url_idx").on(table.baseUrl)
  })
);

export const knowledgeIngestionRuns = pgTable(
  "knowledge_ingestion_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    runType: text("run_type").notNull().default("manual"),
    trigger: text("trigger").notNull().default("manual"),
    status: runStatus("status").notNull().default("queued"),
    stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
    error: jsonb("error").$type<Record<string, unknown> | null>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => ({
    sourceIdx: index("knowledge_ingestion_runs_source_idx").on(table.sourceId, table.createdAt),
    statusIdx: index("knowledge_ingestion_runs_status_idx").on(table.status, table.createdAt)
  })
);

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => knowledgeSpaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => knowledgeSources.id, { onDelete: "set null" }),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    resourceKind: text("resource_kind").notNull().default("document"),
    category: text("category"),
    visibility: knowledgeVisibility("visibility").notNull().default("public"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    status: knowledgeRecordStatus("status").notNull().default("active"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps
  },
  (table) => ({
    spaceUrlUnique: unique("knowledge_items_space_url_unique").on(table.spaceId, table.canonicalUrl),
    spaceKindIdx: index("knowledge_items_space_kind_idx").on(table.spaceId, table.resourceKind, table.status),
    publishedIdx: index("knowledge_items_published_idx").on(table.publishedAt)
  })
);

export const knowledgeItemVersions = pgTable(
  "knowledge_item_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => knowledgeItems.id, { onDelete: "cascade" }),
    ingestionRunId: uuid("ingestion_run_id").references(() => knowledgeIngestionRuns.id, { onDelete: "set null" }),
    fileAssetId: uuid("file_asset_id").references(() => fileAssets.id),
    rawSha256: text("raw_sha256").notNull(),
    normalizedSha256: text("normalized_sha256"),
    extractedText: text("extracted_text"),
    normalizedText: text("normalized_text"),
    parserVersion: text("parser_version").notNull().default("operator-knowledge/0.1.0"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({})
  },
  (table) => ({
    itemRawUnique: unique("knowledge_item_versions_item_raw_unique").on(table.itemId, table.rawSha256),
    itemFetchedIdx: index("knowledge_item_versions_item_fetched_idx").on(table.itemId, table.fetchedAt),
    rawShaIdx: index("knowledge_item_versions_raw_sha_idx").on(table.rawSha256)
  })
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemVersionId: uuid("item_version_id")
      .notNull()
      .references(() => knowledgeItemVersions.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    heading: text("heading"),
    text: text("text").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({})
  },
  (table) => ({
    versionOrdinalUnique: unique("knowledge_chunks_version_ordinal_unique").on(table.itemVersionId, table.ordinal)
  })
);

export const knowledgeTemplates = pgTable(
  "knowledge_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => knowledgeItems.id, { onDelete: "cascade" }),
    templateKind: text("template_kind").notNull(),
    fieldsSchema: jsonb("fields_schema").$type<Record<string, unknown>>().notNull().default({}),
    instructions: jsonb("instructions").$type<Record<string, unknown>>().notNull().default({}),
    status: knowledgeRecordStatus("status").notNull().default("active"),
    ...timestamps
  },
  (table) => ({
    itemKindUnique: unique("knowledge_templates_item_kind_unique").on(table.itemId, table.templateKind),
    statusIdx: index("knowledge_templates_status_idx").on(table.status)
  })
);

export const knowledgeArchiveMembers = pgTable(
  "knowledge_archive_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentVersionId: uuid("parent_version_id")
      .notNull()
      .references(() => knowledgeItemVersions.id, { onDelete: "cascade" }),
    itemVersionId: uuid("item_version_id").references(() => knowledgeItemVersions.id, { onDelete: "set null" }),
    fileAssetId: uuid("file_asset_id").references(() => fileAssets.id),
    memberPath: text("member_path").notNull(),
    memberSha256: text("member_sha256"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    parseStatus: knowledgeArchiveMemberStatus("parse_status").notNull().default("skipped"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    parentPathUnique: unique("knowledge_archive_members_parent_path_unique").on(table.parentVersionId, table.memberPath),
    memberShaIdx: index("knowledge_archive_members_sha_idx").on(table.memberSha256),
    parentIdx: index("knowledge_archive_members_parent_idx").on(table.parentVersionId)
  })
);

export const messageArtifactLinks = pgTable(
  "message_artifact_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    linkUnique: unique("message_artifact_links_unique").on(table.messageId, table.artifactId)
  })
);

export const driveSpaces = pgTable(
  "drive_spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerType: driveOwnerType("owner_type").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    ownerOrgId: uuid("owner_org_id").references(() => organizations.id, { onDelete: "cascade" }),
    quotaBytes: bigint("quota_bytes", { mode: "number" }).notNull(),
    usedBytes: bigint("used_bytes", { mode: "number" }).notNull().default(0),
    plan: text("plan").notNull().default("free"),
    ...timestamps
  },
  (table) => ({
    userOwnerIdx: index("drive_spaces_user_owner_idx").on(table.ownerUserId),
    orgOwnerIdx: index("drive_spaces_org_owner_idx").on(table.ownerOrgId),
    userOwnerUnique: uniqueIndex("drive_spaces_owner_user_unique")
      .on(table.ownerUserId)
      .where(sql`${table.ownerType} = 'user' and ${table.ownerUserId} is not null`),
    orgOwnerUnique: uniqueIndex("drive_spaces_owner_org_unique")
      .on(table.ownerOrgId)
      .where(sql`${table.ownerType} = 'organization' and ${table.ownerOrgId} is not null`)
  })
);

export const driveObjects = pgTable(
  "drive_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driveSpaceId: uuid("drive_space_id")
      .notNull()
      .references(() => driveSpaces.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => driveObjects.id, { onDelete: "cascade" }),
    fileAssetId: uuid("file_asset_id")
      .notNull()
      .references(() => fileAssets.id),
    name: text("name").notNull(),
    visibility: artifactVisibility("visibility").notNull().default("private"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (table) => ({
    spaceIdx: index("drive_objects_space_idx").on(table.driveSpaceId, table.createdAt)
  })
);

export const artifactDriveLinks = pgTable(
  "artifact_drive_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    driveObjectId: uuid("drive_object_id")
      .notNull()
      .references(() => driveObjects.id, { onDelete: "cascade" }),
    linkType: text("link_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    linkUnique: unique("artifact_drive_links_unique").on(table.artifactId, table.driveObjectId, table.linkType)
  })
);

export const creditAccounts = pgTable(
  "credit_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerType: creditAccountOwnerType("owner_type").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    ownerOrgId: uuid("owner_org_id").references(() => organizations.id, { onDelete: "cascade" }),
    currency: text("currency").notNull().default("points"),
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    status: creditAccountStatus("status").notNull().default("active"),
    ...timestamps
  },
  (table) => ({
    userOwnerIdx: index("credit_accounts_user_owner_idx").on(table.ownerUserId),
    orgOwnerIdx: index("credit_accounts_org_owner_idx").on(table.ownerOrgId),
    userCurrencyUnique: uniqueIndex("credit_accounts_user_currency_unique")
      .on(table.ownerUserId, table.currency)
      .where(sql`${table.ownerType} = 'user' and ${table.ownerUserId} is not null`),
    orgCurrencyUnique: uniqueIndex("credit_accounts_org_currency_unique")
      .on(table.ownerOrgId, table.currency)
      .where(sql`${table.ownerType} = 'organization' and ${table.ownerOrgId} is not null`)
  })
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorType: actorType("actor_type").notNull().default("user"),
    kind: text("kind").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    orgIdx: index("audit_events_org_idx").on(table.orgId, table.createdAt),
    projectIdx: index("audit_events_project_idx").on(table.projectId, table.createdAt)
  })
);

export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    quantity: numeric("quantity").notNull(),
    unit: text("unit").notNull(),
    unitPrice: numeric("unit_price").notNull().default("0"),
    rawCost: numeric("raw_cost").notNull().default("0"),
    platformFee: numeric("platform_fee").notNull().default("0"),
    finalAmount: numeric("final_amount").notNull().default("0"),
    currency: text("currency").notNull().default("CNY"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    orgIdx: index("billing_events_org_idx").on(table.orgId, table.createdAt),
    projectIdx: index("billing_events_project_idx").on(table.projectId)
  })
);

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => creditAccounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
    delta: bigint("delta", { mode: "number" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    relatedAgentRunId: uuid("related_agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    relatedBillingEventId: uuid("related_billing_event_id").references(() => billingEvents.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    accountIdx: index("credit_ledger_account_idx").on(table.accountId, table.createdAt),
    userIdx: index("credit_ledger_user_idx").on(table.userId, table.createdAt),
    orgIdx: index("credit_ledger_org_idx").on(table.orgId, table.createdAt)
  })
);
