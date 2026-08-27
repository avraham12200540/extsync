import { z } from "zod";
import { recordAuditEvent } from "../../admin/audit";
import { ADMIN_PAGE_SIZE_DEFAULT, ADMIN_PAGE_SIZE_MAX } from "../../admin/config";
import { FORUM_USER_SORT_FIELDS, ForumUserNotFoundError } from "../../admin/forum-user-repository";
import { toAdminForumUserDetailView, toAdminForumUserView } from "../../admin/view-models";
import { authenticateAdminAndVerifyCsrf, authenticateAdminOnly } from "../admin-auth-helpers";
import type { AdminHttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { createLogger } from "../logger";
import { enforceRateLimit } from "../rate-limit";
import { parseJsonBody, parseEnumQuery, parseOptionalEnumQuery, parsePaginationQuery, parsePathParam } from "../validation";

const ACCOUNT_STATUSES = ["unknown", "active", "deleted", "banned"] as const;
const OVERRIDES = ["none", "force_eligible", "force_ineligible"] as const;
const SORT_DIRECTIONS = ["asc", "desc"] as const;


/** GET /guess/api/admin/forum-users - filterable/sortable/paginated eligibility list. */
export function createAdminForumUsersListHandler(deps: AdminHttpDeps): RouteHandler {
  return async (request) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      await authenticateAdminOnly(deps, request, now);

      const url = new URL(request.url);
      const { page, pageSize } = parsePaginationQuery(url.searchParams, ADMIN_PAGE_SIZE_DEFAULT, ADMIN_PAGE_SIZE_MAX);
      const sortField = parseEnumQuery(url.searchParams, "sortField", FORUM_USER_SORT_FIELDS, "createdAt");
      const sortDirection = parseEnumQuery(url.searchParams, "sortDirection", SORT_DIRECTIONS, "desc");
      const accountStatus = parseOptionalEnumQuery(url.searchParams, "accountStatus", ACCOUNT_STATUSES);
      const adminOverride = parseOptionalEnumQuery(url.searchParams, "adminOverride", OVERRIDES);
      const effectiveEligibleOnlyRaw = url.searchParams.get("effectiveEligibleOnly");
      const effectiveEligibleOnly = effectiveEligibleOnlyRaw === null ? undefined : effectiveEligibleOnlyRaw === "true";
      const usernameContains = url.searchParams.get("usernameContains") ?? undefined;

      const result = await deps.adminForumUserRepo.list({
        filter: { effectiveEligibleOnly, accountStatus, adminOverride, usernameContains },
        sortField,
        sortDirection,
        page,
        pageSize,
      });

      logger.info("admin.forum_users_listed", { totalCount: result.totalCount });
      return jsonResponse(200, { ...result, items: result.items.map(toAdminForumUserView) });
    } catch (err) {
      logger.error("admin.forum_users_list_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}

/** GET /guess/api/admin/forum-users/:forumUserId - eligibility detail. */
export function createAdminForumUserDetailHandler(deps: AdminHttpDeps): RouteHandler {
  return async (request, params) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      await authenticateAdminOnly(deps, request, now);
      const forumUserId = parsePathParam(params.forumUserId, "forumUserId");

      const detail = await deps.adminForumUserRepo.getDetail(forumUserId);
      if (!detail) throw new ForumUserNotFoundError(forumUserId);

      logger.info("admin.forum_user_viewed", {});
      return jsonResponse(200, toAdminForumUserDetailView(detail));
    } catch (err) {
      logger.error("admin.forum_user_view_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}

const OVERRIDE_BODY_SCHEMA = z
  .object({
    override: z.enum(OVERRIDES),
  })
  .strict();

/** POST /guess/api/admin/forum-users/:forumUserId/eligibility-override - an admin's explicit, independent eligibility decision (see src/game/eligibility.ts on why this always wins over the computed signal). Audited with the before/after value. */
export function createAdminForumUserOverrideHandler(deps: AdminHttpDeps): RouteHandler {
  return async (request, params) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      const forumUserId = parsePathParam(params.forumUserId, "forumUserId");
      const body = await parseJsonBody(request, OVERRIDE_BODY_SCHEMA);
      const { session } = await authenticateAdminAndVerifyCsrf(deps, request, now);
      await enforceRateLimit(
        { repo: deps.rateLimitRepo, pepper: deps.rateLimitPepper, proxyConfig: deps.trustedProxyConfig },
        "adminMutation",
        request.headers.get("x-forwarded-for"),
        now,
      );

      const before = await deps.adminForumUserRepo.getDetail(forumUserId);
      if (!before) throw new ForumUserNotFoundError(forumUserId);

      const updated = await deps.adminForumUserRepo.setEligibilityOverride(forumUserId, body.override, now);
      if (!updated) throw new ForumUserNotFoundError(forumUserId);

      await recordAuditEvent(deps.adminAuditRepo, {
        actorAdminId: session.adminUserId,
        action: "eligibility.override",
        targetType: "forum_user",
        targetId: forumUserId,
        requestCorrelationId: requestId,
        metadata: { previousOverride: before.adminOverride, newOverride: body.override },
        now,
      });

      logger.info("admin.forum_user_override_set", {});
      return jsonResponse(200, toAdminForumUserDetailView(updated));
    } catch (err) {
      logger.error("admin.forum_user_override_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
