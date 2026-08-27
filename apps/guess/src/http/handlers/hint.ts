import { z } from "zod";
import { toRoundView } from "../../game/view-models";
import { authenticateAndVerifyCsrf, requireIdempotencyKey } from "../auth-helpers";
import type { HttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { withIdempotency } from "../idempotency";
import { createLogger } from "../logger";
import { enforceRateLimit } from "../rate-limit";
import { opaqueIdSchema, parseJsonBody, parsePathParam } from "../validation";

const BODY_SCHEMA = z.object({ roundId: opaqueIdSchema }).strict();
const ENDPOINT = "round.hint";

/** POST /guess/api/games/:gameId/round/hint - reveal the next accumulating post. Idempotent past the hint cap (see unit-of-work.ts). */
export function createHintHandler(deps: HttpDeps): RouteHandler {
  return async (request, params) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      const gameId = parsePathParam(params.gameId, "gameId");
      const body = await parseJsonBody(request, BODY_SCHEMA);
      const session = await authenticateAndVerifyCsrf(deps, request, now);
      await enforceRateLimit(
        { repo: deps.rateLimitRepo, pepper: deps.rateLimitPepper, proxyConfig: deps.trustedProxyConfig },
        "hint",
        request.headers.get("x-forwarded-for"),
        now,
      );
      const idempotencyKey = requireIdempotencyKey(request);

      const outcome = await withIdempotency(
        deps.idempotencyRepo,
        idempotencyKey,
        ENDPOINT,
        { gameId, roundId: body.roundId, sessionId: session.id },
        now,
        async () => {
          const round = await deps.gameUow.revealNextHint(gameId, body.roundId, session.id, now);
          logger.info("round.hint_revealed", { hintsRevealedCount: round.hintsRevealedCount });
          return { status: 200, body: toRoundView(round) };
        },
      );

      return jsonResponse(outcome.status, outcome.body);
    } catch (err) {
      logger.error("round.hint_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
