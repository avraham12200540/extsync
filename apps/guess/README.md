# ExtSync Guess (`/guess`) - isolated daily forum-username guessing game

**Status: Stages 1-4 (scaffold, importer, game domain, gameplay HTTP API) -
not deployed, not in production.** This app has no Docker image, no Caddy
route, no live database anywhere, and is not referenced by any production
config. It exists solely as an isolated scaffold + schema + domain logic +
HTTP API under `apps/guess/`, self-contained and independent of
`apps/web`/`apps/api`.

## Why isolated

`/guess` is a separate Next.js application (its own `package.json`, own
`node_modules`, own build) with `basePath: "/guess"`, backed by its own
PostgreSQL database. It does not share a database, a Redis instance, or an
auth system with the rest of ExtSync. A bug or outage here cannot affect
`apps/api`/`apps/web`, and vice versa. See the architecture report from the
planning cycle that preceded this implementation for the full reasoning
(isolated stack: `guess-web` + `guess-db`, nothing else).

## Path behavior

With `basePath: "/guess"` set in `next.config.mjs`, Next.js automatically
prefixes every route and every static asset:

- `/guess` - landing page (`src/app/page.tsx`)
- `/guess/_next/...` - framework static/runtime chunks (no manual rewrite
  needed - this is handled entirely by `basePath`)
- Later stages will add `/guess/play`, `/guess/daily`, `/guess/admin`,
  `/guess/api/...` the same way, each just another route under `src/app/`

## Stage 1 scope (this delivery)

- App scaffold: `package.json`, strict `tsconfig.json`, `next.config.mjs`,
  minimal Tailwind setup, a plain RTL (`lang="he" dir="rtl"`) placeholder
  page with strings in both `he`/`en` dictionaries (`src/lib/i18n.ts`),
  even though only Hebrew renders today.
- Complete Drizzle schema for every entity in the approved architecture:
  `forum_user`, `forum_user_stats`, `forum_post`, `forum_post_revision`,
  `import_run`, `admin_user`, `admin_session`, `player_session`,
  `daily_challenge`, `daily_challenge_round`, `game`, `game_round`,
  `round_post`, `round_choice`, `guess`, plus `rate_limit_bucket`
  (`src/db/schema/*.ts`).
- Central scoring policy (`src/lib/scoring.ts`): `SCORE_CURVE = [100, 75,
  55, 35, 20]`, a wrong-guess penalty, and `MAX_WRONG_GUESSES` - the only
  place score numbers live. Deliberately hardcoded, not backed by a
  database config table yet, so there is exactly one source of truth
  during this stage.
- Initial migration SQL (generated, not applied - see below).
- Tests that need no database, no Docker, no network: `tests/scoring.test.ts`
  and `tests/schema.test.ts` (the latter reads the generated migration SQL
  as text and asserts on its structure - see "Testing philosophy" below).
- An offline `scripts/create-admin.ts` skeleton - typechecked, never run by
  this codebase or by any agent.

Explicitly **not** in Stage 1: the importer, any game-play API route, any
polished UI, the admin UI, Docker/Caddy wiring, or anything touching a real
database or production.

## Stage 2 scope (importer/content-pipeline slice)

Code and unit tests only - **no runnable production import command or admin
trigger exists yet**, and running an import still requires a real local
database in a later, approved stage. Nothing here is wired into `next dev`,
`next build`, a cron job, or any admin route.

- `src/importer/nodebb-client.ts` - the only module allowed to make outbound
  HTTP requests. The origin `https://mitmachim.top` is a compile-time
  literal (never a parameter), every request/redirect target is re-validated
  against that exact host, non-2xx/3xx-terminal-4xx responses fail without
  retry, 5xx/timeout/network failures retry up to 3 times with exponential
  backoff + jitter, and both `/api/recent` and `/api/topic/{tid}/{slug}`
  responses are validated with Zod schemas that only declare the fields the
  importer actually uses - unknown fields (including profile data like
  `signature`, `picture`, `reputation` observed on the live `user` object)
  are dropped by validation itself, not by later filtering.
- `src/importer/sanitize.ts` - HTML -> safe plain text via `cheerio` (a
  maintained parser), never `dangerouslySetInnerHTML`, never regex over raw
  markup. Strips scripts/styles/embeds/images, quote-attribution blocks,
  signature blocks (best-effort, by class name), mention/profile links,
  ordinary link destinations, bidi-control/zero-width/control characters,
  and the post's own author's self-referenced username/userslug - while
  preserving paragraph breaks and ordinary Hebrew/English punctuation.
  Never invents or paraphrases text.
- `src/importer/quality.ts` - deterministic, no-AI-call scoring:
  `wordCount`, `contentLength`, `quoteRatio`, `genericResponseScore` (against
  a central Hebrew+English low-effort-reply wordlist), `qualityScore`,
  `potentialLeakScore`, `linksCount`, `mentionsCount`, and explainable
  `moderationFlags` (`{code, reason}`). `decideInitialModerationStatus`
  **never returns `approved`** - a new post starts `pending` (no flags) or
  `needs_review` (any flag fired); only a human admin action (a later stage)
  can approve a post.
- `src/importer/repository.ts` - the `ForumRepository` interface the
  importer depends on, plus a real Drizzle-backed implementation. The
  importer's paging/budget/pacing/dedup logic never touches the database
  directly.
- `src/importer/run-import.ts` - the bounded run itself: sequential,
  single-request-in-flight, budgeted (`maxTopics`/`maxPosts`/`maxPages`/
  `maxDurationMs`), paced (configurable delay between requests, default
  1500ms in production - `sleep`/`clock`/`random` are all injected so tests
  run instantly and deterministically), and failure-isolated (one bad
  topic/post is recorded in `errors` and the run continues; only a failure
  before the very first successful step marks the whole run `failed`).

**Ingestion semantics:** dedup is by `forum_pid`. A new `forum_pid` gets a
new immutable `forum_post` row. An already-known `forum_pid` is never
re-inserted; if its freshly-fetched content hash no longer matches the
stored `sha256_raw`, `raw_content` is **never** touched - only
`source_diverged`/`source_diverged_at` are set (and an `approved` post is
conservatively downgraded to `needs_review`), giving a human a signal to
re-review rather than silently trusting either the old or the new content.
No cookies, session identifiers, avatars, emails, IPs, or other profile
metadata are ever stored - the Zod schemas simply never declare those
fields, so there is no code path that could forward them.

New `forum_post` columns for this metadata (`word_count` ..
`moderation_flags`, `source_diverged(+at)`) replaced the Stage 1 placeholder
pair `contains_pii_suspected`/`length_ok`, which predated the real pipeline.
Since nothing has ever been applied to a database, this was a pre-deployment
schema correction (migrations regenerated cleanly), not a production
migration - see the Stage 1 section above for the generation/application
split, which still applies unchanged.

**Verified live NodeBB endpoints** (read-only, one request each, descriptive
User-Agent, during this slice's implementation): `GET /api/recent` -> 200,
`{nextStart, topicCount, topics: [...]}`; `GET /api/topic/{tid}/{slug}` ->
200, `{tid, cid, slug, postcount, posts: [...]}` where each post has `pid,
tid, uid, content, timestamp, user: {uid, username, userslug, ...}`.
`?page=N` pagination on both endpoints follows NodeBB's documented
convention but was not independently re-verified live (only page 1 was
fetched in each case).

## Migration generation vs. application - kept strictly separate

`drizzle-kit generate` reads `src/db/schema/**` and produces SQL migration
files under `drizzle/migrations/`. That command was run to produce this
stage's migrations; **no migration has been applied anywhere** - there is
no `drizzle-kit migrate`/`push` step in this stage, no database connection
was opened, and no `GUESS_DATABASE_URL` was ever set to a real value while
working on this stage. Applying a migration against a real (even
non-production) database is future, approval-gated work.

Two migration files exist:

- `drizzle/migrations/0000_init.sql` - generated directly from the
  TypeScript schema by `drizzle-kit generate`.
- `drizzle/migrations/0001_forum_post_immutability.sql` - hand-authored
  (scaffolded via `drizzle-kit generate --custom` so it's correctly
  registered in `meta/_journal.json`, then filled in by hand). Drizzle's
  TypeScript schema has no way to express trigger logic, so the
  `forum_post` raw-content immutability guarantee (below) has to be
  written as raw SQL.

Run `npx drizzle-kit check` to verify the migration files are consistent
with the current schema (`Everything's fine`) before adding any new
migration.

## Raw-content immutability

`forum_post.raw_content` and its source-identity columns (`forum_pid`,
`forum_user_id`, `posted_at`) must never change after the row is first
inserted - this is enforced at the database level by a `BEFORE UPDATE`
trigger (`0001_forum_post_immutability.sql`), not merely by application
discipline. Any `UPDATE` that touches one of those four columns raises a
PostgreSQL exception and the transaction fails. `clean_content` is the only
editable column on that table; every edit is meant to be recorded in
`forum_post_revision` (capturing the previous value) by the application
before being overwritten - the revision table itself is schema-only in
Stage 1, nothing writes to it yet.

## Testing philosophy for this stage

None of this stage's tests open a database connection, use Docker, or hit
the network - there is no database to connect to yet. `tests/schema.test.ts`
proves things about the **generated SQL text**: which tables exist, that
the immutability trigger's function body guards the right four columns,
that the partial unique index for "one daily game per session" has the
right `WHERE` clause, that `guess` has a composite foreign key into
`round_choice` (not just an application-level check), and that no column
anywhere looks like a raw bearer token. Two tests are explicitly labeled
`LIMITATION:` in their name - they document, rather than paper over, what
this approach cannot prove: that the trigger actually rejects a live
`UPDATE`, and that the partial index actually rejects a live duplicate
insert. Proving those requires executing SQL against a real PostgreSQL
instance, which is out of scope until a later, approval-gated stage.

**Stage 2's importer tests are genuinely unit-testable end to end** because
`run-import.ts` never touches HTTP or a database directly: `tests/importer/`
mocks the NodeBB client's `fetch` (or, for `run-import.test.ts`, mocks the
whole client interface) and swaps the real Drizzle repository for
`tests/importer/in-memory-repository.ts`, which implements the exact same
`ForumRepository` interface. That covers Zod validation, retry/backoff/
redirect-rejection/timeout behavior, budget/pacing behavior with an injected
clock/sleep, dedup/re-import immutability, partial-failure isolation, and
every sanitization/quality/leak rule - all with real execution, not just
static text inspection like `schema.test.ts`. What is **not** exercised by
any test: `createDrizzleForumRepository` (the real Postgres-backed
implementation) itself, since there is no PostgreSQL in this environment -
its correctness rests on being a thin, direct mapping onto the
already-tested schema plus the interface contract being exhaustively
exercised against the in-memory fake it mirrors.

## Stage 3 scope (server-only game domain)

Pure/testable domain logic under `src/game/**` - still no HTTP Route
Handlers, no public/admin UI, no runnable importer command, and no live
database operation. Everything here is either a pure function or an
interface with two implementations (an in-memory fake used by every test,
and a Drizzle adapter that typechecks but has never run against a real
database).

- `src/game/config.ts` - the one place round counts, expirations and
  eligibility thresholds live. Re-exports (never restates) the scoring
  constants from `src/lib/scoring.ts` - `SCORE_CURVE`/`WRONG_GUESS_PENALTY`/
  `MAX_WRONG_GUESSES` still have exactly one source of truth.
- `src/game/eligibility.ts` - pure `resolveEligibility`: an admin
  `adminOverride` (`force_eligible`/`force_ineligible`) always wins over
  the computed signal in either direction; otherwise a system/bot account
  or a `banned`/`deleted` status is disqualifying, an `unknown` status is
  *not* disqualifying by itself (mitmachim.top's public API has no
  reliable banned signal for most users - see the code comment for why
  "conservative" means "note the uncertainty," not "block everyone"), and
  the approved-post-count threshold decides the rest. Every result carries
  explainable `{code, reason}` entries.
- `src/game/distractor.ts` - transparent similarity ranking (username edit
  distance, category overlap, post-count/word-count closeness, average
  quality closeness, activity-period overlap) with two selection modes:
  `deterministic` (score desc, ties broken by id - daily mode) and
  `random` (score desc, ties shuffled by an injected crypto-sourced
  function - free-play). `selectDistractorsWithFallback` degrades through
  three tiers (avoid all repeats -> allow distractor repeats but never
  reuse a target -> no repeat-avoidance at all) before finally throwing
  `InsufficientDistractorPoolError` - so a small curated pool degrades
  gracefully instead of making a whole game construction fail.
- `src/game/daily-challenge.ts` - `computeIsraelDateKey` uses
  `Intl.DateTimeFormat` with `timeZone: "Asia/Jerusalem"` (Node's bundled
  ICU data, not a hand-written UTC-offset/DST approximation - verified
  against the real DST boundary in tests). `computeDailySeed` hashes
  `version:dateKey:serverSecret`; a small deterministic PRNG (mulberry32)
  seeded from that hash selects targets/posts/distractors, always over a
  stably-sorted (by id) canonical ordering first, so the result never
  depends on incoming array/DB-row order. The seed and everything derived
  from it stay server-only - `src/game/view-models.ts` never serializes
  them. **Snapshot immutability**: `buildDailyChallengePlan`'s output is
  meant to be persisted once (into `daily_challenge_round.post_ids`/
  `choice_user_ids`) and never recomputed on read - a later
  moderation/import change alters what a *future* day's construction
  would produce, it cannot retroactively alter a challenge whose rows are
  already published, because nothing re-invokes this function against a
  live pool for a day that's already been built (proven in
  `daily-challenge.test.ts` by rebuilding from a deliberately mutated pool
  and showing the result differs from the original).
- `src/game/freeplay.ts` - `buildFreeplayRoundPlan` builds all 10 rounds
  upfront using injected `cryptoRandom` (never `Math.random`, never the
  deterministic daily PRNG). Targets don't repeat if the pool has >= 10
  distinct eligible users; with a smaller pool, targets cycle round-robin
  over one crypto-shuffle instead of either repeating unpredictably or
  failing outright.
- `src/game/unit-of-work.ts` - the `GameUnitOfWork` interface plus
  `createInMemoryGameUnitOfWork`, the fake every domain test runs against.
  Rounds are materialized lazily from `Game.round_plan` (never re-derived
  from live forum data) on first visit; hint reveals are capped and
  idempotent past the cap; guesses are idempotent by `(round, session,
  choice)` - a resubmitted identical guess returns the original result,
  no second penalty; max wrong guesses auto-resolves the round incorrect
  at score 0; every mutating call checks `game.playerSessionId` and throws
  `ForbiddenGameAccessError` on mismatch; round/game expiry is checked
  lazily on every read (`RoundNotActiveError` after expiry, matching the
  same "check on read" pattern the platform's other session/round designs
  use). A `KeyedMutex` simulates the serialization a real
  `SELECT ... FOR UPDATE` transaction provides, so concurrent calls
  against the same round in tests behave the way the real adapter is
  expected to (proven directly: `Promise.all`-fired concurrent duplicate
  guesses are recorded exactly once; concurrent distinct wrong guesses are
  both counted, with no lost updates).
- `src/game/drizzle-unit-of-work.ts` - the real Postgres adapter, mirroring
  the in-memory logic method-for-method with `db.transaction(...)` +
  `.for("update")` row locks. **Not integration-tested** - there is no
  PostgreSQL in this environment, so nothing in this file has ever
  executed against a real database. Its correctness rests on (a) being a
  mechanical mapping of the already-tested in-memory logic onto the
  already-tested schema, and (b) satisfying the exact same
  `GameUnitOfWork` TypeScript interface the in-memory fake does. What
  remains genuinely unverified until an approved runtime database exists:
  whether `SELECT ... FOR UPDATE` actually serializes concurrent requests
  the way the KeyedMutex simulates, whether the `onConflictDoNothing`
  daily-game race path behaves as designed under real concurrent inserts,
  and whether the check/unique constraints reject what they're meant to
  under real load.
- `src/game/view-models.ts` - `toRoundView`/`toGameView`/
  `toShareResultsView` never spread a domain record (`{...round}`)
  precisely so a field added to an internal record later can't silently
  leak through without a deliberate edit here. Verified by a static test
  that serializes a view built from deliberately distinctive
  "SECRET-..." forum ids and asserts none of them appear anywhere in the
  output, in key or value, before or after resolution (only the correct
  choice's opaque id/username become visible after resolution - never the
  underlying `forumUserId`).

## Stage 4 scope (public gameplay HTTP API)

Real Next.js Route Handlers under `src/app/api/**`, wired to the Stage 3
domain layer. No visual UI, no admin auth/UI, no importer trigger route,
and no infrastructure - `next build` succeeds with zero secrets present
(every handler's production dependencies are constructed lazily, exactly
like `getDb()`), and every endpoint was exercised with real `Request`/
`Response` objects against in-memory dependencies, never a live database.

### Endpoints (external URL -> route file)

`basePath: "/guess"` prefixes every one of these automatically - route
files never hardcode `guess` in a path.

| Method | External URL | Route file |
|---|---|---|
| POST | `/guess/api/session` | `src/app/api/session/route.ts` |
| POST | `/guess/api/games/daily` | `src/app/api/games/daily/route.ts` |
| POST | `/guess/api/games/freeplay` | `src/app/api/games/freeplay/route.ts` |
| GET | `/guess/api/games/:gameId/round` | `src/app/api/games/[gameId]/round/route.ts` |
| POST | `/guess/api/games/:gameId/round/hint` | `src/app/api/games/[gameId]/round/hint/route.ts` |
| POST | `/guess/api/games/:gameId/round/guess` | `src/app/api/games/[gameId]/round/guess/route.ts` |
| POST | `/guess/api/games/:gameId/advance` | `src/app/api/games/[gameId]/advance/route.ts` |
| GET | `/guess/api/games/:gameId/results` | `src/app/api/games/[gameId]/results/route.ts` |
| GET | `/guess/api/results/:shareToken` | `src/app/api/results/[shareToken]/route.ts` |
| GET | `/guess/api/health` | `src/app/api/health/route.ts` |

Verified live against the real standalone build: `GET /guess/api/health`
returns 200; the bare `/api/health` (no basePath) returns 404, proving the
prefix is genuinely required, not accidentally double-mounted.

### Session & CSRF

- `POST /guess/api/session` is the only way to obtain a CSRF token. It
  issues a 256-bit random raw session token in an `HttpOnly`,
  `SameSite=Lax`, `Path=/guess` cookie (`guess_session`) - `Secure` in
  production, deliberately omitted in development so local E2E over plain
  HTTP keeps working (`isProduction` is an explicit injected boolean, read
  from `NODE_ENV` only in the production deps factory - never inline in
  the cookie-building code itself, so both branches are directly
  testable). Only the token's SHA-256 hash is ever persisted
  (`player_session.session_token_hash`); the raw value never appears in a
  JSON body, log line, or URL.
- The JSON body returns a fresh raw CSRF token on every bootstrap call
  (rotates every time - simple, always-fresh policy). The session token
  itself only rotates once it is older than
  `SESSION_ROTATION_THRESHOLD_MS` (30 days), so an ordinary page reload
  doesn't force a new cookie.
- Every state-changing endpoint (`games/daily`, `games/freeplay`,
  `round/hint`, `round/guess`, `advance`) requires the `X-Guess-CSRF`
  header to match the session's stored hash via a constant-time compare
  (`crypto.timingSafeEqual`) - missing or wrong returns 403
  `csrf_failed`. GET endpoints (`round`, `results`, the public share
  view, `health`) never require it and never mutate scoring/progression
  state - see `round.ts`'s doc comment for why lazily materializing a
  round's already-fixed content on first view doesn't count as a
  "mutation" in that sense.

### Idempotency

Every mutating endpoint also requires a client-generated
`X-Idempotency-Key` header (8-128 chars). The same key + endpoint +
request payload always replays the original response without re-running
the mutation; the same key + endpoint with a **different** payload is
rejected 409 `idempotency_key_conflict` rather than silently served a
mismatched cached response. Backed by the `idempotency_key` table
(unique on `(key, endpoint)`).

### Rate limiting

Postgres-backed fixed-window limits (`src/http/rate-limit.ts`), one
bucket per `(ip_hash, endpoint, window)`, atomic
`INSERT ... ON CONFLICT DO UPDATE SET count = count + 1`. IPs are never
stored raw - hashed with a server-only pepper AND rotated daily, so even
a leaked table can't link one day's activity to the next for the same
visitor. Default limits: session 10/min, game creation 10/min, hint
60/min, guess 60/min, advance 30/min, share-results reads 30/min,
admin-login 10/5min (defined now, ready for when admin auth lands - no
admin route exists yet in this slice).

**Trusted-proxy deployment caveat (must be verified before production):**
Next.js Route Handlers have no raw socket access - the only client-IP
signal available at all is `X-Forwarded-For`, and only a reverse proxy
can be trusted to have set it correctly. `GUESS_TRUSTED_PROXY_HOP_COUNT`
(env var, defaults to `1`) says how many of the rightmost comma-separated
entries came from proxies this deployment actually controls. The default
of 1 matches the ONE documented Caddy hop in front of this app per the
project's deploy model, but that was **not independently verified**
against the real, live Caddy configuration in this cycle (it lives on
`/root/extsync` on the production host, outside this checkout's reach).
If the real topology ever changes - a CDN, a load balancer, an extra
Caddy hop - this value must be updated to match, or a client can spoof
their apparent IP by prepending fake entries to `X-Forwarded-For` and
defeat rate limiting entirely. When the header is malformed or has fewer
entries than expected, requests fall back to one shared "unknown IP"
bucket - never to a client-controlled value.

### Anti-leak serialization

Every response is built exclusively from `src/game/view-models.ts`'s
`toRoundView`/`toGameView`/`toShareResultsView` - none of which ever
spread a domain record. Before a round resolves, the response contains
only: the round's own opaque id, order/status/counts, sanitized revealed
post text, the four candidate **usernames** with **opaque** choice ids
(never the underlying `forum_user_id`), and the server-computed current
available score. After resolution, only the correct opaque choice id and
its visible username are additionally revealed - never `forum_uid`,
`userslug`, post `pid`/`tid`, a source URL, `raw_content`, moderation
metadata, or the daily seed. Verified by dedicated tests using
deliberately distinctive `"SECRET-..."`/`"user-NNN"` synthetic ids and
scanning the full serialized response (and, separately, every captured
log line) for their presence.

### Structured logging

`src/http/logger.ts` emits one JSON line per event with `ts`, `level`,
`event`, `requestId`, `correlationId`. Every field passes through an
allowlist-of-exclusions redaction pass before serialization - cookies,
`Authorization`/`X-Guess-CSRF`/`X-Idempotency-Key` headers, raw request
bodies, session-token/CSRF-token/IP hashes, raw IPs, usernames (in any
context, including "the correct answer" feedback fields), raw/clean post
content, and stack traces are all replaced with `[REDACTED]` - recursively,
including nested objects. Tests capture every log line a full request
flow produces and assert none of these ever survive redaction.

### Error shapes

Every error - domain, infra, or validation - maps through
`src/http/errors.ts` to the exact same `{error:{code,message},requestId}`
JSON shape, never a raw stack trace or DB error. `GameNotFoundError` and
`ForbiddenGameAccessError` (a game that exists but isn't yours)
deliberately collapse to the identical 404/`not_found`/message - a
different status for "doesn't exist" vs. "not yours" would let a client
enumerate valid game ids. Even a misconfigured deployment (a route whose
production dependency factory throws because a required env var is
unset) is caught by `invokeWithDeps` and still returns this same safe
shape - confirmed live: before that wrapper existed, the standalone build
returned an empty, unshaped body for this case; after, it returns the
standard JSON envelope.

### Testing philosophy for this stage

Every primitive (session/CSRF, rate limiting, idempotency, error mapping,
validation, logging) and every one of the 10 handlers is exercised with
real Web-standard `Request`/`Response` objects against a fully in-memory
`HttpDeps` (`tests/http/test-support.ts`) - cookie flags, CSRF
missing/wrong/correct, content-type/body-size/schema validation, rate
limits (including a simulated spoofed-`X-Forwarded-For` attempt), daily
resume, free-play creation, hint accumulation and capping, correct/wrong/
duplicate guesses, duplicate idempotency keys (both matching and
conflicting payloads), cross-session access (rejected on every operation,
including the previously-missing check on the round-read path - found and
fixed during this stage), expiry, advance ordering, full-game completion
with share-token generation, the public share view, health, and answer-leak
scans across JSON bodies and logs are all real, executed test outcomes -
269 tests total in the full suite, zero requiring PostgreSQL.

**Not exercised by any test:** the Drizzle-backed adapters
(`drizzle-session-repository.ts`, `drizzle-rate-limit-repository.ts`,
`drizzle-idempotency-repository.ts`, `drizzle-curated-pool-repository.ts`,
plus the Stage 3 `drizzle-unit-of-work.ts`) - there is no PostgreSQL in
this environment. Specifically unverified until an approved runtime
database exists: whether the rate-limit bucket's
`ON CONFLICT DO UPDATE SET count = count + 1` and the idempotency table's
insert-then-read-on-conflict pattern behave correctly under genuine
concurrent requests: whether `SELECT ... FOR UPDATE` row locks actually
serialize the way each in-memory fake's `KeyedMutex`/single-threaded
Map simulates.

## Stage 5 scope (protected admin authentication + moderation/import API)

Real Next.js Route Handlers under `src/app/api/admin/**`, wired to a new
`src/admin/**` domain layer. **No admin visual UI exists yet** - this stage
stops at the API layer, deliberately, per its own scope. No infrastructure,
no live database operation, no real import was executed. `next build`
succeeds with zero admin-specific env vars present (the admin production
deps factory is lazy, exactly like the gameplay one).

### Endpoints (external URL -> route file)

| Method | External URL | Auth |
|---|---|---|
| POST | `/guess/api/admin/login` | pre-auth nonce + origin check (see below) |
| POST | `/guess/api/admin/logout` | admin session + CSRF |
| GET | `/guess/api/admin/session` | admin session (read-only) |
| POST | `/guess/api/admin/sessions/revoke-others` | admin session + CSRF |
| GET | `/guess/api/admin/forum-users` | admin session (read-only) |
| GET | `/guess/api/admin/forum-users/:forumUserId` | admin session (read-only) |
| POST | `/guess/api/admin/forum-users/:forumUserId/eligibility-override` | admin session + CSRF |
| GET | `/guess/api/admin/moderation/queue` | admin session (read-only) |
| GET | `/guess/api/admin/moderation/:forumPostId` | admin session (read-only) |
| POST | `/guess/api/admin/moderation/:forumPostId/approve` | admin session + CSRF |
| POST | `/guess/api/admin/moderation/:forumPostId/reject` | admin session + CSRF |
| POST | `/guess/api/admin/moderation/:forumPostId/edit` | admin session + CSRF |
| GET | `/guess/api/admin/import-runs` | admin session (read-only) |
| GET | `/guess/api/admin/import-runs/:importRunId` | admin session (read-only) |
| POST | `/guess/api/admin/import-runs/trigger` | admin session + CSRF |

**Daily-challenge draft/generate/publish controls were deliberately not
built.** Stage 3's `getOrPublishTodaysDailyChallenge` has no draft/preview
concept at all - the first player request for a calendar day publishes it
automatically and idempotently. Adding admin "draft/generate/publish"
buttons on top of that would be a misleading stub implying a workflow that
doesn't exist; building the real thing would mean redesigning Stage 3's
daily-challenge model, which is out of this stage's scope.

### Admin session & CSRF - a separate cookie from the player session

- `guess_admin_session` (`src/http/admin-session.ts`): `HttpOnly`,
  `SameSite=Strict` (stricter than the player cookie's `Lax`), `Path=/guess`
  (not `/guess/admin` - so it reaches both future admin pages and every
  `/guess/api/admin/...` route), `Secure` in production. 12-hour explicit
  lifetime (`ADMIN_SESSION_MAX_AGE_MS`), capped by a 7-day absolute maximum
  (`ADMIN_SESSION_ABSOLUTE_MAX_MS`) regardless of renewal. Only the SHA-256
  hash of the raw token is ever persisted (`admin_session.session_token_hash`).
- **Sliding renewal/rotation only ever happens via a mutating (CSRF-checked)
  endpoint** (`requireAdminSessionAndCsrf`), never via the read-only
  `GET /guess/api/admin/session` check (`requireAdminSession`) - so "GET
  never mutates state" holds by construction, not by convention. Once a
  session is within `ADMIN_SESSION_ROTATION_WINDOW_MS` (3h) of expiry, the
  next mutating call issues a fresh raw token + cookie and invalidates the
  old one.
- **Deactivating an admin account (`admin_user.is_active = false`) kills
  every outstanding session for that account immediately** -
  `requireAdminSession` joins against `admin_user.is_active` on every check,
  not just at login time.
- `POST /guess/api/admin/logout` revokes the current session.
  `POST /guess/api/admin/sessions/revoke-others` revokes every OTHER active
  session for the same admin (never the caller's own) - the same
  `revokeAllSessionsForAdmin` primitive a future password-change flow would
  reuse, though no change-password endpoint exists in this stage.

### Login CSRF - the request a post-login token structurally cannot protect

`POST /guess/api/admin/login` cannot require an admin CSRF token (no admin
session exists yet to have issued one). Defended instead by two independent
checks, both required:

1. **Strict Origin/Sec-Fetch-Site validation** (`src/http/origin-check.ts`,
   `requireSameOriginRequest`) against `GUESS_APP_ORIGIN` - fails closed if
   neither header is present.
2. **A pre-auth nonce tied to the anonymous player session** - the login
   request must carry a valid, already-bootstrapped player-session cookie
   PLUS its own `X-Guess-CSRF` header, verified via the exact same
   `authenticateAndVerifyCsrf` every gameplay mutation already uses (not a
   reimplementation). An attacker's cross-site form has no way to read a
   victim's player-session CSRF token, mirroring exactly why that mechanism
   already protects gameplay mutations.

Every authenticated admin mutation (`approve`/`reject`/`edit`/
`eligibility-override`/`import-runs/trigger`/`logout`/`revoke-others`)
requires a **separate, admin-scoped** CSRF token (`X-Guess-Admin-CSRF`
header, hash-only in `admin_session.csrf_token_hash`, constant-time
verified) - never the player-session token.

### Login throttling - two independent, non-enumerating layers

- **Per-IP** (`RATE_LIMITS.adminLogin`, 10/5min): the existing Postgres
  fixed-window mechanism, reused as-is. A trip returns 429 with
  `Retry-After` - safe to reveal, since it says nothing about any specific
  account.
- **Per-account** (`admin_user.failed_login_count`/`locked_until`,
  `MAX_FAILED_LOGIN_ATTEMPTS = 5`, `ACCOUNT_LOCKOUT_MS = 15min`): a locked
  account fails with the **exact same** 401 `invalid_credentials` shape as
  a wrong password or an unknown email - never a distinguishable status a
  client could use to learn "this account exists and is currently locked."
- **Constant-shape enumeration resistance**: unknown email, wrong password,
  locked account, and deactivated account all throw the identical
  `InvalidAdminCredentialsError`. An unknown email still performs a real
  Argon2id `verify()` against a fixed dummy hash
  (`src/admin/password.ts`'s `verifyAgainstDummyHash`) so response timing
  doesn't become a second oracle alongside the response body.

### Password hashing

Argon2id via `@node-rs/argon2`, explicit parameters only
(`src/admin/config.ts`'s `ARGON2_PARAMS`: 19 MiB memory, 2 iterations,
1 thread - OWASP's baseline recommendation), never the library's own
defaults implicitly. The exact same wrapper (`src/admin/password.ts`) is
used by both the login-verification path and `scripts/create-admin.ts`, so
the two can never drift apart.

### Audit trail

Append-only `admin_audit_event` (actor, action, target type/id, request
correlation id, structured JSON metadata, timestamp) - written via
`src/admin/audit.ts`'s `recordAuditEvent`, never a direct table write from
a handler. Every mutating admin action is audited: `admin.login_success`/
`admin.login_failed` (with a `reason` never exposed to the client),
`admin.logout`, `admin.revoke_other_sessions`, `eligibility.override`
(before/after value), `moderation.approve`/`moderation.reject`
(reject's optional `reason` lives ONLY in the audit metadata, never on
`forum_post` itself - there is no reject-reason column)/`moderation.edit`,
and `import.trigger`. Metadata never carries a password, hash, raw session/
CSRF token, or raw post content - enforced by handler discipline (every
call site builds the metadata object field-by-field, never
`{...someDomainRecord}`), verified by the redaction test in
`tests/http/routes-admin.test.ts`.

### Moderation - optimistic concurrency, never a lost update

`forum_post.moderation_version` (new column, Stage 5 migration) is an
integer bumped on every approve/reject/edit. Every mutation requires the
caller's last-read `expectedVersion`; a mismatch is a genuinely atomic,
database-level conditional `UPDATE ... WHERE id = $1 AND moderation_version
= $2 RETURNING *` in the real Drizzle repository (not a read-then-write
race) and returns 409 `moderation_conflict`. `edit` additionally inserts a
`ForumPostRevision` (capturing the previous `clean_content`) in the same
transaction as the version-checked update - `raw_content` is never touched
by any admin action; the immutability trigger from Stage 1 still applies
unchanged.

### Source URLs - reconstructed, never accepted

`src/admin/source-url.ts`'s `buildForumPostSourceUrl` builds
`https://mitmachim.top/post/{pid}` server-side from a validated numeric
`forum_pid` and the same hardcoded origin the importer's fetch client uses
(`src/lib/nodebb-origin.ts`, the one shared constant - admin code has no
import path that could transitively reach fetch capability). Never accepts
a caller-supplied URL/host. Returns a string only; opening it is something
an admin's own browser does, this server never fetches it.

### Import trigger - bounded, fixed budgets, no overlap

`POST /guess/api/admin/import-runs/trigger` accepts an empty body only (Zod
`.strict()`) - a caller can never supply an origin/URL/host/budget
override. Always uses the importer's own fixed `DEFAULT_IMPORT_BUDGETS`/
`DEFAULT_PACING_MS`. Concurrency is guarded by a PostgreSQL session-level
advisory lock (`src/admin/drizzle-import-lock.ts`,
`pg_try_advisory_lock`/`pg_advisory_unlock` on a fixed, hardcoded key -
never caller/request input).

**Connection-pinning correction (Cycle 10):** an earlier version of this
lock issued `pg_try_advisory_lock`/`pg_advisory_unlock` as two independent
Drizzle `db.execute()` calls, each of which could be routed to a
*different* pooled connection by postgres-js - since a session-level
advisory lock is tied to the specific connection that acquired it, an
unlock on the wrong connection is a silent no-op (`pg_advisory_unlock`
just returns `false`, it does not raise), which could leave the lock held
forever. The corrected design (`src/admin/import-lock.ts`'s `withLock`,
implemented for real by `createDrizzleImportLock`) uses `rawSql.reserve()`
(`src/db/client.ts`'s `getRawSql()`, the same underlying postgres-js
client/pool Drizzle itself wraps) to pin ONE physical connection for the
entire acquire -> run(importer callback) -> unlock -> release lifecycle -
both SQL calls are guaranteed to run on that same reserved connection.
Semantics: if `pg_try_advisory_lock` returns false, the callback never
runs and `withLock` resolves to `{acquired:false}` (mapped to
`ImportAlreadyRunningError` / the existing 409 response) without ever
opening an `ImportRun`; if acquired, the callback runs exactly once;
unlock is attempted exactly once afterward regardless of whether the
callback succeeded or threw; the reserved connection is always released
in an outer `finally`, even if `reserve()`'s own connection is never
obtained (a `reserve()` failure propagates directly, since there is
nothing to unlock/release in that case) or if the callback and the unlock
both fail (the callback's original error always wins - the cleanup
failure is logged via the redacting `Logger`, never in the same message,
and never replaces or swallows the real error). Because
`pg_try_advisory_lock` is the non-blocking TRY variant (never the blocking
`pg_advisory_lock`), the endpoint can never hang waiting for the lock
itself. This is a session-level lock on one reserved connection, not a
database transaction - nothing here holds a transaction open across the
importer's outbound pacing/network waits.

**Verified at the adapter/wiring level** (`tests/admin/drizzle-import-lock.test.ts`,
against `tests/admin/fake-reserve-sql.ts` - a fake reserve-capable
postgres-js client that models real advisory-lock semantics: the lock is
global, held by at most one connection, and unlock only succeeds from the
holding connection): lock unavailable (callback never runs, no unlock
attempted), import success (lock+unlock share one connection id, exactly
one release), import failure (callback's error propagates, unlock still
runs, connection still released), unlock failure (original callback error
still wins over the unlock failure, connection still released, failure
logged without the original error's content), reserve/acquire failure
(propagates directly, nothing to release), and concurrent requests (the
loser never runs its callback; the two attempts use distinct reserved
connections, exactly matching real pooling behavior).

**Still UNVERIFIED - real PostgreSQL advisory-lock semantics remain a
later integration check:** there is no PostgreSQL in this environment, so
this has never run against a real database or under real concurrent load.
What the fake test proves is the *adapter's own contract* - that this
code always uses one pinned connection for both SQL calls, in the right
order, with the right cleanup guarantees - not that real PostgreSQL's
`pg_try_advisory_lock`/`pg_advisory_unlock` behave as documented under
real load (a well-established PostgreSQL guarantee, but not one this
cycle executed), nor that a process crash mid-hold reliably releases the
lock when its connection closes (also documented PostgreSQL behavior, not
independently confirmed here).

The in-memory test fake (`src/admin/import-lock.ts`'s
`createInMemoryImportLock`) continues to exercise the SERVICE-level
overlap logic (`triggerImportRun` throws `ImportAlreadyRunningError` for a
concurrent second call) with a real Node concurrency race. This request
runs the importer **synchronously** within the HTTP request/response
cycle (matching Stage 2's existing single-function design) - a
sufficiently large/slow import could be a reverse-proxy timeout risk in
production; an async job-queue redesign is future, out-of-scope work if
that turns out to matter. Never contacts mitmachim.top - only synthetic/
in-memory/fake clients were ever exercised, in this cycle or the one that
introduced this endpoint.

### Pagination/sorting/validation

Every list endpoint (`forum-users`, `moderation/queue`, `import-runs`)
shares `parsePaginationQuery`/`parseEnumQuery`/`parseOptionalEnumQuery`
(`src/http/validation.ts`): bounded `page`/`pageSize` (max 100,
`ADMIN_PAGE_SIZE_MAX`), and every sort field/direction/status filter is
checked against an explicit allowlist - never interpolated into a query.
`effectiveEligibleOnly` filtering (forum-users) evaluates
`resolveEligibility` (the exact same function gameplay's curated-pool
repository uses) in application code after pushing every other filter down
to SQL - a deliberate DB-efficiency-vs-correctness tradeoff documented in
`drizzle-forum-user-repository.ts`, acceptable at the admin surface's
expected row count.

### IDOR / access control

Every admin endpoint requires a live admin session - `authenticateAdminOnly`
(GET) or `authenticateAdminAndVerifyCsrf` (mutations), both from
`src/http/admin-auth-helpers.ts`. There is no notion of "this admin can see
this forum user/post/import-run but not that one" (unlike gameplay's
per-session game ownership) - any authenticated admin can act on any
resource, which is the intended model for this stage; nothing here narrows
that further.

### `AGENTS.md`/`CLAUDE.md` cleanup

Next.js 16.3+'s `next dev` auto-generates `AGENTS.md`/`CLAUDE.md` at the
project root pointing agents at its own bundled docs (a legitimate
framework feature, confirmed against `node_modules/next/dist/server/lib/
generate-agent-files.js` and the bundled upgrade guide - not injected
content). Both files were deleted from the working tree and
`apps/guess/.gitignore` now explicitly excludes `/AGENTS.md`/`/CLAUDE.md`,
so they can regenerate locally on every `next dev` run without ever
entering a commit.

### Testing philosophy for this stage

54 admin-specific tests (323 total in the full suite, zero requiring
PostgreSQL): domain-level (`tests/admin/*.test.ts` - password hashing/
verification, login orchestration including nonexistent-account/wrong-
password/locked/deactivated equivalence and lockout-then-recovery, session
primitives including rotation/revocation/deactivation-kills-session,
optimistic concurrency + revision creation, import overlap-lock races, and
the connection-pinning contract in `drizzle-import-lock.test.ts`) and full
HTTP integration (`tests/http/routes-admin.test.ts` - real `Request`/`Response`
objects against a fully in-memory `AdminHttpDeps`: cookie flags/scope
including production `Secure`, login CSRF via both the origin check and the
pre-auth nonce, per-IP rate limiting, authenticated-CSRF enforcement, IDOR/
unauthorized rejection, pagination/sort-allowlist validation, audited
eligibility overrides, optimistic-conflict 409s, raw-content boundary
(present in the single-post detail response, absent from the queue list
response), import-trigger overlap, and log-line redaction of the password/
session token/CSRF token across a full login+logout flow).

**Not exercised against a real database by any test:** the Drizzle-backed
admin adapters (`drizzle-admin-session-repository.ts`,
`drizzle-admin-user-repository.ts`, `drizzle-audit-repository.ts`,
`drizzle-forum-user-repository.ts`, `drizzle-moderation-repository.ts`,
`drizzle-import-run-repository.ts`) - no PostgreSQL in this environment,
same reasoning as every other Drizzle adapter in this codebase. The
`moderation-repository`'s conditional-UPDATE concurrency guarantee is
expected to be genuinely atomic at the database level (it is a single SQL
statement, not a read-then-write race) but this has not been executed
against real Postgres.

`drizzle-import-lock.ts` is the one piece of this stage with a dedicated
adapter-level test (`tests/admin/drizzle-import-lock.test.ts`, see "Import
trigger" above) proving its connection-pinning contract against a fake
reserve-capable client - but real PostgreSQL's advisory-lock semantics
under genuine concurrent load and genuine connection pooling remain
unverified until a real database exists, exactly as documented there.

## Approval-gated (not in this repository's autonomous scope)

The following remain explicitly held for a separate, human-approved cycle,
regardless of anything implied elsewhere:

- Any Docker image/service for this app (`guess-web`, `guess-db`).
- Any Caddy configuration change (a single `/guess/*` prefix rule is all
  that should ever be needed, per the architecture report).
- Any `.env`/`.env.prod` addition (e.g. `GUESS_DATABASE_URL`, admin
  bootstrap variables).
- Actually running a migration (`drizzle-kit migrate`) against any
  database, including a non-production one.
- Running `scripts/create-admin.ts` for real.
- A backup/restore job for the isolated database (the existing
  `infrastructure/scripts/backup-db.sh` only covers the main ExtSync
  Postgres and has no awareness of this one).
- Actually running `runImport` for real (no cron job, no admin trigger, no
  production import command exists yet - `src/importer/**` is code and
  tests only in this slice).
- Actually running `createDrizzleGameUnitOfWork` against a real database
  (no HTTP route wires it up yet - `src/game/**` is domain logic and tests
  only in this slice, exercised solely via the in-memory fake).
- Deploying/serving this API for real traffic, and confirming
  `GUESS_TRUSTED_PROXY_HOP_COUNT` against the real Caddy configuration
  (see "Trusted-proxy deployment caveat" above) - the routes exist and are
  build-verified, but production dependencies (`getProductionHttpDeps`)
  have never been exercised against a live database or a live reverse
  proxy in this cycle.
- Any `.env`/`.env.prod` addition for `GUESS_APP_ORIGIN` (required by
  `getProductionAdminHttpDeps`) - not set anywhere in this cycle, and the
  admin production deps factory throws a clear, safe error if it's missing
  rather than guessing a value.
- Actually triggering `POST /guess/api/admin/import-runs/trigger` for real
  (would contact mitmachim.top) - the endpoint is code- and test-complete,
  but was never invoked against a live NodeBB or live database in this
  cycle.
- Building the admin visual UI (`/guess/admin/**` pages) - explicitly out
  of scope for this stage; only the protected API layer exists.
- Verifying the Postgres advisory-lock import-overlap guard
  (`src/admin/drizzle-import-lock.ts`) under real connection pooling and
  real concurrent load (see "Import trigger" above for the two specific
  open questions).
