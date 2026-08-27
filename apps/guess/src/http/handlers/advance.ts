import { z } from "zod";
import { toGameView, toRoundView } from "../../game/view-models";
import { authenticateAndVerifyCsrf, requireIdempotencyKey } from "../auth-helpers";
import type { HttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { withIdempotency } from "../idempotency";
import { createLogger } from "../logger";
import { enforceRateLimit } from "../rate-limit";
import { parseJsonBody, parsePathParam } from "../validation";

const BODY_SCHEMA = z.object({}).strict();
const ENDPOINT = "games.advance";

type AdvanceResponseBody =
  | { completed: true; game: ReturnType<typeof toGameView> }
  | { completed: false; game: ReturnType<typeof toGameView>; round: ReturnType<typeof toRoundView> };

/** POST /guess/api/games/:gameId/advance - only allowed once the current round is resolved (unit-of-work.ts enforces this). */
export function createAdvanceHandler(deps: HttpDeps): RouteHandler {
  return async (request, params) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      const gameId = parsePathParam(params.gameId, "gameId");
      await parseJsonBody(request, BODY_SCHEMA);
      const session = await authenticateAndVerifyCsrf(deps, request, now);
      await enforceRateLimit(
        { repo: deps.rateLimitRepo, pepper: deps.rateLimitPepper, proxyConfig: deps.trustedProxyConfig },
        "advance",
        request.headers.get("x-forwarded-for"),
        now,
      );
      const idempotencyKey = requireIdempotencyKey(request);

      const outcome = await withIdempotency(
        deps.idempotencyRepo,
        idempotencyKey,
        ENDPOINT,
        { gameId, sessionId: session.id },
        now,
        async (): Promise<{ status: number; body: AdvanceResponseBody }> => {
          const result = await deps.gameUow.advanceToNextRound(gameId, session.id, now, deps.contentLookup);
          logger.info("games.advanced", { completed: result.round === null });
          if (result.round === null) {
            return { status: 200, body: { completed: true, game: toGameView(result.game) } };
          }
          return { status: 200, body: { completed: false, game: toGameView(result.game), round: toRoundView(result.round) } };
        },
      );

      return jsonResponse(outcome.status, outcome.body);
    } catch (err) {
      logger.error("games.advance_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
