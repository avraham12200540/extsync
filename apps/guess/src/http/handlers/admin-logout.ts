import { z } from "zod";
import { recordAuditEvent } from "../../admin/audit";
import { ADMIN_SESSION_COOKIE_NAME, adminSessionCookieAttributes } from "../admin-session";
import { authenticateAdminAndVerifyCsrf } from "../admin-auth-helpers";
import type { AdminHttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { createLogger } from "../logger";
import { enforceRateLimit } from "../rate-limit";
import { expiredCookie } from "../session";
import { parseJsonBody } from "../validation";

const BODY_SCHEMA = z.object({}).strict();

/** POST /guess/api/admin/logout - revokes the CURRENT admin session and clears its cookie. */
export function createAdminLogoutHandler(deps: AdminHttpDeps): RouteHandler {
  return async (request) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      await parseJsonBody(request, BODY_SCHEMA);
      const { session } = await authenticateAdminAndVerifyCsrf(deps, request, now);
      await enforceRateLimit(
        { repo: deps.rateLimitRepo, pepper: deps.rateLimitPepper, proxyConfig: deps.trustedProxyConfig },
        "adminMutation",
        request.headers.get("x-forwarded-for"),
        now,
      );

      await deps.adminSessionRepo.revokeSession(session.id, now);
      await recordAuditEvent(deps.adminAuditRepo, {
        actorAdminId: session.adminUserId,
        action: "admin.logout",
        targetType: "admin_session",
        targetId: session.id,
        requestCorrelationId: requestId,
        metadata: {},
        now,
      });

      logger.info("admin.logout", {});
      const cookie = expiredCookie(ADMIN_SESSION_COOKIE_NAME, adminSessionCookieAttributes(deps.isProduction).path, deps.isProduction);
      return jsonResponse(200, { loggedOut: true }, { "Set-Cookie": cookie });
    } catch (err) {
      logger.error("admin.logout_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
