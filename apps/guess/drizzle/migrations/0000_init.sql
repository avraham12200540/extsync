CREATE TYPE "public"."daily_challenge_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."eligibility_override" AS ENUM('none', 'force_eligible', 'force_ineligible');--> statement-breakpoint
CREATE TYPE "public"."forum_account_status" AS ENUM('unknown', 'active', 'deleted', 'banned');--> statement-breakpoint
CREATE TYPE "public"."game_mode" AS ENUM('daily', 'freeplay');--> statement-breakpoint
CREATE TYPE "public"."game_round_status" AS ENUM('active', 'resolved_correct', 'resolved_incorrect', 'expired');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('in_progress', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."import_run_status" AS ENUM('running', 'success', 'partial_failure', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_trigger_kind" AS ENUM('admin', 'cron');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('pending', 'approved', 'rejected', 'needs_review');--> statement-breakpoint
CREATE TABLE "admin_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"session_token_hash" text NOT NULL,
	"csrf_token_hash" text NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_admin_user_failed_login_count_nonneg" CHECK ("admin_user"."failed_login_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "import_run_status" DEFAULT 'running' NOT NULL,
	"trigger_kind" "import_trigger_kind" NOT NULL,
	"triggered_by_admin_id" uuid,
	"source_endpoint" text NOT NULL,
	"cursor_used" text,
	"posts_fetched" integer DEFAULT 0 NOT NULL,
	"posts_new" integer DEFAULT 0 NOT NULL,
	"posts_updated" integer DEFAULT 0 NOT NULL,
	"users_touched" integer DEFAULT 0 NOT NULL,
	"rate_limit_events" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "chk_import_run_trigger_consistency" CHECK (("import_run"."trigger_kind" = 'admin' AND "import_run"."triggered_by_admin_id" IS NOT NULL)
          OR ("import_run"."trigger_kind" = 'cron' AND "import_run"."triggered_by_admin_id" IS NULL)),
	CONSTRAINT "chk_import_run_counts_nonneg" CHECK ("import_run"."posts_fetched" >= 0
          AND "import_run"."posts_new" >= 0
          AND "import_run"."posts_updated" >= 0
          AND "import_run"."users_touched" >= 0
          AND "import_run"."rate_limit_events" >= 0)
);
--> statement-breakpoint
CREATE TABLE "forum_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"forum_pid" text NOT NULL,
	"forum_tid" text NOT NULL,
	"forum_user_id" uuid NOT NULL,
	"forum_category_cid" text NOT NULL,
	"raw_content" text NOT NULL,
	"clean_content" text,
	"sha256_raw" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"import_run_id" uuid NOT NULL,
	"moderation_status" "moderation_status" DEFAULT 'pending' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"content_length" integer DEFAULT 0 NOT NULL,
	"quote_ratio" real DEFAULT 0 NOT NULL,
	"generic_response_score" real DEFAULT 0 NOT NULL,
	"quality_score" real DEFAULT 0 NOT NULL,
	"potential_leak_score" real DEFAULT 0 NOT NULL,
	"links_count" integer DEFAULT 0 NOT NULL,
	"mentions_count" integer DEFAULT 0 NOT NULL,
	"moderation_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_diverged" boolean DEFAULT false NOT NULL,
	"source_diverged_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_forum_post_word_count_nonneg" CHECK ("forum_post"."word_count" >= 0),
	CONSTRAINT "chk_forum_post_content_length_nonneg" CHECK ("forum_post"."content_length" >= 0),
	CONSTRAINT "chk_forum_post_quote_ratio_range" CHECK ("forum_post"."quote_ratio" >= 0 AND "forum_post"."quote_ratio" <= 1),
	CONSTRAINT "chk_forum_post_generic_response_score_range" CHECK ("forum_post"."generic_response_score" >= 0 AND "forum_post"."generic_response_score" <= 1),
	CONSTRAINT "chk_forum_post_quality_score_range" CHECK ("forum_post"."quality_score" >= 0 AND "forum_post"."quality_score" <= 1),
	CONSTRAINT "chk_forum_post_potential_leak_score_range" CHECK ("forum_post"."potential_leak_score" >= 0 AND "forum_post"."potential_leak_score" <= 1),
	CONSTRAINT "chk_forum_post_links_count_nonneg" CHECK ("forum_post"."links_count" >= 0),
	CONSTRAINT "chk_forum_post_mentions_count_nonneg" CHECK ("forum_post"."mentions_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "forum_post_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"forum_post_id" uuid NOT NULL,
	"previous_clean_content" text,
	"edited_by_admin_id" uuid,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"forum_uid" text NOT NULL,
	"forum_username" text NOT NULL,
	"forum_userslug" text NOT NULL,
	"account_status" "forum_account_status" DEFAULT 'unknown' NOT NULL,
	"is_system_or_bot" boolean DEFAULT false NOT NULL,
	"admin_override" "eligibility_override" DEFAULT 'none' NOT NULL,
	"computed_eligible" boolean DEFAULT false NOT NULL,
	"eligibility_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"eligible_as_of" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum_user_stats" (
	"forum_user_id" uuid PRIMARY KEY NOT NULL,
	"approved_post_count" integer DEFAULT 0 NOT NULL,
	"total_post_count" integer DEFAULT 0 NOT NULL,
	"avg_word_count" integer DEFAULT 0 NOT NULL,
	"avg_quality_score" real DEFAULT 0 NOT NULL,
	"top_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"username_length" integer DEFAULT 0 NOT NULL,
	"first_active_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_forum_user_stats_counts_nonneg" CHECK ("forum_user_stats"."approved_post_count" >= 0
          AND "forum_user_stats"."total_post_count" >= 0
          AND "forum_user_stats"."avg_word_count" >= 0
          AND "forum_user_stats"."username_length" >= 0),
	CONSTRAINT "chk_forum_user_stats_approved_le_total" CHECK ("forum_user_stats"."approved_post_count" <= "forum_user_stats"."total_post_count"),
	CONSTRAINT "chk_forum_user_stats_avg_quality_score_range" CHECK ("forum_user_stats"."avg_quality_score" >= 0 AND "forum_user_stats"."avg_quality_score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "player_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_token_hash" text NOT NULL,
	"csrf_token_hash" text NOT NULL,
	"rotated_from_id" uuid,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"status" "daily_challenge_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_challenge_round" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"daily_challenge_id" uuid NOT NULL,
	"order_in_game" integer NOT NULL,
	"target_forum_user_id" uuid NOT NULL,
	"post_ids" jsonb NOT NULL,
	"choice_user_ids" jsonb NOT NULL,
	CONSTRAINT "chk_daily_challenge_round_order_range" CHECK ("daily_challenge_round"."order_in_game" >= 1 AND "daily_challenge_round"."order_in_game" <= 5),
	CONSTRAINT "chk_daily_challenge_round_post_ids_count" CHECK (jsonb_array_length("daily_challenge_round"."post_ids") = 5),
	CONSTRAINT "chk_daily_challenge_round_choice_user_ids_count" CHECK (jsonb_array_length("daily_challenge_round"."choice_user_ids") = 4)
);
--> statement-breakpoint
CREATE TABLE "game" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_session_id" uuid NOT NULL,
	"mode" "game_mode" NOT NULL,
	"daily_challenge_id" uuid,
	"total_rounds" integer NOT NULL,
	"current_round_index" integer DEFAULT 0 NOT NULL,
	"total_score" integer DEFAULT 0 NOT NULL,
	"status" "game_status" DEFAULT 'in_progress' NOT NULL,
	"round_plan" jsonb NOT NULL,
	"share_token" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chk_game_mode_matches_total_rounds" CHECK (("game"."mode" = 'daily' AND "game"."total_rounds" = 5)
          OR ("game"."mode" = 'freeplay' AND "game"."total_rounds" = 10)),
	CONSTRAINT "chk_game_mode_matches_daily_challenge" CHECK (("game"."mode" = 'daily' AND "game"."daily_challenge_id" IS NOT NULL)
          OR ("game"."mode" = 'freeplay' AND "game"."daily_challenge_id" IS NULL)),
	CONSTRAINT "chk_game_current_round_index_range" CHECK ("game"."current_round_index" >= 0 AND "game"."current_round_index" <= "game"."total_rounds"),
	CONSTRAINT "chk_game_total_score_nonneg" CHECK ("game"."total_score" >= 0),
	CONSTRAINT "chk_game_round_plan_length_matches_total_rounds" CHECK (jsonb_array_length("game"."round_plan") = "game"."total_rounds")
);
--> statement-breakpoint
CREATE TABLE "game_round" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"order_in_game" integer NOT NULL,
	"target_forum_user_id" uuid NOT NULL,
	"status" "game_round_status" DEFAULT 'active' NOT NULL,
	"hints_revealed_count" integer DEFAULT 0 NOT NULL,
	"wrong_guess_count" integer DEFAULT 0 NOT NULL,
	"score_awarded" integer DEFAULT 0 NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chk_game_round_order_range" CHECK ("game_round"."order_in_game" >= 1 AND "game_round"."order_in_game" <= 10),
	CONSTRAINT "chk_game_round_hints_range" CHECK ("game_round"."hints_revealed_count" >= 0 AND "game_round"."hints_revealed_count" <= 5),
	CONSTRAINT "chk_game_round_wrong_guess_nonneg" CHECK ("game_round"."wrong_guess_count" >= 0),
	CONSTRAINT "chk_game_round_score_range" CHECK ("game_round"."score_awarded" >= 0 AND "game_round"."score_awarded" <= 100)
);
--> statement-breakpoint
CREATE TABLE "guess" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_round_id" uuid NOT NULL,
	"choice_id" uuid NOT NULL,
	"player_session_id" uuid NOT NULL,
	"is_correct" boolean NOT NULL,
	"attempt_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_guess_attempt_number_positive" CHECK ("guess"."attempt_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "round_choice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_round_id" uuid NOT NULL,
	"choice_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"forum_user_id" uuid NOT NULL,
	"display_position" integer NOT NULL,
	CONSTRAINT "chk_round_choice_position_range" CHECK ("round_choice"."display_position" >= 1 AND "round_choice"."display_position" <= 4)
);
--> statement-breakpoint
CREATE TABLE "round_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_round_id" uuid NOT NULL,
	"forum_post_id" uuid NOT NULL,
	"display_order" integer NOT NULL,
	"revealed" boolean DEFAULT false NOT NULL,
	"revealed_at" timestamp with time zone,
	CONSTRAINT "chk_round_post_display_order_range" CHECK ("round_post"."display_order" >= 1 AND "round_post"."display_order" <= 5)
);
--> statement-breakpoint
CREATE TABLE "rate_limit_bucket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip_hash" text NOT NULL,
	"endpoint" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "chk_rate_limit_bucket_count_nonneg" CHECK ("rate_limit_bucket"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_admin_user_id_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_triggered_by_admin_id_admin_user_id_fk" FOREIGN KEY ("triggered_by_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post" ADD CONSTRAINT "forum_post_forum_user_id_forum_user_id_fk" FOREIGN KEY ("forum_user_id") REFERENCES "public"."forum_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post" ADD CONSTRAINT "forum_post_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post_revision" ADD CONSTRAINT "forum_post_revision_forum_post_id_forum_post_id_fk" FOREIGN KEY ("forum_post_id") REFERENCES "public"."forum_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post_revision" ADD CONSTRAINT "forum_post_revision_edited_by_admin_id_admin_user_id_fk" FOREIGN KEY ("edited_by_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_user_stats" ADD CONSTRAINT "forum_user_stats_forum_user_id_forum_user_id_fk" FOREIGN KEY ("forum_user_id") REFERENCES "public"."forum_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_session" ADD CONSTRAINT "player_session_rotated_from_id_player_session_id_fk" FOREIGN KEY ("rotated_from_id") REFERENCES "public"."player_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_challenge_round" ADD CONSTRAINT "daily_challenge_round_daily_challenge_id_daily_challenge_id_fk" FOREIGN KEY ("daily_challenge_id") REFERENCES "public"."daily_challenge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_challenge_round" ADD CONSTRAINT "daily_challenge_round_target_forum_user_id_forum_user_id_fk" FOREIGN KEY ("target_forum_user_id") REFERENCES "public"."forum_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_player_session_id_player_session_id_fk" FOREIGN KEY ("player_session_id") REFERENCES "public"."player_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_daily_challenge_id_daily_challenge_id_fk" FOREIGN KEY ("daily_challenge_id") REFERENCES "public"."daily_challenge"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_round" ADD CONSTRAINT "game_round_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_round" ADD CONSTRAINT "game_round_target_forum_user_id_forum_user_id_fk" FOREIGN KEY ("target_forum_user_id") REFERENCES "public"."forum_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guess" ADD CONSTRAINT "guess_player_session_id_player_session_id_fk" FOREIGN KEY ("player_session_id") REFERENCES "public"."player_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guess" ADD CONSTRAINT "fk_guess_round_choice" FOREIGN KEY ("game_round_id","choice_id") REFERENCES "public"."round_choice"("game_round_id","choice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guess" ADD CONSTRAINT "fk_guess_game_round" FOREIGN KEY ("game_round_id") REFERENCES "public"."game_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_choice" ADD CONSTRAINT "round_choice_game_round_id_game_round_id_fk" FOREIGN KEY ("game_round_id") REFERENCES "public"."game_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_choice" ADD CONSTRAINT "round_choice_forum_user_id_forum_user_id_fk" FOREIGN KEY ("forum_user_id") REFERENCES "public"."forum_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_post" ADD CONSTRAINT "round_post_game_round_id_game_round_id_fk" FOREIGN KEY ("game_round_id") REFERENCES "public"."game_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_post" ADD CONSTRAINT "round_post_forum_post_id_forum_post_id_fk" FOREIGN KEY ("forum_post_id") REFERENCES "public"."forum_post"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_admin_session_token_hash" ON "admin_session" USING btree ("session_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_admin_user_email" ON "admin_user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_forum_post_forum_pid" ON "forum_post" USING btree ("forum_pid");--> statement-breakpoint
CREATE INDEX "ix_forum_post_user_moderation" ON "forum_post" USING btree ("forum_user_id","moderation_status");--> statement-breakpoint
CREATE INDEX "ix_forum_post_moderation_status" ON "forum_post" USING btree ("moderation_status");--> statement-breakpoint
CREATE INDEX "ix_forum_post_sha256_raw" ON "forum_post" USING btree ("sha256_raw");--> statement-breakpoint
CREATE INDEX "ix_forum_post_revision_post" ON "forum_post_revision" USING btree ("forum_post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_forum_user_forum_uid" ON "forum_user" USING btree ("forum_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_forum_user_forum_userslug" ON "forum_user" USING btree ("forum_userslug");--> statement-breakpoint
CREATE INDEX "ix_forum_user_computed_eligible" ON "forum_user" USING btree ("computed_eligible");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_player_session_token_hash" ON "player_session" USING btree ("session_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_daily_challenge_date" ON "daily_challenge" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_daily_challenge_round_order" ON "daily_challenge_round" USING btree ("daily_challenge_id","order_in_game");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_game_share_token" ON "game" USING btree ("share_token");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_game_one_daily_per_session" ON "game" USING btree ("daily_challenge_id","player_session_id") WHERE "game"."daily_challenge_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_game_round_order" ON "game_round" USING btree ("game_id","order_in_game");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_guess_round_session_choice" ON "guess" USING btree ("game_round_id","player_session_id","choice_id");--> statement-breakpoint
CREATE INDEX "ix_guess_round_id" ON "guess" USING btree ("game_round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_round_choice_choice_id" ON "round_choice" USING btree ("choice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_round_choice_round_and_choice" ON "round_choice" USING btree ("game_round_id","choice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_round_choice_user" ON "round_choice" USING btree ("game_round_id","forum_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_round_choice_position" ON "round_choice" USING btree ("game_round_id","display_position");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_round_post_order" ON "round_post" USING btree ("game_round_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_round_post_unique_post" ON "round_post" USING btree ("game_round_id","forum_post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_rate_limit_bucket_window" ON "rate_limit_bucket" USING btree ("ip_hash","endpoint","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_idempotency_key_endpoint" ON "idempotency_key" USING btree ("key","endpoint");