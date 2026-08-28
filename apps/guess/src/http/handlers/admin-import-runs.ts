import { z } from "zod";
import { ADMIN_PAGE_SIZE_DEFAULT, ADMIN_PAGE_SIZE_MAX } from "../../admin/config";
import { ImportRunNotFoundError } from "../../admin/import-run-repository";
import { triggerImportRun } from "../../admin/import-service";
import { toImportRunView } from "../../admin/view-models";
import { authenticateAdminAndVerifyCsrf, authenticateAdminOnly } from "../admin-auth-helpers";
import type { AdminHttpDeps, RouteHandler } from "../deps";
import { errorResponse, jsonResponse, newRequestId } from "../http-utils";
import { createLogger } from "../logger";
import { enforceRateLimit } from "../rate-limit";
import { parseJsonBody, parsePaginationQuery, parsePathParam } from "../validation";

/** GET /guess/api/admin/import-runs - paginated, newest first. */
export function createAdminImportRunsListHandler(deps: AdminHttpDeps): RouteHandler {
  return async (request) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      await authenticateAdminOnly(deps, request, now);

      const url = new URL(request.url);
      const { page, pageSize } = parsePaginationQuery(url.searchParams, ADMIN_PAGE_SIZE_DEFAULT, ADMIN_PAGE_SIZE_MAX);
      const result = await deps.adminImportRunRepo.list({ page, pageSize });

      logger.info("admin.import_runs_listed", { totalCount: result.totalCount });
      return jsonResponse(200, { ...result, items: result.items.map(toImportRunView) });
    } catch (err) {
      logger.error("admin.import_runs_list_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}

/** GET /guess/api/admin/import-runs/:importRunId */
export function createAdminImportRunDetailHandler(deps: AdminHttpDeps): RouteHandler {
  return async (request, params) => {
    const requestId = newRequestId();
    const logger = createLogger(deps.logSink, requestId);
    try {
      const now = deps.clock();
      await authenticateAdminOnly(deps, request, now);
      const importRunId = parsePathParam(params.importRunId, "importRunId");

      const detail = await deps.adminImportRunRepo.getDetail(importRunId);
      if (!detail) throw new ImportRunNotFoundError(importRunId);

      logger.info("admin.import_run_viewed", {});
      return jsonResponse(200, toImportRunView(detail));
    } catch (err) {
      logger.error("admin.import_run_view_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}

const BODY_SCHEMA = z.object({}).strict();

/**
 * POST /guess/api/admin/import-runs/trigger - bounded, fixed-budget import.
 * The request body is empty-only (Zod .strict() on an empty shape) so a
 * caller can never supply an origin/URL/host/budget override - every
 * parameter the importer uses comes from server-side configuration only
 * (see triggerImportRun's doc comment).
 */
export function createAdminImportRunTriggerHandler(deps: AdminHttpDeps): RouteHandler {
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

      const summary = await triggerImportRun(
        {
          forumRepository: deps.forumRepository,
          statsRepository: deps.statsRepository,
          nodebbClient: deps.nodebbClient,
          auditRepo: deps.adminAuditRepo,
          importLock: deps.importLock,
        },
        { adminUserId: session.adminUserId, now, requestCorrelationId: requestId },
      );

      logger.info("admin.import_run_triggered", { status: summary.status, postsNew: summary.postsNew });
      return jsonResponse(202, {
        importRunId: summary.importRunId,
        status: summary.status,
        stoppedReason: summary.stoppedReason,
        postsFetched: summary.postsFetched,
        postsNew: summary.postsNew,
        postsDiverged: summary.postsDiverged,
        usersTouched: summary.usersTouched,
        pagesFetched: summary.pagesFetched,
        errorCount: summary.errors.length,
      });
    } catch (err) {
      logger.error("admin.import_run_trigger_failed", { errorType: err instanceof Error ? err.constructor.name : "unknown" });
      return errorResponse(err, requestId);
    }
  };
}
