import { z } from "zod";
import { attemptAdminLogin } from "../../admin/auth-service";
import { toAdminSessionView } from "../../admin/view-models";
import { authenticateAndVerifyCsrf } from "../auth-helpers";
import { ADMIN_SESSION_COOKIE_NAME, adminSessionCookieAttributes } from "../admin-session";
import type { AdminHttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { createLogger } from "../logger";
import { requireSameOriginRequest } from "../origin-check";
import { computeDayKey, enforceRateLimit, extractClientIp, hashIpForBucket } from "../rate-limit";
import { serializeCookie } from "../session";
import { parseJsonBody } from "../validation";

const BODY_SCHEMA = z
  .object({
    email: z.string().min(1).max(320),
    password: z.string().min(1).max(1024),
  })
  .strict();

/**
 * POST /guess/api/admin/login - the one request a post-login admin CSRF
 * token structurally cannot protect (it does not exist yet). Defended
 * instead by: (1) strict Origin/Sec-Fetch-Site same-origin validation, and
 * (2) requiring a valid pre-existing ANONYMOUS player session + its
 * already-issued X-Guess-CSRF header - the same pre-auth-nonce mechanism
 * every other mutating gameplay endpoint already relies on (see
 * auth-helpers.ts's authenticateAndVerifyCsrf, reused verbatim, not
 * reimplemented). A future admin login page must first bootstrap (or
 * already have) a player session via POST /guess/api/session before
 * submitting this form.
 */
export function createAdminLoginHandler(deps: AdminHttpDeps): RouteHandler {
  return async (request) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      const body = await parseJsonBody(request, BODY_SCHEMA);

      requireSameOriginRequest(request, deps.appOrigin);
      await authenticateAndVerifyCsrf(deps, request, now);

      const xForwardedFor = request.headers.get("x-forwarded-for");
      await enforceRateLimit(
        { repo: deps.rateLimitRepo, pepper: deps.rateLimitPepper, proxyConfig: deps.trustedProxyConfig },
        "adminLogin",
        xForwardedFor,
        now,
      );

      const clientIp = extractClientIp(xForwardedFor, deps.trustedProxyConfig);
      const ipHash = clientIp ? hashIpForBucket(clientIp, deps.rateLimitPepper, computeDayKey(now)) : null;

      const result = await attemptAdminLogin(
        { adminUserRepo: deps.adminUserRepo, adminSessionRepo: deps.adminSessionRepo, auditRepo: deps.adminAuditRepo },
        { email: body.email, password: body.password, now, ipHash, requestCorrelationId: requestId, gen: { randomToken: deps.randomToken } },
      );

      logger.info("admin.login_succeeded", {});
      const cookie = serializeCookie(ADMIN_SESSION_COOKIE_NAME, result.rawSessionToken, adminSessionCookieAttributes(deps.isProduction));
      const view = toAdminSessionView({ adminUserId: result.adminUserId, email: body.email.trim().toLowerCase(), sessionExpiresAt: result.sessionExpiresAt });
      return jsonResponse(200, { ...view, csrfToken: result.rawCsrfToken }, { "Set-Cookie": cookie });
    } catch (err) {
      logger.error("admin.login_failed_request", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
