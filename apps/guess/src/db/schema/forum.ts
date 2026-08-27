import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { eligibilityOverrideEnum, forumAccountStatusEnum, moderationStatusEnum } from "./enums";
import { adminUser } from "./admin";
import { importRun } from "./importRun";

// One row per mitmachim.top forum author we know about. Append-only in
// spirit: rows are not expected to be deleted, only updated (username can
// legitimately change on the forum; forum_uid/userslug should not).
//
// Eligibility is deliberately split into two independent signals rather
// than one conflated boolean (src/game/eligibility.ts is the pure
// function that reconciles them into an effective decision):
//   - computed_eligible/eligibility_reasons/eligible_as_of: the
//     deterministic service's own conclusion, cached here for query
//     performance. Recomputed periodically/on-demand; never hand-edited.
//   - admin_override: an admin's explicit, independent decision that
//     always wins over the computed signal in either direction (e.g.
//     correcting a bot-detection false positive, or immediately pulling a
//     specific user regardless of what the computation says).
// account_status/is_system_or_bot are separate "hard fact" signals the
// computation reads, not eligibility conclusions themselves.
export const forumUser = pgTable(
  "forum_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    forumUid: text("forum_uid").notNull(),
    forumUsername: text("forum_username").notNull(),
    forumUserslug: text("forum_userslug").notNull(),
    accountStatus: forumAccountStatusEnum("account_status").notNull().default("unknown"),
    isSystemOrBot: boolean("is_system_or_bot").notNull().default(false),
    adminOverride: eligibilityOverrideEnum("admin_override").notNull().default("none"),
    computedEligible: boolean("computed_eligible").notNull().default(false),
    eligibilityReasons: jsonb("eligibility_reasons").notNull().default(sql`'[]'::jsonb`),
    eligibleAsOf: timestamp("eligible_as_of", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_forum_user_forum_uid").on(table.forumUid),
    uniqueIndex("uq_forum_user_forum_userslug").on(table.forumUserslug),
    index("ix_forum_user_computed_eligible").on(table.computedEligible),
  ],
);

// Recomputed distractor/eligibility signal, 1:1 with forum_user. Purely
// derived data - safe to cascade-delete if the user row is ever removed.
export const forumUserStats = pgTable(
  "forum_user_stats",
  {
    forumUserId: uuid("forum_user_id")
      .primaryKey()
      .references(() => forumUser.id, { onDelete: "cascade" }),
    approvedPostCount: integer("approved_post_count").notNull().default(0),
    totalPostCount: integer("total_post_count").notNull().default(0),
    avgWordCount: integer("avg_word_count").notNull().default(0),
    // Average of approved posts' quality_score - a "writing statistics"
    // signal the distractor ranker uses alongside avgWordCount.
    avgQualityScore: real("avg_quality_score").notNull().default(0),
    topCategories: jsonb("top_categories").notNull().default(sql`'[]'::jsonb`),
    usernameLength: integer("username_length").notNull().default(0),
    // Approximate activity period, for the distractor ranker's "activity
    // period overlap" signal - [firstActiveAt, lastActiveAt].
    firstActiveAt: timestamp("first_active_at", { withTimezone: true }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "chk_forum_user_stats_counts_nonneg",
      sql`${table.approvedPostCount} >= 0
          AND ${table.totalPostCount} >= 0
          AND ${table.avgWordCount} >= 0
          AND ${table.usernameLength} >= 0`,
    ),
    check(
      "chk_forum_user_stats_approved_le_total",
      sql`${table.approvedPostCount} <= ${table.totalPostCount}`,
    ),
    check(
      "chk_forum_user_stats_avg_quality_score_range",
      sql`${table.avgQualityScore} >= 0 AND ${table.avgQualityScore} <= 1`,
    ),
  ],
);

// One row per imported forum post. `raw_content` and the source-identity
// columns (forum_pid, forum_user_id, posted_at) are immutable after
// insert - enforced by a hand-authored PostgreSQL trigger added in the
// migration (drizzle's TypeScript schema cannot express trigger logic;
// see drizzle/migrations/0001_forum_post_immutability.sql). `clean_content`
// is the only column an admin can edit, and every edit is captured in
// forum_post_revision before being overwritten.
//
// Quality/leak metadata (word_count..moderation_flags) is computed once at
// import time by src/importer/quality.ts from src/importer/sanitize.ts's
// output - deterministic, no AI call, one source of truth (see
// QUALITY_CONFIG). These columns replace an earlier placeholder pair
// (contains_pii_suspected, length_ok booleans) from the Stage 1 schema
// that predated the real pipeline; nothing has ever been applied to a
// database, so this is a pre-deployment schema correction, not a
// production migration.
export const forumPost = pgTable(
  "forum_post",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    forumPid: text("forum_pid").notNull(),
    forumTid: text("forum_tid").notNull(),
    forumUserId: uuid("forum_user_id")
      .notNull()
      .references(() => forumUser.id, { onDelete: "restrict" }),
    forumCategoryCid: text("forum_category_cid").notNull(),
    rawContent: text("raw_content").notNull(),
    cleanContent: text("clean_content"),
    sha256Raw: text("sha256_raw").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRun.id, { onDelete: "restrict" }),
    moderationStatus: moderationStatusEnum("moderation_status").notNull().default("pending"),
    // Optimistic-concurrency counter for admin moderation actions
    // (approve/reject/edit). Incremented on every such action; a caller
    // must submit the version it last read, and a mismatch means someone
    // else already acted on this post since - see src/admin/moderation-repository.ts.
    // Deliberately separate from updatedAt (a timestamp is not a safe
    // concurrency token - clock resolution/skew could collide).
    moderationVersion: integer("moderation_version").notNull().default(0),
    wordCount: integer("word_count").notNull().default(0),
    contentLength: integer("content_length").notNull().default(0),
    quoteRatio: real("quote_ratio").notNull().default(0),
    genericResponseScore: real("generic_response_score").notNull().default(0),
    qualityScore: real("quality_score").notNull().default(0),
    potentialLeakScore: real("potential_leak_score").notNull().default(0),
    // "Presence" (hasLinks/hasMentions) is deliberately not a stored
    // column - it is trivially `linksCount > 0` / `mentionsCount > 0` at
    // read time, and storing it separately would just be a second,
    // driftable source of truth for the same fact (same reasoning as
    // round_choice not storing a redundant is_correct column).
    linksCount: integer("links_count").notNull().default(0),
    mentionsCount: integer("mentions_count").notNull().default(0),
    // Array of {code, reason} - see quality.ts's deriveModerationFlags.
    moderationFlags: jsonb("moderation_flags").notNull().default(sql`'[]'::jsonb`),
    // Set when a re-import of an already-known forum_pid observes upstream
    // content that no longer matches sha256Raw. raw_content is NEVER
    // overwritten when this happens (see the immutability trigger) - this
    // is only a signal for a human to re-review, not a mutation of the
    // original record.
    sourceDiverged: boolean("source_diverged").notNull().default(false),
    sourceDivergedAt: timestamp("source_diverged_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_forum_post_forum_pid").on(table.forumPid),
    index("ix_forum_post_user_moderation").on(table.forumUserId, table.moderationStatus),
    index("ix_forum_post_moderation_status").on(table.moderationStatus),
    index("ix_forum_post_sha256_raw").on(table.sha256Raw),
    check("chk_forum_post_word_count_nonneg", sql`${table.wordCount} >= 0`),
    check("chk_forum_post_content_length_nonneg", sql`${table.contentLength} >= 0`),
    check("chk_forum_post_quote_ratio_range", sql`${table.quoteRatio} >= 0 AND ${table.quoteRatio} <= 1`),
    check(
      "chk_forum_post_generic_response_score_range",
      sql`${table.genericResponseScore} >= 0 AND ${table.genericResponseScore} <= 1`,
    ),
    check("chk_forum_post_quality_score_range", sql`${table.qualityScore} >= 0 AND ${table.qualityScore} <= 1`),
    check(
      "chk_forum_post_potential_leak_score_range",
      sql`${table.potentialLeakScore} >= 0 AND ${table.potentialLeakScore} <= 1`,
    ),
    check("chk_forum_post_links_count_nonneg", sql`${table.linksCount} >= 0`),
    check("chk_forum_post_mentions_count_nonneg", sql`${table.mentionsCount} >= 0`),
    check("chk_forum_post_moderation_version_nonneg", sql`${table.moderationVersion} >= 0`),
  ],
);

// Audit trail for clean_content edits. previous_clean_content records what
// the value was immediately before this edit (may be null if the edit was
// the first time clean_content was populated).
export const forumPostRevision = pgTable(
  "forum_post_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    forumPostId: uuid("forum_post_id")
      .notNull()
      .references(() => forumPost.id, { onDelete: "cascade" }),
    previousCleanContent: text("previous_clean_content"),
    editedByAdminId: uuid("edited_by_admin_id").references(() => adminUser.id, {
      onDelete: "set null",
    }),
    editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_forum_post_revision_post").on(table.forumPostId)],
);
