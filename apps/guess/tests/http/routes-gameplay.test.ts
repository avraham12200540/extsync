import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdvanceHandler } from "../../src/http/handlers/advance";
import { createGamesDailyHandler } from "../../src/http/handlers/games-daily";
import { createGamesFreeplayHandler } from "../../src/http/handlers/games-freeplay";
import { createGuessHandler } from "../../src/http/handlers/guess";
import { createHintHandler } from "../../src/http/handlers/hint";
import { createRoundHandler } from "../../src/http/handlers/round";
import { createSessionHandler } from "../../src/http/handlers/session";
import { hashToken } from "../../src/http/session";
import { authedHeaders, bootstrap, createTestDeps } from "./test-support";

function jsonReq(url: string, method: string, headers: Record<string, string>, body?: unknown): Request {
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function setUp(poolSize = 30) {
  const bundle = createTestDeps({ poolSize });
  const { deps } = bundle;
  const session = createSessionHandler(deps);
  const { rawSessionToken, rawCsrfToken } = await bootstrap((req) => session(req, {}));
  return { ...bundle, rawSessionToken, rawCsrfToken };
}

test("POST games/daily creates a game on first call and resumes the same one on a second call", async () => {
  const { deps, rawSessionToken, rawCsrfToken } = await setUp();
  const handler = createGamesDailyHandler(deps);

  const first = await handler(
    jsonReq("https://example.invalid/x", "POST", authedHeaders(rawSessionToken, rawCsrfToken, "idempotency-key-1"), {}),
    {},
  );
  assert.equal(first.status, 201);
  const firstBody = (await first.json()) as { gameId: string; mode: string };
  assert.equal(firstBody.mode, "daily");

  const second = await handler(
    jsonReq("https://example.invalid/x", "POST", authedHeaders(rawSessionToken, rawCsrfToken, "idempotency-key-2"), {}),
    {},
  );
  assert.equal(second.status, 200);
  const secondBody = (await second.json()) as { gameId: string };
  assert.equal(secondBody.gameId, firstBody.gameId, "second call must resume the same daily game");
});

test("POST games/daily without a CSRF header is rejected with 403", async () => {
  const { deps, rawSessionToken } = await setUp();
  const handler = createGamesDailyHandler(deps);
  const response = await handler(
    jsonReq("https://example.invalid/x", "POST", {
      "content-type": "application/json",
      cookie: `guess_session=${encodeURIComponent(rawSessionToken)}`,
    }, {}),
    {},
  );
  assert.equal(response.status, 403);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "csrf_failed");
});

test("POST games/daily with a WRONG CSRF header is rejected with 403", async () => {
  const { deps, rawSessionToken } = await setUp();
  const handler = createGamesDailyHandler(deps);
  const response = await handler(
    jsonReq("https://example.invalid/x", "POST", authedHeaders(rawSessionToken, "totally-wrong-csrf-token", "idempotency-key-x"), {}),
    {},
  );
  assert.equal(response.status, 403);
});

test("POST games/daily without a session cookie is rejected with 401", async () => {
  const { deps } = await setUp();
  const handler = createGamesDailyHandler(deps);
  const response = await handler(
    jsonReq("https://example.invalid/x", "POST", { "content-type": "application/json", "x-guess-csrf": "x", "x-idempotency-key": "k" }, {}),
    {},
  );
  assert.equal(response.status, 401);
});

test("POST games/freeplay always creates a new game", async () => {
  const { deps, rawSessionToken, rawCsrfToken } = await setUp();
  const handler = createGamesFreeplayHandler(deps);
  const a = await handler(jsonReq("https://x/y", "POST", authedHeaders(rawSessionToken, rawCsrfToken, "idempotency-key-a"), {}), {});
  const b = await handler(jsonReq("https://x/y", "POST", authedHeaders(rawSessionToken, rawCsrfToken, "idempotency-key-b"), {}), {});
  const aBody = (await a.json()) as { gameId: string; totalRounds: number };
  const bBody = (await b.json()) as { gameId: string };
  assert.notEqual(aBody.gameId, bBody.gameId);
  assert.equal(aBody.totalRounds, 10);
});

test("duplicate idempotency key on games/freeplay replays the original game, does not create a second one", async () => {
  const { deps, rawSessionToken, rawCsrfToken } = await setUp();
  const handler = createGamesFreeplayHandler(deps);
  const headers = authedHeaders(rawSessionToken, rawCsrfToken, "same-key");
  const first = await handler(jsonReq("https://x/y", "POST", headers, {}), {});
  const second = await handler(jsonReq("https://x/y", "POST", headers, {}), {});
  const firstBody = (await first.json()) as { gameId: string };
  const secondBody = (await second.json()) as { gameId: string };
  assert.equal(firstBody.gameId, secondBody.gameId);
});

test("duplicate idempotency key with a DIFFERENT payload is rejected with 409", async () => {
  const { deps, rawSessionToken, rawCsrfToken } = await setUp();
  const handler = createHintHandler(deps);
  // Two different roundIds under the same idempotency key = a changed payload.
  const headers = authedHeaders(rawSessionToken, rawCsrfToken, "same-key-2");
  await handler(jsonReq("https://x/y/games/g1/round/hint", "POST", headers, { roundId: "round-aaaa" }), { gameId: "g1" });
  const conflict = await handler(jsonReq("https://x/y/games/g1/round/hint", "POST", headers, { roundId: "round-bbbb" }), { gameId: "g1" });
  assert.equal(conflict.status, 409);
  const body = (await conflict.json()) as { error: { code: string } };
  assert.equal(body.error.code, "idempotency_key_conflict");
});

async function createDailyGame(deps: ReturnType<typeof createTestDeps>["deps"], rawSessionToken: string, rawCsrfToken: string) {
  const dailyHandler = createGamesDailyHandler(deps);
  const response = await dailyHandler(
    jsonReq("https://x/y", "POST", authedHeaders(rawSessionToken, rawCsrfToken, "create-daily"), {}),
    {},
  );
  return (await response.json()) as { gameId: string };
}

test("GET round returns the answer-free current round for an owned game", async () => {
  const { deps, rawSessionToken, rawCsrfToken } = await setUp();
  const { gameId } = await createDailyGame(deps, rawSessionToken, rawCsrfToken);

  const roundHandler = createRoundHandler(deps);
  const response = await roundHandler(
    new Request(`https://x/games/${gameId}/round`, { headers: { cookie: `guess_session=${encodeURIComponent(rawSessionToken)}` } }),
    { gameId },
  );
  assert.equal(response.status, 200);
  const round = (await response.json()) as { roundId: string; choices: Array<{ choiceId: string; username: string }>; correctChoiceId: string | null };
  assert.equal(round.choices.length, 4);
  assert.equal(round.correctChoiceId, null, "must not reveal the correct choice before resolution");
});

test("GET round for a game owned by a DIFFERENT session returns 404, not 403 (no existence oracle)", async () => {
  const { deps, rawSessionToken, rawCsrfToken } = await setUp();
  const { gameId } = await createDailyGame(deps, rawSessionToken, rawCsrfToken);

  const sessionHandler = createSessionHandler(deps);
  const intruder = await bootstrap((req) => sessionHandler(req, {}));

  const roundHandler = createRoundHandler(deps);
  const response = await roundHandler(
    new Request(`https://x/games/${gameId}/round`, { headers: { cookie: `guess_session=${encodeURIComponent(intruder.rawSessionToken)}` } }),
    { gameId },
  );
  assert.equal(response.status, 404);
});

test("hint accumulates one at a time and is idempotent past the cap", async () => {
  const { deps, rawSessionToken, rawCsrfToken } = await setUp();
  const { gameId } = await createDailyGame(deps, rawSessionToken, rawCsrfToken);
  const roundHandler = createRoundHandler(deps);
  const roundResp = await roundHandler(
    new Request(`https://x/games/${gameId}/round`, { headers: { cookie: `guess_session=${encodeURIComponent(rawSessionToken)}` } }),
    { gameId },
  );
  const round = (await roundResp.json()) as { roundId: string; hintsRevealedCount: number };
  assert.equal(round.hintsRevealedCount, 1);

  const hintHandler = createHintHandler(deps);
  let last: { hintsRevealedCount: number } = round;
  for (let i = 0; i < 6; i++) {
    const resp = await hintHandler(
      jsonReq(`https://x/games/${gameId}/round/hint`, "POST", authedHeaders(rawSessionToken, rawCsrfToken, `idempotency-hint-${i}`), { roundId: round.roundId }),
      { gameId },
    );
    last = (await resp.json()) as { hintsRevealedCount: number };
  }
  assert.equal(last.hintsRevealedCount, 5, "must never exceed the max post count");
});

test("a correct guess resolves the round and reveals only the correct choiceId/username, never the forum identity", async () => {
  const { deps, rawSessionToken, rawCsrfToken } = await setUp();
  const { gameId } = await createDailyGame(deps, rawSessionToken, rawCsrfToken);

  // Peek at the domain layer directly (test-only) to know which choice is correct - the HTTP response itself must not reveal this before submission.
  const ownerSession = await deps.sessionRepo.findSessionByTokenHash(hashToken(rawSessionToken));
  const domainRound = await deps.gameUow.getCurrentRound(gameId, ownerSession!.id, deps.clock(), deps.contentLookup);
  const correctChoice = domainRound.choices.find((c) => c.forumUserId === domainRound.targetForumUserId)!;

  const guessHandler = createGuessHandler(deps);
  const response = await guessHandler(
    jsonReq(`https://x/games/${gameId}/round/guess`, "POST", authedHeaders(rawSessionToken, rawCsrfToken, "idempotency-guess-1"), {
      roundId: domainRound.id,
      choiceId: correctChoice.choiceId,
    }),
    { gameId },
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { status: string; correctChoiceId: string; correctUsername: string; scoreAwarded: number };
  assert.equal(body.status, "resolved_correct");
  assert.equal(body.correctChoiceId, correctChoice.choiceId);
  assert.equal(body.scoreAwarded, 100);
  // Revealing the winning username is correct and expected post-resolution
  // (point 7 of the mission) - what must never appear is the underlying
  // forum identity as a field, regardless of what a real username happens
  // to look like. Checked by KEY, not by a content substring, since the
  // test fixture's synthetic getUsername() intentionally embeds the
  // forumUserId in its fake display name for traceability - a real
  // username would never coincidentally contain it, so a substring check
  // here would be testing the fixture, not the response shape.
  const raw = JSON.stringify(body);
  for (const forbiddenKey of ["forumUserId", "targetForumUserId", "forumUid", "forumUserslug", "rawContent", "moderationStatus", "seed"]) {
    assert.doesNotMatch(raw, new RegExp(`"${forbiddenKey}"`));
  }
});

test("resubmitting the identical guess (duplicate idempotency key + same payload) does not apply a second penalty", async () => {
  const { deps, rawSessionToken, rawCsrfToken } = await setUp();
  const { gameId } = await createDailyGame(deps, rawSessionToken, rawCsrfToken);
  const roundHandler = createRoundHandler(deps);
  const roundResp = await roundHandler(
    new Request(`https://x/games/${gameId}/round`, { headers: { cookie: `guess_session=${encodeURIComponent(rawSessionToken)}` } }),
    { gameId },
  );
  const round = (await roundResp.json()) as { roundId: string; choices: Array<{ choiceId: string }> };
  const wrongChoiceId = round.choices[0]!.choiceId;

  const guessHandler = createGuessHandler(deps);
  const headers = authedHeaders(rawSessionToken, rawCsrfToken, "dup-guess");
  const first = await guessHandler(
    jsonReq(`https://x/games/${gameId}/round/guess`, "POST", headers, { roundId: round.roundId, choiceId: wrongChoiceId }),
    { gameId },
  );
  const second = await guessHandler(
    jsonReq(`https://x/games/${gameId}/round/guess`, "POST", headers, { roundId: round.roundId, choiceId: wrongChoiceId }),
    { gameId },
  );
  const firstBody = (await first.json()) as { wrongGuessCount: number };
  const secondBody = (await second.json()) as { wrongGuessCount: number };
  assert.equal(firstBody.wrongGuessCount, secondBody.wrongGuessCount, "duplicate retry must not add a second wrong guess");
});

test("advance is rejected while the round is still active, then succeeds once resolved", async () => {
  const { deps, rawSessionToken, rawCsrfToken } = await setUp();
  const { gameId } = await createDailyGame(deps, rawSessionToken, rawCsrfToken);
  const roundHandler = createRoundHandler(deps);
  const roundResp = await roundHandler(
    new Request(`https://x/games/${gameId}/round`, { headers: { cookie: `guess_session=${encodeURIComponent(rawSessionToken)}` } }),
    { gameId },
  );
  const round = (await roundResp.json()) as { roundId: string; choices: Array<{ choiceId: string; username: string }> };

  const advanceHandler = createAdvanceHandler(deps);
  const tooEarly = await advanceHandler(
    jsonReq(`https://x/games/${gameId}/advance`, "POST", authedHeaders(rawSessionToken, rawCsrfToken, "idempotency-adv-1"), {}),
    { gameId },
  );
  assert.equal(tooEarly.status, 409);

  // Resolve the round (guess wrong 3 times to force resolution without needing to know the answer).
  const guessHandler = createGuessHandler(deps);
  for (let i = 0; i < 3; i++) {
    await guessHandler(
      jsonReq(`https://x/games/${gameId}/round/guess`, "POST", authedHeaders(rawSessionToken, rawCsrfToken, `idempotency-g-${i}`), {
        roundId: round.roundId,
        choiceId: round.choices[i % round.choices.length]!.choiceId,
      }),
      { gameId },
    );
  }

  const advanced = await advanceHandler(
    jsonReq(`https://x/games/${gameId}/advance`, "POST", authedHeaders(rawSessionToken, rawCsrfToken, "idempotency-adv-2"), {}),
    { gameId },
  );
  assert.equal(advanced.status, 200);
  const body = (await advanced.json()) as { completed: boolean; round?: { orderInGame: number } };
  assert.equal(body.completed, false);
  assert.equal(body.round?.orderInGame, 2);
});
