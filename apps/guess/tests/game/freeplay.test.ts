import assert from "node:assert/strict";
import { test } from "node:test";
import { CHOICES_PER_ROUND, FREEPLAY_ROUNDS, MAX_POSTS_PER_ROUND } from "../../src/game/config";
import { InsufficientTargetPostsError } from "../../src/game/daily-challenge";
import type { EligibleTarget } from "../../src/game/daily-challenge";
import { InsufficientDistractorPoolError } from "../../src/game/distractor";
import { InsufficientFreeplayPoolError, buildFreeplayRoundPlan } from "../../src/game/freeplay";

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

/** A fixed deterministic sequence, injected as "cryptographic randomness" for reproducible tests - never Math.random. */
function fixedRandom(seedValues: number[] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]): () => number {
  let i = 0;
  return () => seedValues[i++ % seedValues.length]!;
}

test("buildFreeplayRoundPlan produces exactly FREEPLAY_ROUNDS rounds with correct post/choice counts", () => {
  const pool = makePool(30);
  const plan = buildFreeplayRoundPlan(pool, fixedRandom());
  assert.equal(plan.length, FREEPLAY_ROUNDS);
  for (const round of plan) {
    assert.equal(round.postIds.length, MAX_POSTS_PER_ROUND);
    assert.equal(new Set(round.postIds).size, MAX_POSTS_PER_ROUND);
    assert.equal(round.choiceUserIds.length, CHOICES_PER_ROUND);
    assert.equal(new Set(round.choiceUserIds).size, CHOICES_PER_ROUND);
    assert.ok(round.choiceUserIds.includes(round.targetForumUserId));
  }
});

test("does not repeat a target across rounds when the pool is large enough (>= FREEPLAY_ROUNDS distinct targets)", () => {
  const pool = makePool(30);
  const plan = buildFreeplayRoundPlan(pool, fixedRandom());
  const targets = plan.map((r) => r.targetForumUserId);
  assert.equal(new Set(targets).size, FREEPLAY_ROUNDS);
});

test("orders rounds 1..FREEPLAY_ROUNDS", () => {
  const pool = makePool(30);
  const plan = buildFreeplayRoundPlan(pool, fixedRandom());
  assert.deepEqual(
    plan.map((r) => r.orderInGame),
    Array.from({ length: FREEPLAY_ROUNDS }, (_, i) => i + 1),
  );
});

test("with a pool smaller than FREEPLAY_ROUNDS, targets repeat via round-robin instead of throwing", () => {
  // 6 distinct eligible targets, but still enough for 3 distractors each round.
  const pool = makePool(6);
  const plan = buildFreeplayRoundPlan(pool, fixedRandom());
  assert.equal(plan.length, FREEPLAY_ROUNDS);
  const targets = plan.map((r) => r.targetForumUserId);
  // Necessarily repeats (10 rounds, 6 distinct targets) - but every distinct target used should appear roughly evenly (round-robin, not clustered).
  assert.equal(new Set(targets).size, 6);
  const counts = new Map<string, number>();
  for (const t of targets) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const count of counts.values()) {
    assert.ok(count === 1 || count === 2, `expected round-robin spread (1 or 2 uses), got ${count}`);
  }
});

test("uses the injected random function, not a fixed/hardcoded order - two different injected sequences can produce different plans", () => {
  const pool = makePool(30);
  const planA = buildFreeplayRoundPlan(pool, fixedRandom([0.05, 0.99, 0.33, 0.71, 0.12, 0.88, 0.44, 0.6, 0.02]));
  const planB = buildFreeplayRoundPlan(pool, fixedRandom([0.91, 0.03, 0.5, 0.15, 0.77, 0.28, 0.6, 0.41, 0.9]));
  assert.notDeepEqual(planA, planB);
});

test("free-play is not required to be deterministic/reproducible across independent random sources (unlike daily)", () => {
  const pool = makePool(30);
  const random1 = fixedRandom([0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77, 0.88, 0.99]);
  const random2 = fixedRandom([0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77, 0.88, 0.99]);
  // Same injected sequence -> same result is fine (the function itself is
  // pure), but nothing about buildFreeplayRoundPlan promises reproducibility
  // across different real crypto-random calls the way daily does.
  const planA = buildFreeplayRoundPlan(pool, random1);
  const planB = buildFreeplayRoundPlan(pool, random2);
  assert.deepEqual(planA, planB);
});

test("throws InsufficientFreeplayPoolError clearly when the pool is entirely empty", () => {
  assert.throws(() => buildFreeplayRoundPlan([], fixedRandom()), InsufficientFreeplayPoolError);
});

test("throws InsufficientDistractorPoolError clearly when the pool is too small to supply 3 distractors even with the repeat-fallback relaxed", () => {
  const pool = makePool(2); // only 2 total eligible users - can never supply 3 distinct distractors
  assert.throws(() => buildFreeplayRoundPlan(pool, fixedRandom()), InsufficientDistractorPoolError);
});

test("throws InsufficientTargetPostsError if a candidate has fewer than MAX_POSTS_PER_ROUND approved posts", () => {
  const pool = makePool(10, MAX_POSTS_PER_ROUND - 1);
  assert.throws(() => buildFreeplayRoundPlan(pool, fixedRandom()), InsufficientTargetPostsError);
});

test("each round's 5 posts all belong to that round's own target", () => {
  const pool = makePool(30);
  const plan = buildFreeplayRoundPlan(pool, fixedRandom());
  for (const round of plan) {
    const targetIndex = round.targetForumUserId.replace("user-", "");
    for (const postId of round.postIds) {
      assert.ok(postId.startsWith(`post-${targetIndex}-`), `post ${postId} does not belong to target ${round.targetForumUserId}`);
    }
  }
});
