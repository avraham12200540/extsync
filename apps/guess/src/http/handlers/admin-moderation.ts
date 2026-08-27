import { z } from "zod";
import { recordAuditEvent } from "../../admin/audit";
import { ADMIN_PAGE_SIZE_DEFAULT, ADMIN_PAGE_SIZE_MAX } from "../../admin/config";
import { MODERATION_SORT_FIELDS, ModerationPostNotFoundError } from "../../admin/moderation-repository";
import { toModerationPostDetailView, toModerationQueueItemView } from "../../admin/view-models";
import { authenticateAdminAndVerifyCsrf, authenticateAdminOnly } from "../admin-auth-helpers";
import type { AdminHttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { createLogger } from "../logger";
import { enforceRateLimit } from "../rate-limit";
import { parseEnumQuery, parseJsonBody, parseOptionalEnumQuery, parsePaginationQuery, parsePathParam } from "../validation";

const MODERATION_STATUSES = ["pending", "approved", "rejected", "needs_review"] as const;
const SORT_DIRECTIONS = ["asc", "desc"] as const;

/** GET /guess/api/admin/moderation/queue - filterable/sortable/paginated moderation queue. Never carries raw_content - see ModerationQueueItemView. */
export function createAdminModerationQueueHandler(deps: AdminHttpDeps): RouteHandler {
  return async (request) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      await authenticateAdminOnly(deps, request, now);

      const url = new URL(request.url);
      const { page, pageSize } = parsePaginationQuery(url.searchParams, ADMIN_PAGE_SIZE_DEFAULT, ADMIN_PAGE_SIZE_MAX);
      const sortField = parseEnumQuery(url.searchParams, "sortField", MODERATION_SORT_FIELDS, "postedAt");
      const sortDirection = parseEnumQuery(url.searchParams, "sortDirection", SORT_DIRECTIONS, "desc");
      const status = parseOptionalEnumQuery(url.searchParams, "status", MODERATION_STATUSES);

      const result = await deps.moderationRepo.listQueue({ status, sortField, sortDirection, page, pageSize });

      logger.info("admin.moderation_queue_listed", { totalCount: result.totalCount });
      return jsonResponse(200, { ...result, items: result.items.map(toModerationQueueItemView) });
    } catch (err) {
      logger.error("admin.moderation_queue_list_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}

/** GET /guess/api/admin/moderation/:forumPostId - raw vs sanitized comparison, immutable source metadata, safe reconstructed source URL. The ONLY route in this app that returns raw_content. */
export function createAdminModerationDetailHandler(deps: AdminHttpDeps): RouteHandler {
  return async (request, params) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      await authenticateAdminOnly(deps, request, now);
      const forumPostId = parsePathParam(params.forumPostId, "forumPostId");

      const detail = await deps.moderationRepo.getPostDetail(forumPostId);
      if (!detail) throw new ModerationPostNotFoundError(forumPostId);

      logger.info("admin.moderation_post_viewed", {});
      return jsonResponse(200, toModerationPostDetailView(detail));
    } catch (err) {
      logger.error("admin.moderation_post_view_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}

const VERSIONED_BODY_SCHEMA = z
  .object({
    expectedVersion: z.number().int().min(0),
  })
  .strict();

/** POST /guess/api/admin/moderation/:forumPostId/approve - requires the caller's last-read moderationVersion (optimistic concurrency). */
export function createAdminModerationApproveHandler(deps: AdminHttpDeps): RouteHandler {
  return async (request, params) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      const forumPostId = parsePathParam(params.forumPostId, "forumPostId");
      const body = await parseJsonBody(request, VERSIONED_BODY_SCHEMA);
      const { session } = await authenticateAdminAndVerifyCsrf(deps, request, now);
      await enforceRateLimit(
        { repo: deps.rateLimitRepo, pepper: deps.rateLimitPepper, proxyConfig: deps.trustedProxyConfig },
        "adminMutation",
        request.headers.get("x-forwarded-for"),
        now,
      );

      const updated = await deps.moderationRepo.approvePost(forumPostId, body.expectedVersion, now);
      await recordAuditEvent(deps.adminAuditRepo, {
        actorAdminId: session.adminUserId,
        action: "moderation.approve",
        targetType: "forum_post",
        targetId: forumPostId,
        requestCorrelationId: requestId,
        metadata: { newVersion: updated.moderationVersion },
        now,
      });

      logger.info("admin.moderation_approved", {});
      return jsonResponse(200, toModerationPostDetailView(updated));
    } catch (err) {
      logger.error("admin.moderation_approve_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}

const REJECT_BODY_SCHEMA = z
  .object({
    expectedVersion: z.number().int().min(0),
    reason: z.string().max(1000).optional(),
  })
  .strict();

/** POST /guess/api/admin/moderation/:forumPostId/reject - the reason (if given) is recorded ONLY in the audit trail, never on forum_post itself. */
export function createAdminModerationRejectHandler(deps: AdminHttpDeps): RouteHandler {
  return async (request, params) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      const forumPostId = parsePathParam(params.forumPostId, "forumPostId");
      const body = await parseJsonBody(request, REJECT_BODY_SCHEMA);
      const { session } = await authenticateAdminAndVerifyCsrf(deps, request, now);
      await enforceRateLimit(
        { repo: deps.rateLimitRepo, pepper: deps.rateLimitPepper, proxyConfig: deps.trustedProxyConfig },
        "adminMutation",
        request.headers.get("x-forwarded-for"),
        now,
      );

      const updated = await deps.moderationRepo.rejectPost(forumPostId, body.expectedVersion, now);
      await recordAuditEvent(deps.adminAuditRepo, {
        actorAdminId: session.adminUserId,
        action: "moderation.reject",
        targetType: "forum_post",
        targetId: forumPostId,
        requestCorrelationId: requestId,
        metadata: { newVersion: updated.moderationVersion, reason: body.reason ?? null },
        now,
      });

      logger.info("admin.moderation_rejected", {});
      return jsonResponse(200, toModerationPostDetailView(updated));
    } catch (err) {
      logger.error("admin.moderation_reject_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}

const EDIT_BODY_SCHEMA = z
  .object({
    expectedVersion: z.number().int().min(0),
    // Manual text is untrusted input like anything else - length-capped, never
    // rendered as HTML anywhere (gameplay only ever renders it as plain text).
    cleanContent: z.string().min(1).max(4000),
  })
  .strict();

/** POST /guess/api/admin/moderation/:forumPostId/edit - creates a ForumPostRevision capturing the previous value; raw_content is never touched. */
export function createAdminModerationEditHandler(deps: AdminHttpDeps): RouteHandler {
  return async (request, params) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      const forumPostId = parsePathParam(params.forumPostId, "forumPostId");
      const body = await parseJsonBody(request, EDIT_BODY_SCHEMA);
      const { session } = await authenticateAdminAndVerifyCsrf(deps, request, now);
      await enforceRateLimit(
        { repo: deps.rateLimitRepo, pepper: deps.rateLimitPepper, proxyConfig: deps.trustedProxyConfig },
        "adminMutation",
        request.headers.get("x-forwarded-for"),
        now,
      );

      const updated = await deps.moderationRepo.editCleanContent(forumPostId, body.cleanContent, body.expectedVersion, session.adminUserId, now);
      await recordAuditEvent(deps.adminAuditRepo, {
        actorAdminId: session.adminUserId,
        action: "moderation.edit",
        targetType: "forum_post",
        targetId: forumPostId,
        requestCorrelationId: requestId,
        metadata: { newVersion: updated.moderationVersion },
        now,
      });

      logger.info("admin.moderation_edited", {});
      return jsonResponse(200, toModerationPostDetailView(updated));
    } catch (err) {
      logger.error("admin.moderation_edit_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
