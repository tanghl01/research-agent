ALTER TABLE "agent_runs" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_created_by_idx" ON "agent_runs" USING btree ("created_by","created_at");