import { toGameView } from "../../game/view-models";
import { ForbiddenGameAccessError } from "../../game/unit-of-work";
import { authenticateOnly } from "../auth-helpers";
import type { HttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { createLogger } from "../logger";
import { parsePathParam } from "../validation";

/** GET /guess/api/games/:gameId/results - the owning session's own results view, including a share link once completed. */
export function createResultsHandler(deps: HttpDeps): RouteHandler {
  return async (request, params) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      const gameId = parsePathParam(params.gameId, "gameId");
      const session = await authenticateOnly(deps, request, now);

      const game = await deps.gameUow.getGame(gameId);
      // Same 404 as an unknown game - see errors.ts's reasoning on collapsing "not found" and "not yours".
      if (!game || game.playerSessionId !== session.id) {
        throw new ForbiddenGameAccessError(`session ${session.id} does not own game ${gameId}`);
      }

      logger.info("games.results_viewed", { status: game.status });
      const view = toGameView(game);
      return jsonResponse(200, { ...view, shareUrl: game.shareToken ? `/guess/results/${game.shareToken}` : null });
    } catch (err) {
      logger.error("games.results_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
