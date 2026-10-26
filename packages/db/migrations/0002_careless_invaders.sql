CREATE TYPE "public"."credit_account_owner_type" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TYPE "public"."credit_account_status" AS ENUM('active', 'frozen', 'closed');--> statement-breakpoint
CREATE TYPE "public"."platform_role_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "credit_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "credit_account_owner_type" NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"currency" text DEFAULT 'points' NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"status" "credit_account_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid,
	"org_id" uuid,
	"delta" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"reason" text NOT NULL,
	"related_agent_run_id" uuid,
	"related_billing_event_id" uuid,
	"created_by" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" "platform_role_status" DEFAULT 'active' NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_user_roles_user_role_unique" UNIQUE("user_id","role")
);
--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_account_id_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_related_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("related_agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_related_billing_event_id_billing_events_id_fk" FOREIGN KEY ("related_billing_event_id") REFERENCES "public"."billing_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_user_roles" ADD CONSTRAINT "platform_user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_user_roles" ADD CONSTRAINT "platform_user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_accounts_user_owner_idx" ON "credit_accounts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "credit_accounts_org_owner_idx" ON "credit_accounts" USING btree ("owner_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_accounts_user_currency_unique" ON "credit_accounts" USING btree ("owner_user_id","currency") WHERE "credit_accounts"."owner_type" = 'user' and "credit_accounts"."owner_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_accounts_org_currency_unique" ON "credit_accounts" USING btree ("owner_org_id","currency") WHERE "credit_accounts"."owner_type" = 'organization' and "credit_accounts"."owner_org_id" is not null;--> statement-breakpoint
CREATE INDEX "credit_ledger_account_idx" ON "credit_ledger" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_user_idx" ON "credit_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_org_idx" ON "credit_ledger" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_user_roles_user_idx" ON "platform_user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_user_roles_role_status_idx" ON "platform_user_roles" USING btree ("role","status");