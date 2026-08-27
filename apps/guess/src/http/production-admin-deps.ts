import { createDrizzleAdminAuditRepository } from "../admin/drizzle-audit-repository";
import { createDrizzleAdminForumUserRepository } from "../admin/drizzle-forum-user-repository";
import { createDrizzleAdminImportRunRepository } from "../admin/drizzle-import-run-repository";
import { createDrizzleImportLock } from "../admin/drizzle-import-lock";
import { createDrizzleAdminUserRepository } from "../admin/drizzle-admin-user-repository";
import { createDrizzleModerationRepository } from "../admin/drizzle-moderation-repository";
import { getDb, getRawSql } from "../db/client";
import { createNodebbClient } from "../importer/nodebb-client";
import { createDrizzleForumRepository } from "../importer/repository";
import type { AdminHttpDeps } from "./deps";
import { createDrizzleAdminSessionRepository } from "./drizzle-admin-session-repository";
import { createLogger } from "./logger";
import { getProductionHttpDeps } from "./production-deps";

let cachedAdminDeps: AdminHttpDeps | undefined;

/**
 * Lazily builds the real, Postgres-backed AdminHttpDeps - same laziness
 * discipline as getProductionHttpDeps (env vars/DB connection only touched
 * on first real request), extended with every admin-only piece. Reuses
 * getProductionHttpDeps() for the base HttpDeps fields rather than
 * duplicating that construction, so admin routes and gameplay routes are
 * guaranteed to share the exact same rate-limit pepper, clock,
 * trusted-proxy config, etc.
 */
export function getProductionAdminHttpDeps(): AdminHttpDeps {
  if (cachedAdminDeps) return cachedAdminDeps;

  const appOrigin = process.env.GUESS_APP_ORIGIN;
  if (!appOrigin) {
    throw new Error(
      "GUESS_APP_ORIGIN must be set in the environment to serve admin traffic (e.g. https://extsync.com) - " +
        "intentionally not required for build/typecheck/tests.",
    );
  }

  const base = getProductionHttpDeps();
  const db = getDb();

  cachedAdminDeps = {
    ...base,
    adminSessionRepo: createDrizzleAdminSessionRepository(db),
    adminUserRepo: createDrizzleAdminUserRepository(db),
    adminAuditRepo: createDrizzleAdminAuditRepository(db),
    adminForumUserRepo: createDrizzleAdminForumUserRepository(db),
    moderationRepo: createDrizzleModerationRepository(db),
    adminImportRunRepo: createDrizzleAdminImportRunRepository(db),
    forumRepository: createDrizzleForumRepository(db),
    nodebbClient: createNodebbClient(),
    importLock: createDrizzleImportLock(getRawSql(), createLogger(base.logSink, "import-lock")),
    appOrigin,
  };
  return cachedAdminDeps;
}
