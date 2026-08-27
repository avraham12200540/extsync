import { z } from "zod";
import { getOrPublishTodaysDailyChallenge } from "../../game/daily-challenge-service";
import { authenticateAndVerifyCsrf, requireIdempotencyKey } from "../auth-helpers";
import type { HttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { withIdempotency } from "../idempotency";
import { createLogger } from "../logger";
import { enforceRateLimit } from "../rate-limit";
import { parseJsonBody } from "../validation";
import { toGameView } from "../../game/view-models";

const BODY_SCHEMA = z.object({}).strict();
const ENDPOINT = "games.daily";

/** POST /guess/api/games/daily - create-or-resume today's daily game for the authenticated session. */
export function createGamesDailyHandler(deps: HttpDeps): RouteHandler {
  return async (request) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      await parseJsonBody(request, BODY_SCHEMA);
      const session = await authenticateAndVerifyCsrf(deps, request, now);
      await enforceRateLimit(
        { repo: deps.rateLimitRepo, pepper: deps.rateLimitPepper, proxyConfig: deps.trustedProxyConfig },
        "gameCreate",
        request.headers.get("x-forwarded-for"),
        now,
      );
      const idempotencyKey = requireIdempotencyKey(request);

      const outcome = await withIdempotency(
        deps.idempotencyRepo,
        idempotencyKey,
        ENDPOINT,
        { sessionId: session.id },
        now,
        async () => {
          const challenge = await getOrPublishTodaysDailyChallenge(deps.curatedPool, now, deps.dailySeedSecret);
          const { game, created } = await deps.gameUow.createOrResumeDailyGame({
            playerSessionId: session.id,
            dailyChallengeId: challenge.id,
            roundPlan: challenge.rounds,
            now,
          });
          logger.info("games.daily.resolved", { created });
          return { status: created ? 201 : 200, body: toGameView(game) };
        },
      );

      return jsonResponse(outcome.status, outcome.body);
    } catch (err) {
      logger.error("games.daily_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
