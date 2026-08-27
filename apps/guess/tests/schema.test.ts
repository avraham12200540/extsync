import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { readMigrationFiles } from "drizzle-orm/migrator";

// These tests are purely structural/static: they read the generated SQL
// migration files as text and assert on the DDL Drizzle (and one
// hand-authored migration) produced. They do NOT open a database
// connection, run Docker, or touch the network - Stage 1 has no live
// database anywhere. Where a PostgreSQL *behavior* (does the trigger
// actually fire? does the partial index actually stop a second row?)
// cannot be proven without executing SQL against a real Postgres, that
// limitation is called out explicitly in the test name/comment rather
// than being silently assumed to pass.

const migrationsDir = path.join(__dirname, "..", "drizzle", "migrations");

function readMigration(filename: string): string {
  return readFileSync(path.join(migrationsDir, filename), "utf8");
}

const initSql = readMigration("0000_init.sql");
const immutabilitySql = readMigration("0001_forum_post_immutability.sql");
const adminAuditSql = readMigration("0002_overrated_black_crow.sql");
const allSql = `${initSql}\n${immutabilitySql}\n${adminAuditSql}`;

test("migrations directory contains exactly the three expected files (plus meta/)", () => {
  const entries = readdirSync(migrationsDir).filter((f) => f !== "meta");
  assert.deepEqual(entries.sort(), ["0000_init.sql", "0001_forum_post_immutability.sql", "0002_overrated_black_crow.sql"]);
});

test("journal registers all three migrations in order", () => {
  const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8"));
  const tags = journal.entries.map((e: { tag: string }) => e.tag);
  assert.deepEqual(tags, ["0000_init", "0001_forum_post_immutability", "0002_overrated_black_crow"]);
  const idxs = journal.entries.map((e: { idx: number }) => e.idx);
  assert.deepEqual(idxs, [0, 1, 2], "journal idx must be sequential starting at 0, matching apply order");
});

// The two tests below do NOT re-implement journal-reading logic - they call
// `readMigrationFiles` imported directly from `drizzle-orm/migrator`, which
// is the exact function `drizzle-orm/postgres-js/migrator`'s `migrate()`
// calls before executing anything against a real database (verified by
// reading node_modules/drizzle-orm/postgres-js/migrator.js: it does
// `readMigrationFiles(config)` then `db.dialect.migrate(migrations, ...)`).
// That function reads ONLY meta/_journal.json and, for each journal entry
// **in array order**, resolves the file via `${journalEntry.tag}.sql` -
// there is no directory listing/glob anywhere in it. So proving something
// here about what readMigrationFiles returns is proving what the real
// migration command will actually execute, not guessing at it from
// filenames.
test("readMigrationFiles (the real migrator's loader) resolves all three migrations, in order, by journal tag - not by filename discovery", () => {
  const migrations = readMigrationFiles({ migrationsFolder: migrationsDir });
  assert.equal(migrations.length, 3);

  // Order proof: migrations[0] must be the base schema (defines the
  // tables) and must NOT yet contain the trigger; migrations[1] must be
  // the immutability trigger, applied strictly after the base schema
  // exists (it targets a table the first migration creates); migrations[2]
  // must be the admin_audit_event/moderation_version addition, which must
  // not redefine any table the first migration already created.
  const firstSql = migrations[0]?.sql.join("\n") ?? "";
  const secondSql = migrations[1]?.sql.join("\n") ?? "";
  const thirdSql = migrations[2]?.sql.join("\n") ?? "";
  assert.match(firstSql, /CREATE TABLE "forum_post"/);
  assert.doesNotMatch(firstSql, /CREATE TRIGGER/);
  assert.match(secondSql, /CREATE TRIGGER forum_post_immutable_fields_trigger/);
  assert.doesNotMatch(secondSql, /CREATE TABLE/);
  assert.match(thirdSql, /CREATE TABLE "admin_audit_event"/);
  assert.match(thirdSql, /ADD COLUMN "moderation_version"/);
  assert.doesNotMatch(thirdSql, /CREATE TABLE "forum_post"/);
});

test("readMigrationFiles hash for each migration matches the real file content (used by the migrator to detect already-applied migrations)", () => {
  const migrations = readMigrationFiles({ migrationsFolder: migrationsDir });
  const expectedHashes = [initSql, immutabilitySql, adminAuditSql].map((content) =>
    crypto.createHash("sha256").update(content).digest("hex"),
  );
  assert.deepEqual(
    migrations.map((m) => m.hash),
    expectedHashes,
  );
});

const REQUIRED_TABLES = [
  "admin_session",
  "admin_user",
  "import_run",
  "forum_post",
  "forum_post_revision",
  "forum_user",
  "forum_user_stats",
  "player_session",
  "daily_challenge",
  "daily_challenge_round",
  "game",
  "game_round",
  "guess",
  "round_choice",
  "round_post",
  "rate_limit_bucket",
  "idempotency_key",
];

test("every required table from the approved architecture is created", () => {
  for (const tableName of REQUIRED_TABLES) {
    assert.match(
      initSql,
      new RegExp(`CREATE TABLE "${tableName}"`),
      `expected CREATE TABLE "${tableName}" in 0000_init.sql`,
    );
  }
});

test("no unexpected extra tables are created", () => {
  const created = [...initSql.matchAll(/CREATE TABLE "([a-z0-9_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(created.sort(), [...REQUIRED_TABLES].sort());
});

test("raw-content immutability trigger targets forum_post and guards all four immutable columns", () => {
  assert.match(immutabilitySql, /CREATE TRIGGER forum_post_immutable_fields_trigger/);
  assert.match(immutabilitySql, /BEFORE UPDATE ON "forum_post"/);
  assert.match(immutabilitySql, /EXECUTE FUNCTION forum_post_prevent_immutable_field_update/);
  for (const column of ["raw_content", "forum_pid", "forum_user_id", "posted_at"]) {
    assert.match(
      immutabilitySql,
      new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`),
      `expected the trigger function to guard ${column}`,
    );
  }
  // clean_content must NOT be guarded - it is the one editable column.
  assert.doesNotMatch(immutabilitySql, /NEW\.clean_content IS DISTINCT FROM OLD\.clean_content/);
});

test("forum_post carries the quality/leak metadata columns required by the importer, all range-checked", () => {
  const QUALITY_COLUMNS: Array<[column: string, checkName: string]> = [
    ["word_count", "chk_forum_post_word_count_nonneg"],
    ["content_length", "chk_forum_post_content_length_nonneg"],
    ["quote_ratio", "chk_forum_post_quote_ratio_range"],
    ["generic_response_score", "chk_forum_post_generic_response_score_range"],
    ["quality_score", "chk_forum_post_quality_score_range"],
    ["potential_leak_score", "chk_forum_post_potential_leak_score_range"],
    ["links_count", "chk_forum_post_links_count_nonneg"],
    ["mentions_count", "chk_forum_post_mentions_count_nonneg"],
  ];
  const forumPostBlock = initSql.slice(
    initSql.indexOf('CREATE TABLE "forum_post"'),
    initSql.indexOf('CREATE TABLE "forum_post_revision"'),
  );
  for (const [column, checkName] of QUALITY_COLUMNS) {
    assert.match(forumPostBlock, new RegExp(`"${column}"`), `expected column ${column} on forum_post`);
    assert.match(forumPostBlock, new RegExp(`CONSTRAINT "${checkName}"`), `expected check constraint ${checkName}`);
  }
  assert.match(forumPostBlock, /"moderation_flags" jsonb DEFAULT '\[\]'::jsonb NOT NULL/);
  assert.match(forumPostBlock, /"source_diverged" boolean DEFAULT false NOT NULL/);
  assert.match(forumPostBlock, /"source_diverged_at" timestamp with time zone/);
});

test("the placeholder columns quality metadata superseded (contains_pii_suspected, length_ok) are gone", () => {
  assert.doesNotMatch(initSql, /"contains_pii_suspected"/);
  assert.doesNotMatch(initSql, /"length_ok"/);
});

test("none of the new quality/leak/source-divergence columns are guarded by the immutability trigger", () => {
  const newlyEditableColumns = [
    "word_count",
    "content_length",
    "quote_ratio",
    "generic_response_score",
    "quality_score",
    "potential_leak_score",
    "links_count",
    "mentions_count",
    "moderation_flags",
    "source_diverged",
  ];
  for (const column of newlyEditableColumns) {
    assert.doesNotMatch(
      immutabilitySql,
      new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`),
      `${column} must remain editable on re-import/moderation, not immutable`,
    );
  }
});

test(
  "LIMITATION: cannot prove the trigger actually rejects an UPDATE without executing it " +
    "against a real PostgreSQL instance - this test only proves the DDL text is well-formed " +
    "and targets the right table/columns",
  () => {
    assert.ok(immutabilitySql.includes("RAISE EXCEPTION"));
  },
);

test("partial unique index enforces one daily game per player session, exempting free-play", () => {
  const indexMatch = initSql.match(
    /CREATE UNIQUE INDEX "uq_game_one_daily_per_session" ON "game" USING btree \("daily_challenge_id","player_session_id"\) WHERE "game"\."daily_challenge_id" IS NOT NULL/,
  );
  assert.ok(indexMatch, "expected the partial unique index with its WHERE clause on game");
});

test(
  "LIMITATION: cannot prove a second daily Game insert for the same session is actually " +
    "rejected without executing it against a real PostgreSQL instance",
  () => {
    assert.ok(true);
  },
);

test("guess.choice_id is bound to its own game_round via a composite foreign key, not just app validation", () => {
  assert.match(
    allSql,
    /ALTER TABLE "guess" ADD CONSTRAINT "fk_guess_round_choice" FOREIGN KEY \("game_round_id","choice_id"\) REFERENCES "public"\."round_choice"\("game_round_id","choice_id"\)/,
  );
  // The referenced composite must itself be backed by a unique constraint
  // for the FK to be valid at all - confirm round_choice actually has one.
  assert.match(
    initSql,
    /CREATE UNIQUE INDEX "uq_round_choice_round_and_choice" ON "round_choice" USING btree \("game_round_id","choice_id"\)/,
  );
});

test("round_choice enforces at most 4 distinct, positioned choices per round", () => {
  assert.match(
    initSql,
    /CREATE UNIQUE INDEX "uq_round_choice_position" ON "round_choice" USING btree \("game_round_id","display_position"\)/,
  );
  assert.match(
    initSql,
    /CONSTRAINT "chk_round_choice_position_range" CHECK \("round_choice"\."display_position" >= 1 AND "round_choice"\."display_position" <= 4\)/,
  );
});

test("session/admin tables store only session-token hashes, never a raw bearer token column", () => {
  // Anchored to the exact column-declaration line shape (tab + quoted name
  // + type), so this counts real column declarations only - not the
  // substring also embedded in the two unique index names
  // (uq_admin_session_token_hash / uq_player_session_token_hash).
  const declarations = initSql.match(/^\t"session_token_hash" text NOT NULL,?$/gm) ?? [];
  assert.equal(declarations.length, 2, "expected exactly one session_token_hash column in each of admin_session and player_session");
});

test("session/admin tables store only CSRF-token hashes, never a raw CSRF secret column", () => {
  // csrf_secret (plaintext) was replaced with csrf_token_hash: the raw
  // high-entropy CSRF token is sent to the client once and validated by
  // hashing the submitted value and comparing - never by storing or
  // reading back a raw secret server-side, matching sessionTokenHash.
  const declarations = initSql.match(/^\t"csrf_token_hash" text NOT NULL,?$/gm) ?? [];
  assert.equal(declarations.length, 2, "expected exactly one csrf_token_hash column in each of admin_session and player_session");
  assert.doesNotMatch(initSql, /"csrf_secret"/);
});

test("no raw bearer-token column exists anywhere in the schema", () => {
  // Columns named exactly "token" or "session_token" (i.e. missing the
  // "_hash" suffix) would be a raw bearer credential at rest. share_token
  // is the sole deliberate exception: a public identifier that grants only
  // read access to one completed game's answer-free, share-safe results
  // summary (see game.ts) - never session-level control and never the
  // answers themselves, so it is not a bearer credential whose leak alone
  // grants account/session control.
  const columnDeclarations = [...initSql.matchAll(/^\t"([a-z0-9_]+)"/gm)]
    .map((m) => m[1])
    .filter((name): name is string => name !== undefined);
  const forbidden = columnDeclarations.filter(
    (name) => /token/.test(name) && !name.endsWith("_hash") && name !== "share_token",
  );
  assert.deepEqual(forbidden, []);
});

test("forum_post_revision preserves clean_content history without touching raw_content", () => {
  assert.match(initSql, /CREATE TABLE "forum_post_revision"/);
  assert.match(initSql, /"previous_clean_content" text/);
  assert.doesNotMatch(
    initSql.slice(initSql.indexOf('CREATE TABLE "forum_post_revision"')),
    /raw_content/,
  );
});

test("import_run models trigger source as an enum + nullable admin FK with a consistency check, not a single ambiguous field", () => {
  assert.match(initSql, /"trigger_kind" "import_trigger_kind" NOT NULL/);
  assert.match(initSql, /"triggered_by_admin_id" uuid/);
  assert.match(
    initSql,
    /CONSTRAINT "chk_import_run_trigger_consistency" CHECK \(\("import_run"\."trigger_kind" = 'admin' AND "import_run"\."triggered_by_admin_id" IS NOT NULL\)/,
  );
});

test("game.total_rounds is pinned to the mode (5 for daily, 10 for freeplay) via a check constraint", () => {
  assert.match(
    initSql,
    /CONSTRAINT "chk_game_mode_matches_total_rounds" CHECK \(\("game"\."mode" = 'daily' AND "game"\."total_rounds" = 5\)/,
  );
});

test("round_choice does not persist a redundant is_correct column", () => {
  const roundChoiceBlock = initSql.slice(
    initSql.indexOf('CREATE TABLE "round_choice"'),
    initSql.indexOf('CREATE TABLE "round_post"'),
  );
  assert.doesNotMatch(roundChoiceBlock, /is_correct/);
});
