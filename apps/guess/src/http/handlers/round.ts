import { toRoundView } from "../../game/view-models";
import { authenticateOnly } from "../auth-helpers";
import type { HttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { createLogger } from "../logger";
import { parsePathParam } from "../validation";

/**
 * GET /guess/api/games/:gameId/round - the current round's answer-free
 * view. A GET, never mutating game/scoring state: materializing the
 * current round's rows on first visit realizes content that was already
 * fixed in Game.round_plan at game-creation time (see unit-of-work.ts) -
 * it doesn't advance the game, award points, or change what round the
 * player is on, so it stays a safe GET rather than requiring CSRF.
 */
export function createRoundHandler(deps: HttpDeps): RouteHandler {
  return async (request, params) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      const gameId = parsePathParam(params.gameId, "gameId");
      const session = await authenticateOnly(deps, request, now);
      const round = await deps.gameUow.getCurrentRound(gameId, session.id, now, deps.contentLookup);
      logger.info("round.viewed", { status: round.status });
      return jsonResponse(200, toRoundView(round));
    } catch (err) {
      logger.error("round.view_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
