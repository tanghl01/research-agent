ALTER TYPE "public"."capability_kind" RENAME TO "product_scope_kind";--> statement-breakpoint
ALTER TYPE "public"."capability_source" RENAME TO "product_scope_source";--> statement-breakpoint
ALTER TABLE "capabilities" RENAME TO "product_scopes";--> statement-breakpoint
ALTER TABLE "workspace_capabilities" RENAME TO "workspace_product_scopes";--> statement-breakpoint
ALTER TABLE "workspace_product_scopes" RENAME COLUMN "capability_id" TO "product_scope_id";--> statement-breakpoint
ALTER TABLE "product_scopes" DROP CONSTRAINT "capabilities_key_unique";--> statement-breakpoint
ALTER TABLE "workspace_product_scopes" DROP CONSTRAINT "workspace_capabilities_unique";--> statement-breakpoint
ALTER TABLE "workspace_product_scopes" DROP CONSTRAINT "workspace_capabilities_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace_product_scopes" DROP CONSTRAINT "workspace_capabilities_capability_id_capabilities_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace_product_scopes" ADD CONSTRAINT "workspace_product_scopes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_product_scopes" ADD CONSTRAINT "workspace_product_scopes_product_scope_id_product_scopes_id_fk" FOREIGN KEY ("product_scope_id") REFERENCES "public"."product_scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_scopes" ADD CONSTRAINT "product_scopes_key_unique" UNIQUE("key");--> statement-breakpoint
ALTER TABLE "workspace_product_scopes" ADD CONSTRAINT "workspace_product_scopes_unique" UNIQUE("workspace_id","product_scope_id");