import { toAdminSessionView } from "../../admin/view-models";
import { authenticateAdminOnly } from "../admin-auth-helpers";
import type { AdminHttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { createLogger } from "../logger";

/** GET /guess/api/admin/session - the current admin's own session/profile. Read-only: never touches/extends/rotates the session (see admin-session.ts). */
export function createAdminSessionInfoHandler(deps: AdminHttpDeps): RouteHandler {
  return async (request) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      const session = await authenticateAdminOnly(deps, request, now);
      const account = await deps.adminUserRepo.findById(session.adminUserId);
      if (!account) {
        // The session's own liveness check already confirmed adminIsActive via a join,
        // so this should be unreachable in practice; fail closed rather than guess.
        throw new Error("admin session references an admin user that could not be loaded");
      }

      logger.info("admin.session_viewed", {});
      return jsonResponse(200, toAdminSessionView({ adminUserId: session.adminUserId, email: account.email, sessionExpiresAt: session.expiresAt }));
    } catch (err) {
      logger.error("admin.session_view_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
