import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_WRONG_GUESSES, ROUND_EXPIRY_MS, SCORE_CURVE, WRONG_GUESS_PENALTY } from "../../src/game/config";
import {
  ForbiddenGameAccessError,
  GameNotFoundError,
  InvalidChoiceError,
  RoundNotActiveError,
  createInMemoryGameUnitOfWork,
} from "../../src/game/unit-of-work";
import type { ForumContentLookup, GameUnitOfWork, RoundPlanEntry } from "../../src/game/unit-of-work";

let idCounter = 0;
function freshId(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

function makeUow(): GameUnitOfWork {
  return createInMemoryGameUnitOfWork({ generateId: freshId });
}

function makeRoundPlan(targetIndex: number, roundCount: number): RoundPlanEntry[] {
  return Array.from({ length: roundCount }, (_, r) => ({
    targetForumUserId: `target-${targetIndex}-${r}`,
    postIds: Array.from({ length: 5 }, (_, p) => `post-${targetIndex}-${r}-${p}`),
    choiceUserIds: [`target-${targetIndex}-${r}`, `distractor-${targetIndex}-${r}-a`, `distractor-${targetIndex}-${r}-b`, `distractor-${targetIndex}-${r}-c`],
  }));
}

const content: ForumContentLookup = {
  async getCleanContent(forumPostId) {
    return `clean text for ${forumPostId}`;
  },
  async getUsername(forumUserId) {
    return `username-${forumUserId}`;
  },
};

const NOW = new Date("2026-01-01T00:00:00Z");

test("createOrResumeDailyGame creates once, resumes on a second call for the same session+challenge", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const first = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const second = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.game.id, second.game.id);
});

test("createOrResumeDailyGame for a different session on the same challenge creates a distinct game", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const a = await uow.createOrResumeDailyGame({ playerSessionId: "sess-a", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const b = await uow.createOrResumeDailyGame({ playerSessionId: "sess-b", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  assert.notEqual(a.game.id, b.game.id);
});

test("createFreeplayGame always creates a new game, even for the same session", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 10);
  const a = await uow.createFreeplayGame({ playerSessionId: "sess-1", roundPlan: plan, now: NOW });
  const b = await uow.createFreeplayGame({ playerSessionId: "sess-1", roundPlan: plan, now: NOW });
  assert.notEqual(a.id, b.id);
});

test("getCurrentRound materializes round 1 once and returns the same round id on repeated calls", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round1 = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  const round2 = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  assert.equal(round1.id, round2.id);
  assert.equal(round1.orderInGame, 1);
  assert.equal(round1.status, "active");
  assert.equal(round1.posts.length, 5);
  assert.equal(round1.choices.length, 4);
  assert.ok(round1.choices.some((c) => c.forumUserId === round1.targetForumUserId));
});

test("getCurrentRound reveals exactly the first post on activation, none of the rest", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  assert.equal(round.hintsRevealedCount, 1);
  assert.equal(round.posts.filter((p) => p.revealed).length, 1);
  assert.equal(round.posts[0]!.revealed, true);
});

test("revealNextHint accumulates one at a time, capped at the number of posts, idempotent past the cap", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);

  for (let i = 2; i <= 5; i++) {
    const updated = await uow.revealNextHint(game.id, round.id, "sess-1", NOW);
    assert.equal(updated.hintsRevealedCount, i);
  }
  const capped = await uow.revealNextHint(game.id, round.id, "sess-1", NOW);
  assert.equal(capped.hintsRevealedCount, 5, "must not exceed the number of posts");
  assert.equal(capped.posts.every((p) => p.revealed), true);
});

test("score curve: a correct guess with only 1 hint revealed awards SCORE_CURVE[0]", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  const correctChoice = round.choices.find((c) => c.forumUserId === round.targetForumUserId)!;

  const result = await uow.submitGuess(game.id, round.id, "sess-1", correctChoice.choiceId, NOW);
  assert.equal(result.guess.isCorrect, true);
  assert.equal(result.round.scoreAwarded, SCORE_CURVE[0]);
  assert.equal(result.round.status, "resolved_correct");

  const updatedGame = await uow.getGame(game.id);
  assert.equal(updatedGame?.totalScore, SCORE_CURVE[0]);
});

test("score curve: revealing more hints before a correct guess lowers the awarded score to match", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  await uow.revealNextHint(game.id, round.id, "sess-1", NOW);
  await uow.revealNextHint(game.id, round.id, "sess-1", NOW); // hintsRevealedCount now 3

  const correctChoice = round.choices.find((c) => c.forumUserId === round.targetForumUserId)!;
  const result = await uow.submitGuess(game.id, round.id, "sess-1", correctChoice.choiceId, NOW);
  assert.equal(result.round.scoreAwarded, SCORE_CURVE[2]);
});

test("each distinct wrong guess reduces the round's available score by WRONG_GUESS_PENALTY before an eventual correct guess", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  const wrongChoice = round.choices.find((c) => c.forumUserId !== round.targetForumUserId)!;
  const correctChoice = round.choices.find((c) => c.forumUserId === round.targetForumUserId)!;

  const wrong1 = await uow.submitGuess(game.id, round.id, "sess-1", wrongChoice.choiceId, NOW);
  assert.equal(wrong1.guess.isCorrect, false);
  assert.equal(wrong1.round.wrongGuessCount, 1);
  assert.equal(wrong1.round.status, "active");

  const final = await uow.submitGuess(game.id, round.id, "sess-1", correctChoice.choiceId, NOW);
  assert.equal(final.round.scoreAwarded, SCORE_CURVE[0] - WRONG_GUESS_PENALTY);
});

test("duplicate retry of the identical guess is idempotent: no second penalty, wasNewGuess is false on replay", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  const wrongChoice = round.choices.find((c) => c.forumUserId !== round.targetForumUserId)!;

  const first = await uow.submitGuess(game.id, round.id, "sess-1", wrongChoice.choiceId, NOW);
  assert.equal(first.wasNewGuess, true);
  assert.equal(first.round.wrongGuessCount, 1);

  const replay = await uow.submitGuess(game.id, round.id, "sess-1", wrongChoice.choiceId, NOW);
  assert.equal(replay.wasNewGuess, false);
  assert.equal(replay.round.wrongGuessCount, 1, "must not double-count the identical resubmitted guess");
});

test("an invalid choiceId (not belonging to the round) is rejected", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  await assert.rejects(() => uow.submitGuess(game.id, round.id, "sess-1", "not-a-real-choice-id", NOW), InvalidChoiceError);
});

test("max wrong guesses resolves the round incorrect with a score of exactly zero", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  const wrongChoices = round.choices.filter((c) => c.forumUserId !== round.targetForumUserId);
  assert.ok(wrongChoices.length >= MAX_WRONG_GUESSES);

  let last;
  for (let i = 0; i < MAX_WRONG_GUESSES; i++) {
    last = await uow.submitGuess(game.id, round.id, "sess-1", wrongChoices[i]!.choiceId, NOW);
  }
  assert.equal(last!.round.status, "resolved_incorrect");
  assert.equal(last!.round.scoreAwarded, 0);
});

test("a hint request after the round has resolved is rejected", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  const correctChoice = round.choices.find((c) => c.forumUserId === round.targetForumUserId)!;
  await uow.submitGuess(game.id, round.id, "sess-1", correctChoice.choiceId, NOW);

  await assert.rejects(() => uow.revealNextHint(game.id, round.id, "sess-1", NOW), RoundNotActiveError);
});

test("a guess submitted after the round has expired is rejected, and the round is lazily marked expired", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  const wrongChoice = round.choices.find((c) => c.forumUserId !== round.targetForumUserId)!;

  const afterExpiry = new Date(NOW.getTime() + ROUND_EXPIRY_MS + 1000);
  await assert.rejects(() => uow.submitGuess(game.id, round.id, "sess-1", wrongChoice.choiceId, afterExpiry), RoundNotActiveError);

  const refetched = await uow.getCurrentRound(game.id, "sess-1", afterExpiry, content);
  assert.equal(refetched.status, "expired");
});

test("cross-session access is rejected for reading the current round, hint reveal, guess submission, and advance", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "owner", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "owner", NOW, content);

  await assert.rejects(() => uow.getCurrentRound(game.id, "intruder", NOW, content), ForbiddenGameAccessError);
  await assert.rejects(() => uow.revealNextHint(game.id, round.id, "intruder", NOW), ForbiddenGameAccessError);
  await assert.rejects(() => uow.submitGuess(game.id, round.id, "intruder", round.choices[0]!.choiceId, NOW), ForbiddenGameAccessError);
  await assert.rejects(() => uow.advanceToNextRound(game.id, "intruder", NOW, content), ForbiddenGameAccessError);
});

test("operating on an unknown gameId is rejected", async () => {
  const uow = makeUow();
  await assert.rejects(() => uow.getCurrentRound("no-such-game", "sess-1", NOW, content), GameNotFoundError);
});

test("advanceToNextRound is rejected while the current round is still active (unresolved)", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  await assert.rejects(() => uow.advanceToNextRound(game.id, "sess-1", NOW, content), RoundNotActiveError);
});

test("advanceToNextRound materializes round 2 in order once round 1 resolves", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round1 = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  const correct1 = round1.choices.find((c) => c.forumUserId === round1.targetForumUserId)!;
  await uow.submitGuess(game.id, round1.id, "sess-1", correct1.choiceId, NOW);

  const advanced = await uow.advanceToNextRound(game.id, "sess-1", NOW, content);
  assert.ok(advanced.round);
  assert.equal(advanced.round!.orderInGame, 2);
  assert.equal(advanced.game.currentRoundIndex, 1);
});

test("game completes after the final round resolves and advances, and a share token is generated", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });

  for (let orderInGame = 1; orderInGame <= 5; orderInGame++) {
    const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
    const correct = round.choices.find((c) => c.forumUserId === round.targetForumUserId)!;
    await uow.submitGuess(game.id, round.id, "sess-1", correct.choiceId, NOW);
    const result = await uow.advanceToNextRound(game.id, "sess-1", NOW, content);
    if (orderInGame < 5) {
      assert.ok(result.round);
      assert.equal(result.round!.orderInGame, orderInGame + 1);
    } else {
      assert.equal(result.round, null);
      assert.equal(result.game.status, "completed");
      assert.ok(result.game.shareToken, "expected a share token once the game completes");
    }
  }

  const finalGame = await uow.getGame(game.id);
  assert.equal(finalGame?.totalScore, SCORE_CURVE[0] * 5);
});

test("concurrent duplicate guesses for the same choice are serialized and only counted once (no lost-update / double-penalty)", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  const wrongChoice = round.choices.find((c) => c.forumUserId !== round.targetForumUserId)!;

  const results = await Promise.all(
    Array.from({ length: 5 }, () => uow.submitGuess(game.id, round.id, "sess-1", wrongChoice.choiceId, NOW)),
  );

  const newGuessCount = results.filter((r) => r.wasNewGuess).length;
  assert.equal(newGuessCount, 1, "exactly one of the concurrent identical submissions should be treated as new");
  const finalRound = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  assert.equal(finalRound.wrongGuessCount, 1);
});

test("concurrent guesses for DIFFERENT wrong choices are all counted, with no lost updates under concurrency", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  const wrongChoices = round.choices.filter((c) => c.forumUserId !== round.targetForumUserId);
  assert.ok(wrongChoices.length >= 2);

  await Promise.all(wrongChoices.slice(0, 2).map((c) => uow.submitGuess(game.id, round.id, "sess-1", c.choiceId, NOW)));

  const finalRound = await uow.getCurrentRound(game.id, "sess-1", NOW, content);
  assert.equal(finalRound.wrongGuessCount, 2, "both distinct concurrent wrong guesses must be counted, none lost");
});

test("opaque identifiers: round id and choice ids are never derived from / equal to any forum id in the plan", async () => {
  const uow = makeUow();
  const plan = makeRoundPlan(1, 5);
  const { game } = await uow.createOrResumeDailyGame({ playerSessionId: "sess-1", dailyChallengeId: "dc-1", roundPlan: plan, now: NOW });
  const round = await uow.getCurrentRound(game.id, "sess-1", NOW, content);

  const forumIds = new Set([round.targetForumUserId, ...plan[0]!.postIds, ...plan[0]!.choiceUserIds]);
  assert.equal(forumIds.has(round.id), false);
  assert.equal(forumIds.has(game.id), false);
  for (const choice of round.choices) {
    assert.equal(forumIds.has(choice.choiceId), false);
  }
});
