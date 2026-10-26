CREATE TYPE "public"."knowledge_archive_member_status" AS ENUM('parsed', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."knowledge_record_status" AS ENUM('active', 'paused', 'archived', 'deleted', 'stale');--> statement-breakpoint
CREATE TYPE "public"."knowledge_visibility" AS ENUM('public', 'organization', 'private');--> statement-breakpoint
CREATE TABLE "knowledge_archive_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_version_id" uuid NOT NULL,
	"item_version_id" uuid,
	"file_asset_id" uuid,
	"member_path" text NOT NULL,
	"member_sha256" text,
	"size_bytes" bigint,
	"content_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"parse_status" "knowledge_archive_member_status" DEFAULT 'skipped' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_archive_members_parent_path_unique" UNIQUE("parent_version_id","member_path")
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"heading" text,
	"text" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "knowledge_chunks_version_ordinal_unique" UNIQUE("item_version_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "knowledge_ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"run_type" text DEFAULT 'manual' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"ingestion_run_id" uuid,
	"file_asset_id" uuid,
	"raw_sha256" text NOT NULL,
	"normalized_sha256" text,
	"extracted_text" text,
	"normalized_text" text,
	"parser_version" text DEFAULT 'operator-knowledge/0.1.0' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "knowledge_item_versions_item_raw_unique" UNIQUE("item_id","raw_sha256")
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"source_id" uuid,
	"canonical_url" text NOT NULL,
	"title" text NOT NULL,
	"resource_kind" text DEFAULT 'document' NOT NULL,
	"category" text,
	"visibility" "knowledge_visibility" DEFAULT 'public' NOT NULL,
	"published_at" timestamp with time zone,
	"status" "knowledge_record_status" DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_items_space_url_unique" UNIQUE("space_id","canonical_url")
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"type" text DEFAULT 'page' NOT NULL,
	"base_url" text NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"crawler_adapter" text DEFAULT 'crawlee' NOT NULL,
	"schedule" text,
	"schedule_timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"crawler_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "knowledge_record_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"domain_type" text DEFAULT 'general' NOT NULL,
	"visibility" "knowledge_visibility" DEFAULT 'public' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "knowledge_record_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_spaces_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "knowledge_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"template_kind" text NOT NULL,
	"fields_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"instructions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "knowledge_record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_templates_item_kind_unique" UNIQUE("item_id","template_kind")
);
--> statement-breakpoint
ALTER TABLE "knowledge_archive_members" ADD CONSTRAINT "knowledge_archive_members_parent_version_id_knowledge_item_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."knowledge_item_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_archive_members" ADD CONSTRAINT "knowledge_archive_members_item_version_id_knowledge_item_versions_id_fk" FOREIGN KEY ("item_version_id") REFERENCES "public"."knowledge_item_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_archive_members" ADD CONSTRAINT "knowledge_archive_members_file_asset_id_file_assets_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_item_version_id_knowledge_item_versions_id_fk" FOREIGN KEY ("item_version_id") REFERENCES "public"."knowledge_item_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_ingestion_runs" ADD CONSTRAINT "knowledge_ingestion_runs_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_ingestion_runs" ADD CONSTRAINT "knowledge_ingestion_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ADD CONSTRAINT "knowledge_item_versions_item_id_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ADD CONSTRAINT "knowledge_item_versions_ingestion_run_id_knowledge_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."knowledge_ingestion_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ADD CONSTRAINT "knowledge_item_versions_file_asset_id_file_assets_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_space_id_knowledge_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."knowledge_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_space_id_knowledge_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."knowledge_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_spaces" ADD CONSTRAINT "knowledge_spaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_templates" ADD CONSTRAINT "knowledge_templates_item_id_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_archive_members_sha_idx" ON "knowledge_archive_members" USING btree ("member_sha256");--> statement-breakpoint
CREATE INDEX "knowledge_archive_members_parent_idx" ON "knowledge_archive_members" USING btree ("parent_version_id");--> statement-breakpoint
CREATE INDEX "knowledge_ingestion_runs_source_idx" ON "knowledge_ingestion_runs" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_ingestion_runs_status_idx" ON "knowledge_ingestion_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_item_versions_item_fetched_idx" ON "knowledge_item_versions" USING btree ("item_id","fetched_at");--> statement-breakpoint
CREATE INDEX "knowledge_item_versions_raw_sha_idx" ON "knowledge_item_versions" USING btree ("raw_sha256");--> statement-breakpoint
CREATE INDEX "knowledge_items_space_kind_idx" ON "knowledge_items" USING btree ("space_id","resource_kind","status");--> statement-breakpoint
CREATE INDEX "knowledge_items_published_idx" ON "knowledge_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "knowledge_sources_space_idx" ON "knowledge_sources" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_sources_base_url_idx" ON "knowledge_sources" USING btree ("base_url");--> statement-breakpoint
CREATE INDEX "knowledge_spaces_status_idx" ON "knowledge_spaces" USING btree ("status");--> statement-breakpoint
CREATE INDEX "knowledge_templates_status_idx" ON "knowledge_templates" USING btree ("status");