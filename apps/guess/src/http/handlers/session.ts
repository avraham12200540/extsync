import { z } from "zod";
import type { HttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId, noCacheHeaders, readCookie } from "../http-utils";
import { createLogger } from "../logger";
import { enforceRateLimit } from "../rate-limit";
import { SESSION_COOKIE_NAME, bootstrapSession, sessionCookieAttributes, serializeCookie } from "../session";
import { parseJsonBody } from "../validation";

const BODY_SCHEMA = z.object({}).strict();

/**
 * POST /guess/api/session - the only way to obtain a CSRF token. Every
 * other mutating endpoint requires one via X-Guess-CSRF, so a client must
 * call this first. The raw session token goes ONLY into the Set-Cookie
 * header; the JSON body carries the raw CSRF token (once, for this
 * response) and never the session token.
 */
export function createSessionHandler(deps: HttpDeps): RouteHandler {
  return async (request) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      await parseJsonBody(request, BODY_SCHEMA);
      await enforceRateLimit(
        { repo: deps.rateLimitRepo, pepper: deps.rateLimitPepper, proxyConfig: deps.trustedProxyConfig },
        "session",
        request.headers.get("x-forwarded-for"),
        deps.clock(),
      );

      const existingRawToken = readCookie(request, SESSION_COOKIE_NAME);
      const result = await bootstrapSession(deps.sessionRepo, deps.clock(), existingRawToken, { randomToken: deps.randomToken });

      logger.info("session.bootstrap", { isNewSession: result.isNewSession, rotatedSession: result.rotatedSession });

      const cookie = serializeCookie(SESSION_COOKIE_NAME, result.rawSessionToken, sessionCookieAttributes(deps.isProduction));
      return jsonResponse(
        200,
        { csrfToken: result.rawCsrfToken, sessionExpiresAt: result.sessionExpiresAt.toISOString() },
        { ...noCacheHeaders(), "Set-Cookie": cookie },
      );
    } catch (err) {
      logger.error("session.bootstrap_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
