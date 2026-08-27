import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { dailyChallengeStatusEnum, gameModeEnum, gameRoundStatusEnum, gameStatusEnum } from "./enums";
import { forumPost, forumUser } from "./forum";
import { playerSession } from "./session";

// The single shared puzzle definition for one Israel-calendar day. `date`
// is a plain SQL date (not a timestamp) precisely because "day" here means
// the Asia/Jerusalem calendar date, computed once by the app the same way
// the platform's own likes-quota daily-reset logic does - not a UTC
// midnight boundary.
export const dailyChallenge = pgTable(
  "daily_challenge",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    status: dailyChallengeStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("uq_daily_challenge_date").on(table.date)],
);

// The ~5 target users that make up one daily challenge, in play order -
// plus the exact posts/choices published for that round, snapshotted once
// at construction time (src/game/daily-challenge.ts). Publishing this row
// is what "the same ordered five targets/posts/choices for everyone" (the
// Stage 3 mission requirement) actually means at the data level: every
// player's Game.round_plan (see below) is copied FROM this row, not
// recomputed per player, and this row is never edited after being
// published - a later change to the curated dataset (moderation, new
// imports) creates a *different* future daily challenge, it never mutates
// one that already has a `published` daily_challenge.status.
export const dailyChallengeRound = pgTable(
  "daily_challenge_round",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dailyChallengeId: uuid("daily_challenge_id")
      .notNull()
      .references(() => dailyChallenge.id, { onDelete: "cascade" }),
    orderInGame: integer("order_in_game").notNull(),
    targetForumUserId: uuid("target_forum_user_id")
      .notNull()
      .references(() => forumUser.id, { onDelete: "restrict" }),
    // Exactly MAX_POSTS_PER_ROUND (5) forum_post.id strings, in reveal order.
    postIds: jsonb("post_ids").notNull(),
    // Exactly CHOICES_PER_ROUND (4) forum_user.id strings - the candidate
    // set shown to every player. One of them equals target_forum_user_id;
    // display order/opaque choice_id are still randomized per player's
    // own GameRound/RoundChoice rows (see game_round below), matching the
    // Stage 1 anti-correlation design - only the underlying *set* of
    // candidate users is shared across players.
    choiceUserIds: jsonb("choice_user_ids").notNull(),
  },
  (table) => [
    uniqueIndex("uq_daily_challenge_round_order").on(table.dailyChallengeId, table.orderInGame),
    check(
      "chk_daily_challenge_round_order_range",
      sql`${table.orderInGame} >= 1 AND ${table.orderInGame} <= 5`,
    ),
    check("chk_daily_challenge_round_post_ids_count", sql`jsonb_array_length(${table.postIds}) = 5`),
    check("chk_daily_challenge_round_choice_user_ids_count", sql`jsonb_array_length(${table.choiceUserIds}) = 4`),
  ],
);

// One play-through, daily or free-play. Cardinality note: SQL cannot
// express "this game must eventually have exactly total_rounds
// game_round rows" as a table constraint - that invariant is enforced by
// the application transaction that creates each round via /advance,
// bounded by current_round_index <= total_rounds (which SQL *can* check).
export const game = pgTable(
  "game",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerSessionId: uuid("player_session_id")
      .notNull()
      .references(() => playerSession.id, { onDelete: "cascade" }),
    mode: gameModeEnum("mode").notNull(),
    dailyChallengeId: uuid("daily_challenge_id").references(() => dailyChallenge.id, {
      onDelete: "restrict",
    }),
    totalRounds: integer("total_rounds").notNull(),
    currentRoundIndex: integer("current_round_index").notNull().default(0),
    totalScore: integer("total_score").notNull().default(0),
    status: gameStatusEnum("status").notNull().default("in_progress"),
    // The full round-by-round plan for THIS game, snapshotted once at
    // creation time: an array (length = total_rounds) of
    // {targetForumUserId, postIds: string[5], choiceUserIds: string[4]}.
    // For daily games this is a copy of the published
    // daily_challenge_round rows; for free-play it's this game's own
    // freshly-selected plan (src/game/freeplay.ts). Either way, rounds
    // are materialized (GameRound/RoundPost/RoundChoice) FROM this frozen
    // plan as the player advances - never re-derived live from the
    // current forum_post/forum_user tables - so a moderation or import
    // change made after this game started can never alter an
    // already-started game.
    roundPlan: jsonb("round_plan").notNull(),
    // Intentionally plaintext and not a "raw token" in the security sense
    // (unlike player_session/admin_session's sessionTokenHash/csrfTokenHash):
    // a public, shareable result-page identifier. It grants only read
    // access to that one completed game's answer-free, share-safe results
    // summary (see the API contract notes in the architecture report:
    // round targets, forum_uid/userslug and source identifiers are never
    // serialized to any client, share view included) - never session-level
    // control, and never the answers themselves. Generated separately from
    // the session token specifically so sharing it cannot leak anything
    // beyond that summary. Safe to serve directly, like any other opaque
    // public id.
    shareToken: text("share_token"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_game_share_token").on(table.shareToken),
    // Enforces "one daily game per player session" at the database level.
    // The partial WHERE clause means free-play games (daily_challenge_id
    // IS NULL) are entirely exempt from this constraint, matching the
    // "no such limit for free-play" requirement.
    uniqueIndex("uq_game_one_daily_per_session")
      .on(table.dailyChallengeId, table.playerSessionId)
      .where(sql`${table.dailyChallengeId} IS NOT NULL`),
    check(
      "chk_game_mode_matches_total_rounds",
      sql`(${table.mode} = 'daily' AND ${table.totalRounds} = 5)
          OR (${table.mode} = 'freeplay' AND ${table.totalRounds} = 10)`,
    ),
    check(
      "chk_game_mode_matches_daily_challenge",
      sql`(${table.mode} = 'daily' AND ${table.dailyChallengeId} IS NOT NULL)
          OR (${table.mode} = 'freeplay' AND ${table.dailyChallengeId} IS NULL)`,
    ),
    check(
      "chk_game_current_round_index_range",
      sql`${table.currentRoundIndex} >= 0 AND ${table.currentRoundIndex} <= ${table.totalRounds}`,
    ),
    check("chk_game_total_score_nonneg", sql`${table.totalScore} >= 0`),
    check(
      "chk_game_round_plan_length_matches_total_rounds",
      sql`jsonb_array_length(${table.roundPlan}) = ${table.totalRounds}`,
    ),
  ],
);

// One of the game's rounds. `target_forum_user_id` and every round_choice
// row are server-only data: the API layer must never serialize this
// column or any round_choice.forum_user_id to the client before the round
// resolves (see apps/guess API contract notes in the app README).
export const gameRound = pgTable(
  "game_round",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => game.id, { onDelete: "cascade" }),
    orderInGame: integer("order_in_game").notNull(),
    targetForumUserId: uuid("target_forum_user_id")
      .notNull()
      .references(() => forumUser.id, { onDelete: "restrict" }),
    status: gameRoundStatusEnum("status").notNull().default("active"),
    hintsRevealedCount: integer("hints_revealed_count").notNull().default(0),
    wrongGuessCount: integer("wrong_guess_count").notNull().default(0),
    scoreAwarded: integer("score_awarded").notNull().default(0),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_game_round_order").on(table.gameId, table.orderInGame),
    // Upper bound of 10 covers both modes (freeplay has up to 10 rounds);
    // the exact per-mode ceiling (5 for daily) is enforced by the
    // application at round-creation time against the parent game's
    // total_rounds, since a same-table CHECK cannot see another table's
    // column.
    check(
      "chk_game_round_order_range",
      sql`${table.orderInGame} >= 1 AND ${table.orderInGame} <= 10`,
    ),
    check(
      "chk_game_round_hints_range",
      sql`${table.hintsRevealedCount} >= 0 AND ${table.hintsRevealedCount} <= 5`,
    ),
    check("chk_game_round_wrong_guess_nonneg", sql`${table.wrongGuessCount} >= 0`),
    // 100 is SCORE_CURVE[0] (see src/lib/scoring.ts) - the maximum a round
    // can ever award. Kept as a literal bound here rather than importing
    // the scoring module (schema files must stay free of runtime app
    // logic); the two are covered together by tests (see
    // tests/schema.test.ts and tests/scoring.test.ts).
    check(
      "chk_game_round_score_range",
      sql`${table.scoreAwarded} >= 0 AND ${table.scoreAwarded} <= 100`,
    ),
  ],
);

// Ordered, accumulating hints: the posts shown for a round's target user,
// revealed one at a time.
export const roundPost = pgTable(
  "round_post",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameRoundId: uuid("game_round_id")
      .notNull()
      .references(() => gameRound.id, { onDelete: "cascade" }),
    forumPostId: uuid("forum_post_id")
      .notNull()
      .references(() => forumPost.id, { onDelete: "restrict" }),
    displayOrder: integer("display_order").notNull(),
    revealed: boolean("revealed").notNull().default(false),
    revealedAt: timestamp("revealed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_round_post_order").on(table.gameRoundId, table.displayOrder),
    uniqueIndex("uq_round_post_unique_post").on(table.gameRoundId, table.forumPostId),
    check("chk_round_post_display_order_range", sql`${table.displayOrder} >= 1 AND ${table.displayOrder} <= 5`),
  ],
);

// The 4 answer options for a round. `choice_id` is a fresh random UUID
// per round instance - distinct from `id` - specifically so a client
// cannot correlate choice identities to forum_user_id across rounds.
//
// `is_correct` is deliberately NOT a column here. Correctness is always
// derivable as `round_choice.forum_user_id = game_round.target_forum_user_id`
// via a join, so storing a redundant boolean would create a second source
// of truth that could drift from game_round.target_forum_user_id. "Exactly
// one correct choice per round" then follows structurally from
// uq_round_choice_user (a user can appear at most once among a round's
// choices) combined with the application-level invariant, enforced in
// the same transaction that creates a round, that the target user is
// always inserted as one of the 4 round_choice rows. SQL cannot verify
// that cross-table inclusion on its own without a trigger; this is the
// one cardinality guarantee in this schema that relies on transactional
// discipline rather than a constraint (see also: "exactly 4 choices"
// below).
export const roundChoice = pgTable(
  "round_choice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameRoundId: uuid("game_round_id")
      .notNull()
      .references(() => gameRound.id, { onDelete: "cascade" }),
    choiceId: uuid("choice_id").notNull().defaultRandom(),
    forumUserId: uuid("forum_user_id")
      .notNull()
      .references(() => forumUser.id, { onDelete: "restrict" }),
    displayPosition: integer("display_position").notNull(),
  },
  (table) => [
    uniqueIndex("uq_round_choice_choice_id").on(table.choiceId),
    // Composite unique - this is the FK target `guess` uses to guarantee,
    // relationally, that a submitted choice_id actually belongs to the
    // round_id the guess claims (see guess.fk_guess_round_choice below).
    uniqueIndex("uq_round_choice_round_and_choice").on(table.gameRoundId, table.choiceId),
    uniqueIndex("uq_round_choice_user").on(table.gameRoundId, table.forumUserId),
    // At most 4 distinct positions per round, no duplicates - this bounds
    // cardinality from above. It cannot guarantee exactly 4 rows exist
    // (i.e. not fewer); that "exactly 4" floor is enforced by the
    // application transaction that creates a round's choices atomically.
    uniqueIndex("uq_round_choice_position").on(table.gameRoundId, table.displayPosition),
    check(
      "chk_round_choice_position_range",
      sql`${table.displayPosition} >= 1 AND ${table.displayPosition} <= 4`,
    ),
  ],
);

// Individual guess attempts. A round can accumulate several wrong
// guesses before resolving.
export const guess = pgTable(
  "guess",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameRoundId: uuid("game_round_id").notNull(),
    choiceId: uuid("choice_id").notNull(),
    playerSessionId: uuid("player_session_id")
      .notNull()
      .references(() => playerSession.id, { onDelete: "cascade" }),
    isCorrect: boolean("is_correct").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Composite FK (not just app-level validation): guarantees
    // relationally that (game_round_id, choice_id) together match an
    // actual round_choice row, i.e. this choice really belongs to this
    // round - a mismatched pair is rejected by PostgreSQL itself, not
    // just application code.
    foreignKey({
      name: "fk_guess_round_choice",
      columns: [table.gameRoundId, table.choiceId],
      foreignColumns: [roundChoice.gameRoundId, roundChoice.choiceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_guess_game_round",
      columns: [table.gameRoundId],
      foreignColumns: [gameRound.id],
    }).onDelete("cascade"),
    // Blocks resubmitting the identical (round, session, choice) guess a
    // second time - makes double-click/retry submissions idempotent
    // instead of double-counted.
    uniqueIndex("uq_guess_round_session_choice").on(
      table.gameRoundId,
      table.playerSessionId,
      table.choiceId,
    ),
    index("ix_guess_round_id").on(table.gameRoundId),
    check("chk_guess_attempt_number_positive", sql`${table.attemptNumber} >= 1`),
  ],
);
