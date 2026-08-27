import { z } from "zod";
import { buildFreeplayRoundPlan } from "../../game/freeplay";
import { cryptoRandom } from "../../game/random";
import { toGameView } from "../../game/view-models";
import { authenticateAndVerifyCsrf, requireIdempotencyKey } from "../auth-helpers";
import type { HttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { withIdempotency } from "../idempotency";
import { createLogger } from "../logger";
import { enforceRateLimit } from "../rate-limit";
import { parseJsonBody } from "../validation";

const BODY_SCHEMA = z.object({}).strict();
const ENDPOINT = "games.freeplay";

/** POST /guess/api/games/freeplay - always creates a new free-play game for the authenticated session. */
export function createGamesFreeplayHandler(deps: HttpDeps): RouteHandler {
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
          const pool = await deps.curatedPool.getEligibleTargets(now);
          const roundPlan = buildFreeplayRoundPlan(pool, cryptoRandom);
          const game = await deps.gameUow.createFreeplayGame({ playerSessionId: session.id, roundPlan, now });
          logger.info("games.freeplay.created", {});
          return { status: 201, body: toGameView(game) };
        },
      );

      return jsonResponse(outcome.status, outcome.body);
    } catch (err) {
      logger.error("games.freeplay_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
