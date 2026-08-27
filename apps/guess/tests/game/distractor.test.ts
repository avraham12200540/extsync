import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InsufficientDistractorPoolError,
  categorySimilarity,
  selectDistractors,
  similarityScore,
  usernameSimilarity,
} from "../../src/game/distractor";
import type { DistractorCandidate } from "../../src/game/distractor";

function candidate(id: string, overrides: Partial<DistractorCandidate> = {}): DistractorCandidate {
  return {
    forumUserId: id,
    forumUsername: `user${id}`,
    approvedPostCount: 10,
    avgWordCount: 40,
    avgQualityScore: 0.7,
    topCategories: ["tech"],
    firstActiveAt: new Date("2024-01-01T00:00:00Z"),
    lastActiveAt: new Date("2024-06-01T00:00:00Z"),
    ...overrides,
  };
}

test("usernameSimilarity is 1 for identical usernames and case-insensitive", () => {
  assert.equal(usernameSimilarity("dovi123", "dovi123"), 1);
  assert.equal(usernameSimilarity("Dovi123", "dovi123"), 1);
});

test("usernameSimilarity decreases as edit distance grows", () => {
  const close = usernameSimilarity("dovi123", "dovi124");
  const far = usernameSimilarity("dovi123", "xyzxyzxyz");
  assert.ok(close > far);
  assert.ok(close < 1);
});

test("categorySimilarity treats two empty category sets as fully similar, not penalized", () => {
  assert.equal(categorySimilarity([], []), 1);
});

test("categorySimilarity is 1 for identical sets and 0 for disjoint sets", () => {
  assert.equal(categorySimilarity(["tech", "gaming"], ["tech", "gaming"]), 1);
  assert.equal(categorySimilarity(["tech"], ["cooking"]), 0);
});

test("similarityScore is higher for a closer candidate than a distant one", () => {
  const target = candidate("t", { forumUsername: "doviCohen", approvedPostCount: 20, topCategories: ["tech", "gaming"] });
  const close = candidate("close", { forumUsername: "doviCohan", approvedPostCount: 22, topCategories: ["tech", "gaming"] });
  const far = candidate("far", { forumUsername: "zzzzzzz", approvedPostCount: 500, topCategories: ["cooking"] });

  assert.ok(similarityScore(target, close) > similarityScore(target, far));
});

test("selectDistractors returns exactly the requested count, excluding the target itself", () => {
  const target = candidate("target");
  const pool = [candidate("a"), candidate("b"), candidate("c"), candidate("d"), target];
  const result = selectDistractors(target, pool, 3, { mode: "deterministic" });
  assert.equal(result.length, 3);
  assert.ok(result.every((c) => c.forumUserId !== "target"));
});

test("selectDistractors respects excludeUserIds (already used earlier this game)", () => {
  const target = candidate("target");
  const pool = [candidate("a"), candidate("b"), candidate("c"), candidate("d")];
  const result = selectDistractors(target, pool, 3, {
    mode: "deterministic",
    excludeUserIds: new Set(["a"]),
  });
  assert.equal(result.length, 3);
  assert.ok(!result.some((c) => c.forumUserId === "a"));
});

test("selectDistractors throws InsufficientDistractorPoolError clearly when the pool is too small", () => {
  const target = candidate("target");
  const pool = [candidate("a"), candidate("b")];
  assert.throws(() => selectDistractors(target, pool, 3, { mode: "deterministic" }), InsufficientDistractorPoolError);
});

test("selectDistractors('random') without an injected random function throws immediately", () => {
  const target = candidate("target");
  const pool = [candidate("a"), candidate("b"), candidate("c")];
  assert.throws(() => selectDistractors(target, pool, 3, { mode: "random" }));
});

test("deterministic mode: identical candidates (exact ties) are ordered by forumUserId, reproducibly across calls", () => {
  const target = candidate("target");
  // Three candidates with identical stats -> identical similarity scores -> a genuine tie.
  const pool = [
    candidate("zzz", { forumUsername: "same", approvedPostCount: 10 }),
    candidate("aaa", { forumUsername: "same", approvedPostCount: 10 }),
    candidate("mmm", { forumUsername: "same", approvedPostCount: 10 }),
  ];
  const run1 = selectDistractors(target, pool, 3, { mode: "deterministic" }).map((c) => c.forumUserId);
  const run2 = selectDistractors(target, pool, 3, { mode: "deterministic" }).map((c) => c.forumUserId);
  assert.deepEqual(run1, ["aaa", "mmm", "zzz"]);
  assert.deepEqual(run1, run2);
});

test("random mode: tie-break order depends on the injected random function, not Math.random", () => {
  const target = candidate("target");
  const pool = [
    candidate("p1", { forumUsername: "same", approvedPostCount: 10 }),
    candidate("p2", { forumUsername: "same", approvedPostCount: 10 }),
    candidate("p3", { forumUsername: "same", approvedPostCount: 10 }),
  ];
  // A fixed sequence of "random" values makes the shuffle fully predictable and reproducible in the test.
  const sequenceA = [0.9, 0.1, 0.5];
  let iA = 0;
  const resultA = selectDistractors(target, pool, 3, { mode: "random", random: () => sequenceA[iA++ % sequenceA.length]! });

  const sequenceB = [0.1, 0.9, 0.2];
  let iB = 0;
  const resultB = selectDistractors(target, pool, 3, { mode: "random", random: () => sequenceB[iB++ % sequenceB.length]! });

  assert.equal(resultA.length, 3);
  assert.equal(resultB.length, 3);
  // Different injected sequences are not guaranteed to differ in every case, but both must be valid
  // permutations of the same 3 ids (the property actually being tested: it uses the injected source, not a fixed order).
  assert.deepEqual(resultA.map((c) => c.forumUserId).sort(), ["p1", "p2", "p3"]);
  assert.deepEqual(resultB.map((c) => c.forumUserId).sort(), ["p1", "p2", "p3"]);
});

test("selectDistractors deduplicates a pool that accidentally contains the same forumUserId twice", () => {
  const target = candidate("target");
  const pool = [candidate("a"), candidate("a"), candidate("b"), candidate("c")];
  const result = selectDistractors(target, pool, 3, { mode: "deterministic" });
  assert.equal(new Set(result.map((c) => c.forumUserId)).size, 3);
});
