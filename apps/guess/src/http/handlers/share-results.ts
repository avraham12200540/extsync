import { toShareResultsView } from "../../game/view-models";
import { GameNotFoundError } from "../../game/unit-of-work";
import type { HttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { createLogger } from "../logger";
import { enforceRateLimit } from "../rate-limit";
import { parsePathParam } from "../validation";

/** GET /guess/api/results/:shareToken - public, unauthenticated, answer-free share view. No session/CSRF required by design. */
export function createShareResultsHandler(deps: HttpDeps): RouteHandler {
  return async (request, params) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      const shareToken = parsePathParam(params.shareToken, "shareToken");
      await enforceRateLimit(
        { repo: deps.rateLimitRepo, pepper: deps.rateLimitPepper, proxyConfig: deps.trustedProxyConfig },
        "shareResults",
        request.headers.get("x-forwarded-for"),
        now,
      );

      const game = await deps.gameUow.getGameByShareToken(shareToken);
      if (!game || game.status !== "completed") {
        throw new GameNotFoundError(shareToken);
      }

      logger.info("results.share_viewed", {});
      return jsonResponse(200, toShareResultsView(game));
    } catch (err) {
      logger.error("results.share_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
