import { z } from "zod";
import { toRoundView } from "../../game/view-models";
import { authenticateAndVerifyCsrf, requireIdempotencyKey } from "../auth-helpers";
import type { HttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { withIdempotency } from "../idempotency";
import { createLogger } from "../logger";
import { enforceRateLimit } from "../rate-limit";
import { opaqueIdSchema, parseJsonBody, parsePathParam } from "../validation";

const BODY_SCHEMA = z.object({ roundId: opaqueIdSchema, choiceId: opaqueIdSchema }).strict();
const ENDPOINT = "round.guess";

/** POST /guess/api/games/:gameId/round/guess - submit a choice. Idempotent by (round, session, choice) - see unit-of-work.ts's submitGuess. */
export function createGuessHandler(deps: HttpDeps): RouteHandler {
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
        "guess",
        request.headers.get("x-forwarded-for"),
        now,
      );
      const idempotencyKey = requireIdempotencyKey(request);

      const outcome = await withIdempotency(
        deps.idempotencyRepo,
        idempotencyKey,
        ENDPOINT,
        { gameId, roundId: body.roundId, choiceId: body.choiceId, sessionId: session.id },
        now,
        async () => {
          const result = await deps.gameUow.submitGuess(gameId, body.roundId, session.id, body.choiceId, now);
          logger.info("round.guess_submitted", { isCorrect: result.guess.isCorrect, roundStatus: result.round.status });
          return { status: 200, body: toRoundView(result.round) };
        },
      );

      return jsonResponse(outcome.status, outcome.body);
    } catch (err) {
      logger.error("round.guess_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
