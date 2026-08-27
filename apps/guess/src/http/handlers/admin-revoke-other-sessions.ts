import { z } from "zod";
import { recordAuditEvent } from "../../admin/audit";
import { authenticateAdminAndVerifyCsrf } from "../admin-auth-helpers";
import type { AdminHttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { createLogger } from "../logger";
import { enforceRateLimit } from "../rate-limit";
import { parseJsonBody } from "../validation";

const BODY_SCHEMA = z.object({}).strict();

/** POST /guess/api/admin/sessions/revoke-others - revokes every OTHER active session for the current admin (e.g. after a suspected compromise). Never revokes the session making this request. */
export function createAdminRevokeOtherSessionsHandler(deps: AdminHttpDeps): RouteHandler {
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

      const revokedCount = await deps.adminSessionRepo.revokeAllSessionsForAdmin(session.adminUserId, now, session.id);
      await recordAuditEvent(deps.adminAuditRepo, {
        actorAdminId: session.adminUserId,
        action: "admin.revoke_other_sessions",
        targetType: "admin_user",
        targetId: session.adminUserId,
        requestCorrelationId: requestId,
        metadata: { revokedCount },
        now,
      });

      logger.info("admin.revoke_other_sessions", { revokedCount });
      return jsonResponse(200, { revokedCount });
    } catch (err) {
      logger.error("admin.revoke_other_sessions_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
