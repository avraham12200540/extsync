import { pgEnum } from "drizzle-orm/pg-core";

// One enum per state machine described in the approved /guess architecture.
// Keeping them here (rather than inline per-table) avoids accidental
// duplicate-with-different-values definitions across files.

export const importRunStatusEnum = pgEnum("import_run_status", [
  "running",
  "success",
  "partial_failure",
  "failed",
]);

export const importTriggerKindEnum = pgEnum("import_trigger_kind", ["admin", "cron"]);

export const moderationStatusEnum = pgEnum("moderation_status", [
  "pending",
  "approved",
  "rejected",
  "needs_review",
]);

export const gameModeEnum = pgEnum("game_mode", ["daily", "freeplay"]);

export const gameStatusEnum = pgEnum("game_status", ["in_progress", "completed", "abandoned"]);

export const gameRoundStatusEnum = pgEnum("game_round_status", [
  "active",
  "resolved_correct",
  "resolved_incorrect",
  "expired",
]);

export const dailyChallengeStatusEnum = pgEnum("daily_challenge_status", ["draft", "published"]);

// Best-effort/admin-set - mitmachim.top's public API has no reliable
// "banned" signal for most users, so most rows stay 'unknown' unless an
// admin sets them explicitly. See src/game/eligibility.ts for how
// 'unknown' is handled conservatively without disqualifying the entire
// pool.
export const forumAccountStatusEnum = pgEnum("forum_account_status", [
  "unknown",
  "active",
  "deleted",
  "banned",
]);

// Admin control over target eligibility, kept deliberately separate from
// the computed signal (forum_user.computed_eligible) rather than
// conflated into one boolean - see src/game/eligibility.ts.
export const eligibilityOverrideEnum = pgEnum("eligibility_override", [
  "none",
  "force_eligible",
  "force_ineligible",
]);
