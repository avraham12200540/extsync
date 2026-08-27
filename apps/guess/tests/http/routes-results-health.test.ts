import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdvanceHandler } from "../../src/http/handlers/advance";
import { createGamesDailyHandler } from "../../src/http/handlers/games-daily";
import { createGuessHandler } from "../../src/http/handlers/guess";
import { createHealthHandler } from "../../src/http/handlers/health";
import { createResultsHandler } from "../../src/http/handlers/results";
import { createSessionHandler } from "../../src/http/handlers/session";
import { createShareResultsHandler } from "../../src/http/handlers/share-results";
import { hashToken } from "../../src/http/session";
import { authedHeaders, bootstrap, createTestDeps } from "./test-support";

function jsonReq(url: string, method: string, headers: Record<string, string>, body?: unknown): Request {
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

test("GET health returns 200 with a minimal, secret-free, topology-free body", async () => {
  const handler = createHealthHandler();
  const response = await handler(new Request("https://x/y"), {});
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ["status"]);
  const raw = JSON.stringify(body);
  assert.doesNotMatch(raw, /postgres|database|redis|docker|container|secret|key|password/i);
});

/** Plays a full daily game to completion (guessing correctly every round via the domain layer's own knowledge of the target). */
async function playDailyGameToCompletion(deps: ReturnType<typeof createTestDeps>["deps"], rawSessionToken: string, rawCsrfToken: string) {
  const dailyHandler = createGamesDailyHandler(deps);
  const create = await dailyHandler(jsonReq("https://x/y", "POST", authedHeaders(rawSessionToken, rawCsrfToken, "create-daily-completion"), {}), {});
  const { gameId } = (await create.json()) as { gameId: string };

  const ownerSession = await deps.sessionRepo.findSessionByTokenHash(hashToken(rawSessionToken));
  const guessHandler = createGuessHandler(deps);
  const advanceHandler = createAdvanceHandler(deps);

  for (let round = 1; round <= 5; round++) {
    const domainRound = await deps.gameUow.getCurrentRound(gameId, ownerSession!.id, deps.clock(), deps.contentLookup);
    const correctChoice = domainRound.choices.find((c) => c.forumUserId === domainRound.targetForumUserId)!;
    await guessHandler(
      jsonReq(`https://x/games/${gameId}/round/guess`, "POST", authedHeaders(rawSessionToken, rawCsrfToken, `complete-guess-${round}`), {
        roundId: domainRound.id,
        choiceId: correctChoice.choiceId,
      }),
      { gameId },
    );
    await advanceHandler(
      jsonReq(`https://x/games/${gameId}/advance`, "POST", authedHeaders(rawSessionToken, rawCsrfToken, `complete-adv-${round}`), {}),
      { gameId },
    );
  }
  return gameId;
}

test("owning-session results view reflects a completed game and includes a shareUrl", async () => {
  const { deps } = createTestDeps({ poolSize: 30 });
  const session = createSessionHandler(deps);
  const { rawSessionToken, rawCsrfToken } = await bootstrap((req) => session(req, {}));
  const gameId = await playDailyGameToCompletion(deps, rawSessionToken, rawCsrfToken);

  const resultsHandler = createResultsHandler(deps);
  const response = await resultsHandler(
    new Request(`https://x/games/${gameId}/results`, { headers: { cookie: `guess_session=${encodeURIComponent(rawSessionToken)}` } }),
    { gameId },
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { status: string; totalScore: number; shareUrl: string | null };
  assert.equal(body.status, "completed");
  assert.equal(body.totalScore, 500);
  assert.ok(body.shareUrl?.startsWith("/guess/results/"));
});

test("results for a game owned by a different session returns 404", async () => {
  const { deps } = createTestDeps({ poolSize: 30 });
  const session = createSessionHandler(deps);
  const owner = await bootstrap((req) => session(req, {}));
  const gameId = await playDailyGameToCompletion(deps, owner.rawSessionToken, owner.rawCsrfToken);

  const intruder = await bootstrap((req) => session(req, {}));
  const resultsHandler = createResultsHandler(deps);
  const response = await resultsHandler(
    new Request(`https://x/games/${gameId}/results`, { headers: { cookie: `guess_session=${encodeURIComponent(intruder.rawSessionToken)}` } }),
    { gameId },
  );
  assert.equal(response.status, 404);
});

test("public share-results view requires no session/cookie and is answer-free", async () => {
  const { deps } = createTestDeps({ poolSize: 30 });
  const session = createSessionHandler(deps);
  const { rawSessionToken, rawCsrfToken } = await bootstrap((req) => session(req, {}));
  const gameId = await playDailyGameToCompletion(deps, rawSessionToken, rawCsrfToken);

  const game = await deps.gameUow.getGame(gameId);
  assert.ok(game?.shareToken);

  const shareHandler = createShareResultsHandler(deps);
  const response = await shareHandler(new Request(`https://x/results/${game!.shareToken}`), { shareToken: game!.shareToken! });
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["completedAt", "mode", "totalRounds", "totalScore"]);
  const raw = JSON.stringify(body);
  assert.doesNotMatch(raw, /forumUserId|targetForumUserId|sessionId|playerSessionId/);
});

test("public share-results view for an unknown token returns 404, and for an in-progress game's token (none exists yet) also 404", async () => {
  const { deps } = createTestDeps({ poolSize: 30 });
  const shareHandler = createShareResultsHandler(deps);
  const response = await shareHandler(new Request("https://x/results/not-a-real-token"), { shareToken: "not-a-real-token" });
  assert.equal(response.status, 404);
});

