import assert from "node:assert/strict";
import { test } from "node:test";
import { toGameView, toRoundView, toShareResultsView } from "../../src/game/view-models";
import type { GameRecord, RoundRecord } from "../../src/game/unit-of-work";

// forumUserId/forumPostId values are deliberately distinctive strings
// (never plausible as ordinary visible text) so a substring scan of the
// serialized view can prove they never leak, in either direction.
const TARGET_FORUM_USER_ID = "SECRET-TARGET-FORUM-USER-ID-000";
const DISTRACTOR_FORUM_USER_IDS = ["SECRET-DISTRACTOR-A", "SECRET-DISTRACTOR-B", "SECRET-DISTRACTOR-C"];
const FORUM_POST_IDS = ["SECRET-POST-1", "SECRET-POST-2", "SECRET-POST-3", "SECRET-POST-4", "SECRET-POST-5"];

function makeActiveRound(overrides: Partial<RoundRecord> = {}): RoundRecord {
  return {
    id: "round-opaque-1",
    gameId: "game-opaque-1",
    orderInGame: 1,
    targetForumUserId: TARGET_FORUM_USER_ID,
    status: "active",
    hintsRevealedCount: 2,
    wrongGuessCount: 1,
    scoreAwarded: 0,
    activatedAt: new Date("2026-01-01T00:00:00Z"),
    resolvedAt: null,
    expiresAt: new Date("2026-01-01T00:02:00Z"),
    posts: FORUM_POST_IDS.map((forumPostId, i) => ({
      displayOrder: i + 1,
      forumPostId,
      cleanContent: `visible sanitized text for post ${i + 1}`,
      revealed: i < 2,
    })),
    choices: [
      { choiceId: "choice-opaque-1", forumUserId: TARGET_FORUM_USER_ID, username: "correctUsername", displayPosition: 3 },
      { choiceId: "choice-opaque-2", forumUserId: DISTRACTOR_FORUM_USER_IDS[0]!, username: "distractorA", displayPosition: 1 },
      { choiceId: "choice-opaque-3", forumUserId: DISTRACTOR_FORUM_USER_IDS[1]!, username: "distractorB", displayPosition: 2 },
      { choiceId: "choice-opaque-4", forumUserId: DISTRACTOR_FORUM_USER_IDS[2]!, username: "distractorC", displayPosition: 4 },
    ],
    ...overrides,
  };
}

const FORBIDDEN_KEYS = [
  "targetForumUserId",
  "forumUserId",
  "forumUid",
  "forumUserslug",
  "forumPid",
  "forumTid",
  "forumPostId",
  "rawContent",
  "raw_content",
  "moderationStatus",
  "moderation_status",
  "sourceUrl",
  "seed",
  "isCorrect",
];

function assertNoForbiddenKeys(obj: unknown): void {
  const json = JSON.stringify(obj);
  for (const key of FORBIDDEN_KEYS) {
    assert.doesNotMatch(json, new RegExp(`"${key}"`), `serialized view must never contain the key "${key}"`);
  }
}

function assertNoForbiddenValues(obj: unknown, forbiddenValues: string[]): void {
  const json = JSON.stringify(obj);
  for (const value of forbiddenValues) {
    assert.doesNotMatch(json, new RegExp(value), `serialized view must never contain the value "${value}"`);
  }
}

test("pre-resolution RoundView never leaks the target's forum_user_id, in key or value", () => {
  const round = makeActiveRound();
  const view = toRoundView(round);
  assertNoForbiddenKeys(view);
  assertNoForbiddenValues(view, [TARGET_FORUM_USER_ID, ...DISTRACTOR_FORUM_USER_IDS]);
});

test("pre-resolution RoundView never reveals which choice is correct", () => {
  const round = makeActiveRound();
  const view = toRoundView(round);
  assert.equal(view.correctChoiceId, null);
  assert.equal(view.correctUsername, null);
  assert.equal(view.scoreAwarded, null);
});

test("pre-resolution RoundView only includes revealed posts, never unrevealed ones", () => {
  const round = makeActiveRound({ hintsRevealedCount: 2 });
  const view = toRoundView(round);
  assert.equal(view.revealedPosts.length, 2);
  assert.deepEqual(
    view.revealedPosts.map((p) => p.displayOrder),
    [1, 2],
  );
});

test("pre-resolution RoundView exposes forum_post ids nowhere - only sanitized clean text", () => {
  const round = makeActiveRound();
  const view = toRoundView(round);
  assertNoForbiddenValues(view, FORUM_POST_IDS);
  assert.ok(view.revealedPosts.every((p) => p.cleanText.startsWith("visible sanitized text")));
});

test("choices expose only choiceId + username, never the underlying forumUserId", () => {
  const round = makeActiveRound();
  const view = toRoundView(round);
  for (const choice of view.choices) {
    assert.equal(Object.keys(choice).sort().join(","), "choiceId,username");
  }
});

test("currentAvailableScore reflects hints/wrong-guesses while active, and drops to 0 once resolved", () => {
  const active = toRoundView(makeActiveRound({ hintsRevealedCount: 1, wrongGuessCount: 0 }));
  assert.equal(active.currentAvailableScore, 100);

  const resolved = toRoundView(
    makeActiveRound({ status: "resolved_correct", resolvedAt: new Date(), scoreAwarded: 75 }),
  );
  assert.equal(resolved.currentAvailableScore, 0);
});

test("after resolution, the correct choice's opaque id and visible username ARE revealed - but not the forumUserId", () => {
  const round = makeActiveRound({ status: "resolved_correct", resolvedAt: new Date(), scoreAwarded: 55 });
  const view = toRoundView(round);
  assert.equal(view.correctChoiceId, "choice-opaque-1");
  assert.equal(view.correctUsername, "correctUsername");
  assert.equal(view.scoreAwarded, 55);
  assertNoForbiddenValues(view, [TARGET_FORUM_USER_ID]);
});

test("GameView never leaks the round plan or any forum id", () => {
  const game: GameRecord = {
    id: "game-1",
    playerSessionId: "session-1",
    mode: "daily",
    dailyChallengeId: "dc-1",
    roundPlan: [{ targetForumUserId: TARGET_FORUM_USER_ID, postIds: FORUM_POST_IDS, choiceUserIds: [TARGET_FORUM_USER_ID, ...DISTRACTOR_FORUM_USER_IDS] }],
    totalRounds: 5,
    currentRoundIndex: 1,
    totalScore: 100,
    status: "in_progress",
    shareToken: null,
    startedAt: new Date(),
    completedAt: null,
    expiresAt: new Date(),
  };
  const view = toGameView(game);
  assertNoForbiddenValues(view, [TARGET_FORUM_USER_ID, ...DISTRACTOR_FORUM_USER_IDS, ...FORUM_POST_IDS]);
  assert.equal("roundPlan" in view, false);
  assert.equal("playerSessionId" in view, false);
  assert.equal("dailyChallengeId" in view, false);
});

test("ShareResultsView carries no session id and no round-level data", () => {
  const game: GameRecord = {
    id: "game-1",
    playerSessionId: "session-1",
    mode: "freeplay",
    dailyChallengeId: null,
    roundPlan: [],
    totalRounds: 10,
    currentRoundIndex: 10,
    totalScore: 500,
    status: "completed",
    shareToken: "share-token-1",
    startedAt: new Date(),
    completedAt: new Date(),
    expiresAt: new Date(),
  };
  const view = toShareResultsView(game);
  assert.equal(Object.keys(view).sort().join(","), "completedAt,mode,totalRounds,totalScore");
  assertNoForbiddenValues(view, ["session-1", "game-1"]);
});
