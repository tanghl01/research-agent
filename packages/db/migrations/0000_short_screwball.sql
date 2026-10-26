CREATE TYPE "public"."actor_type" AS ENUM('user', 'service_account', 'system');--> statement-breakpoint
CREATE TYPE "public"."artifact_visibility" AS ENUM('private', 'organization', 'project');--> statement-breakpoint
CREATE TYPE "public"."capability_kind" AS ENUM('skill', 'workflow', 'tool', 'workspace', 'agent');--> statement-breakpoint
CREATE TYPE "public"."capability_source" AS ENUM('github', 'local', 'self_hosted', 'marketplace');--> statement-breakpoint
CREATE TYPE "public"."drive_owner_type" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'invited', 'removed');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "public"."organization_kind" AS ENUM('personal', 'team', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('active', 'archived', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'paused', 'waiting', 'skipped', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."workflow_step_type" AS ENUM('llm', 'tool', 'mastra_agent', 'validation', 'human_review');--> statement-breakpoint
CREATE TYPE "public"."workspace_kind" AS ENUM('general', 'research', 'ppt', 'legal', 'teacher', 'finance', 'maker');--> statement-breakpoint
CREATE TABLE "agent_run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_events_run_seq_unique" UNIQUE("agent_run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"conversation_id" uuid,
	"workflow_run_id" uuid,
	"workflow_step_id" uuid,
	"agent_id" text NOT NULL,
	"agent_version" text DEFAULT '0.1.0' NOT NULL,
	"runtime_provider" text DEFAULT 'mastra' NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"workspace_path" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_drive_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"drive_object_id" uuid NOT NULL,
	"link_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_drive_links_unique" UNIQUE("artifact_id","drive_object_id","link_type")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"workflow_run_id" uuid,
	"workflow_step_id" uuid,
	"file_asset_id" uuid NOT NULL,
	"job_id" text,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"project_id" uuid,
	"actor_user_id" uuid,
	"actor_type" "actor_type" DEFAULT 'user' NOT NULL,
	"kind" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"project_id" uuid,
	"run_id" uuid,
	"kind" text NOT NULL,
	"quantity" numeric NOT NULL,
	"unit" text NOT NULL,
	"unit_price" numeric DEFAULT '0' NOT NULL,
	"raw_cost" numeric DEFAULT '0' NOT NULL,
	"platform_fee" numeric DEFAULT '0' NOT NULL,
	"final_amount" numeric DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" "capability_kind" NOT NULL,
	"source" "capability_source" DEFAULT 'local' NOT NULL,
	"source_url" text,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capabilities_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"client_task_id" text,
	"title" text NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drive_space_id" uuid NOT NULL,
	"parent_id" uuid,
	"file_asset_id" uuid NOT NULL,
	"name" text NOT NULL,
	"visibility" "artifact_visibility" DEFAULT 'private' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "drive_spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "drive_owner_type" NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"quota_bytes" bigint NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_provider" text NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "file_assets_object_unique" UNIQUE("storage_provider","bucket","object_key")
);
--> statement-breakpoint
CREATE TABLE "message_artifact_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_artifact_links_unique" UNIQUE("message_id","artifact_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_org_user_unique" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "organization_kind" NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"project_type" text DEFAULT 'operator-web' NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"email" text,
	"phone" text,
	"raw_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identities_provider_subject_unique" UNIQUE("provider","provider_subject")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_hash" text NOT NULL,
	"user_agent" text,
	"ip_address" "inet",
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"primary_email" text,
	"primary_phone" text,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" text NOT NULL,
	"name" text NOT NULL,
	"workspace_kind" "workspace_kind",
	"definition" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_definitions_key_version_unique" UNIQUE("key","version")
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"conversation_id" uuid,
	"workflow_definition_id" uuid,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"step_type" "workflow_step_type" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "workspace_capabilities_unique" UNIQUE("workspace_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" "workspace_kind" DEFAULT 'general' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_org_key_unique" UNIQUE("org_id","key")
);
--> statement-breakpoint
ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workflow_step_id_workflow_steps_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_drive_links" ADD CONSTRAINT "artifact_drive_links_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_drive_links" ADD CONSTRAINT "artifact_drive_links_drive_object_id_drive_objects_id_fk" FOREIGN KEY ("drive_object_id") REFERENCES "public"."drive_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workflow_step_id_workflow_steps_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_file_asset_id_file_assets_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_objects" ADD CONSTRAINT "drive_objects_drive_space_id_drive_spaces_id_fk" FOREIGN KEY ("drive_space_id") REFERENCES "public"."drive_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_objects" ADD CONSTRAINT "drive_objects_parent_id_drive_objects_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."drive_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_objects" ADD CONSTRAINT "drive_objects_file_asset_id_file_assets_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_objects" ADD CONSTRAINT "drive_objects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_spaces" ADD CONSTRAINT "drive_spaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_spaces" ADD CONSTRAINT "drive_spaces_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_artifact_links" ADD CONSTRAINT "message_artifact_links_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_artifact_links" ADD CONSTRAINT "message_artifact_links_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_capabilities" ADD CONSTRAINT "workspace_capabilities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_capabilities" ADD CONSTRAINT "workspace_capabilities_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_run_events_run_idx" ON "agent_run_events" USING btree ("agent_run_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_project_idx" ON "agent_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_conversation_idx" ON "agent_runs" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "artifacts_project_idx" ON "artifacts" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "artifacts_agent_run_idx" ON "artifacts" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_idx" ON "audit_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_project_idx" ON "audit_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_events_org_idx" ON "billing_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_events_project_idx" ON "billing_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "conversations_project_idx" ON "conversations" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_project_client_task_id_idx" ON "conversations" USING btree ("project_id","client_task_id") WHERE "conversations"."client_task_id" is not null;--> statement-breakpoint
CREATE INDEX "drive_objects_space_idx" ON "drive_objects" USING btree ("drive_space_id","created_at");--> statement-breakpoint
CREATE INDEX "drive_spaces_user_owner_idx" ON "drive_spaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "drive_spaces_org_owner_idx" ON "drive_spaces" USING btree ("owner_org_id");--> statement-breakpoint
CREATE INDEX "file_assets_sha_idx" ON "file_assets" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "organization_memberships_org_idx" ON "organization_memberships" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "organization_memberships_user_idx" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organizations_created_by_idx" ON "organizations" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_personal_created_by_unique" ON "organizations" USING btree ("created_by") WHERE "organizations"."kind" = 'personal';--> statement-breakpoint
CREATE INDEX "project_events_project_idx" ON "project_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_org_idx" ON "projects" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE INDEX "projects_workspace_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_hash_idx" ON "user_sessions" USING btree ("session_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_project_idx" ON "workflow_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_steps_run_idx" ON "workflow_steps" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "workspaces_org_idx" ON "workspaces" USING btree ("org_id");