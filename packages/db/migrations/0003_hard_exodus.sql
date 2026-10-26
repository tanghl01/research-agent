CREATE TABLE "phone_login_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"purpose" text DEFAULT 'login' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "phone_login_challenges_phone_created_idx" ON "phone_login_challenges" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "phone_login_challenges_expires_idx" ON "phone_login_challenges" USING btree ("expires_at");