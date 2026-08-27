CREATE TABLE "admin_audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_admin_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"request_correlation_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forum_post" ADD COLUMN "moderation_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit_event" ADD CONSTRAINT "admin_audit_event_actor_admin_id_admin_user_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_admin_audit_event_actor" ON "admin_audit_event" USING btree ("actor_admin_id");--> statement-breakpoint
CREATE INDEX "ix_admin_audit_event_action" ON "admin_audit_event" USING btree ("action");--> statement-breakpoint
CREATE INDEX "ix_admin_audit_event_target" ON "admin_audit_event" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "ix_admin_audit_event_created_at" ON "admin_audit_event" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "forum_post" ADD CONSTRAINT "chk_forum_post_moderation_version_nonneg" CHECK ("forum_post"."moderation_version" >= 0);