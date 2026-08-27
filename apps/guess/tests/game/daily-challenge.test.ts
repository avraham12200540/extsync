import assert from "node:assert/strict";
import { test } from "node:test";
import { CHOICES_PER_ROUND, DAILY_ROUNDS, MAX_POSTS_PER_ROUND } from "../../src/game/config";
import {
  InsufficientDailyPoolError,
  InsufficientTargetPostsError,
  buildDailyChallengePlan,
  computeDailySeed,
  computeIsraelDateKey,
} from "../../src/game/daily-challenge";
import type { EligibleTarget } from "../../src/game/daily-challenge";

function makePool(size: number, postsPerUser: number = MAX_POSTS_PER_ROUND): EligibleTarget[] {
  return Array.from({ length: size }, (_, i) => ({
    forumUserId: `user-${String(i).padStart(3, "0")}`,
    forumUsername: `synthetic${i}`,
    approvedPostCount: postsPerUser,
    avgWordCount: 40 + i,
    avgQualityScore: 0.6,
    topCategories: ["tech"],
    firstActiveAt: new Date("2024-01-01T00:00:00Z"),
    lastActiveAt: new Date("2024-06-01T00:00:00Z"),
    approvedPostIds: Array.from({ length: postsPerUser }, (_, p) => `post-${String(i).padStart(3, "0")}-${p}`),
  }));
}

const SEED_INPUT = { dateKey: "2026-08-26", version: 1, serverSecret: "test-only-secret-never-real" };

test("computeIsraelDateKey uses the real Asia/Jerusalem IANA timezone, not a hand-rolled offset", () => {
  // Late evening UTC during Israel Daylight Time (UTC+3 in August) rolls
  // over to the next Israel calendar day - this is exactly what a naive
  // fixed-offset approximation gets wrong at DST boundaries.
  assert.equal(computeIsraelDateKey(new Date("2026-08-26T21:30:00Z")), "2026-08-27");
  assert.equal(computeIsraelDateKey(new Date("2026-08-26T12:00:00Z")), "2026-08-26");
  assert.equal(computeIsraelDateKey(new Date("2026-08-26T20:59:00Z")), "2026-08-26");
});

test("computeDailySeed is deterministic for identical inputs", () => {
  assert.equal(computeDailySeed(SEED_INPUT), computeDailySeed({ ...SEED_INPUT }));
});

test("computeDailySeed differs when dateKey, version, or serverSecret differ", () => {
  const base = computeDailySeed(SEED_INPUT);
  assert.notEqual(base, computeDailySeed({ ...SEED_INPUT, dateKey: "2026-08-27" }));
  assert.notEqual(base, computeDailySeed({ ...SEED_INPUT, version: 2 }));
  assert.notEqual(base, computeDailySeed({ ...SEED_INPUT, serverSecret: "different-secret" }));
});

test("buildDailyChallengePlan is fully deterministic: same pool + same seed input -> identical output", () => {
  const pool = makePool(30);
  const plan1 = buildDailyChallengePlan(pool, SEED_INPUT);
  const plan2 = buildDailyChallengePlan(pool, { ...SEED_INPUT });
  assert.deepEqual(plan1, plan2);
});

test("buildDailyChallengePlan does not depend on the incoming pool array's order (stable canonical ordering)", () => {
  const pool = makePool(30);
  const shuffled = [...pool].reverse();
  const plan1 = buildDailyChallengePlan(pool, SEED_INPUT);
  const plan2 = buildDailyChallengePlan(shuffled, SEED_INPUT);
  assert.deepEqual(plan1, plan2);
});

test("buildDailyChallengePlan produces exactly DAILY_ROUNDS rounds with correct post/choice counts and the target included in its own choices", () => {
  const pool = makePool(30);
  const plan = buildDailyChallengePlan(pool, SEED_INPUT);
  assert.equal(plan.length, DAILY_ROUNDS);
  for (const round of plan) {
    assert.equal(round.postIds.length, MAX_POSTS_PER_ROUND);
    assert.equal(new Set(round.postIds).size, MAX_POSTS_PER_ROUND, "post ids must be distinct");
    assert.equal(round.choiceUserIds.length, CHOICES_PER_ROUND);
    assert.equal(new Set(round.choiceUserIds).size, CHOICES_PER_ROUND, "choice user ids must be distinct");
    assert.ok(round.choiceUserIds.includes(round.targetForumUserId));
  }
});

test("buildDailyChallengePlan does not repeat a target across the day's rounds when the pool permits", () => {
  const pool = makePool(30);
  const plan = buildDailyChallengePlan(pool, SEED_INPUT);
  const targets = plan.map((r) => r.targetForumUserId);
  assert.equal(new Set(targets).size, targets.length);
});

test("buildDailyChallengePlan orders rounds 1..DAILY_ROUNDS", () => {
  const pool = makePool(30);
  const plan = buildDailyChallengePlan(pool, SEED_INPUT);
  assert.deepEqual(
    plan.map((r) => r.orderInGame),
    Array.from({ length: DAILY_ROUNDS }, (_, i) => i + 1),
  );
});

test("a different seed version generally yields a different plan (proven via the seed itself differing, and typically the selection too)", () => {
  const pool = makePool(30);
  const planV1 = buildDailyChallengePlan(pool, SEED_INPUT);
  const planV2 = buildDailyChallengePlan(pool, { ...SEED_INPUT, version: 2 });
  assert.notEqual(computeDailySeed(SEED_INPUT), computeDailySeed({ ...SEED_INPUT, version: 2 }));
  // With 30 candidates for 5 slots, an identical full ordered selection across a version bump is vanishingly unlikely.
  assert.notDeepEqual(planV1, planV2);
});

test("throws InsufficientDailyPoolError clearly when fewer than DAILY_ROUNDS eligible targets exist", () => {
  const pool = makePool(DAILY_ROUNDS - 1);
  assert.throws(() => buildDailyChallengePlan(pool, SEED_INPUT), InsufficientDailyPoolError);
});

test("throws InsufficientTargetPostsError if a candidate has fewer than MAX_POSTS_PER_ROUND approved posts (defensive - caller should have pre-filtered)", () => {
  const pool = makePool(10, MAX_POSTS_PER_ROUND - 1);
  assert.throws(() => buildDailyChallengePlan(pool, SEED_INPUT), InsufficientTargetPostsError);
});

test("snapshot immutability in practice: rebuilding from the unchanged original snapshot reproduces the exact published plan, while rebuilding from a since-mutated pool can differ - this is why a published challenge's rows must be persisted once and never recomputed on read", () => {
  const originalPool = makePool(30);
  const published = buildDailyChallengePlan(originalPool, SEED_INPUT);

  // The published plan is reproducible from the frozen snapshot alone...
  const rebuiltFromSameSnapshot = buildDailyChallengePlan(originalPool, SEED_INPUT);
  assert.deepEqual(rebuiltFromSameSnapshot, published);

  // ...but simulating "moderation/import changes after publication" (here:
  // one of the actually-selected targets becomes ineligible and drops out
  // of the pool, the way a rejected post could shrink someone below the
  // approved-post threshold) changes what a *fresh* construction would
  // produce. A repository that persisted `published` once and always
  // reads it back is correctly immune to this; a repository that instead
  // re-ran buildDailyChallengePlan against the live pool on every read
  // would NOT be - which is exactly the bug this snapshot design avoids.
  const removedTargetId = published[0]!.targetForumUserId;
  const poolWithOneTargetRemoved = originalPool.filter((u) => u.forumUserId !== removedTargetId);
  const rebuiltFromMutatedPool = buildDailyChallengePlan(poolWithOneTargetRemoved, SEED_INPUT);
  assert.notDeepEqual(rebuiltFromMutatedPool, published);
});
