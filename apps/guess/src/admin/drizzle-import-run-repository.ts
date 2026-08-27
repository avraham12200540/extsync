import { desc, eq, sql } from "drizzle-orm";
import type { GuessDb } from "../db/client";
import { importRun } from "../db/schema";
import { ADMIN_PAGE_SIZE_MAX } from "./config";
import type { AdminImportRunRepository, ImportRunSummaryView } from "./import-run-repository";

function toView(row: typeof importRun.$inferSelect): ImportRunSummaryView {
  return {
    id: row.id,
    status: row.status,
    triggerKind: row.triggerKind,
    triggeredByAdminId: row.triggeredByAdminId,
    sourceEndpoint: row.sourceEndpoint,
    cursorUsed: row.cursorUsed,
    postsFetched: row.postsFetched,
    postsNew: row.postsNew,
    postsUpdated: row.postsUpdated,
    usersTouched: row.usersTouched,
    rateLimitEvents: row.rateLimitEvents,
    errorSummary: row.errorSummary,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

/** Real Postgres-backed AdminImportRunRepository. Not integration-tested (no PostgreSQL in this environment) - a thin, direct mapping onto the already-generated schema. */
export function createDrizzleAdminImportRunRepository(db: GuessDb): AdminImportRunRepository {
  return {
    async list(input) {
      const pageSize = Math.min(input.pageSize, ADMIN_PAGE_SIZE_MAX);
      const countRows = await db.select({ count: sql<number>`count(*)::int` }).from(importRun);
      const count = countRows[0]?.count ?? 0;
      const rows = await db
        .select()
        .from(importRun)
        .orderBy(desc(importRun.startedAt))
        .limit(pageSize)
        .offset((input.page - 1) * pageSize);
      return { items: rows.map(toView), totalCount: count, page: input.page, pageSize };
    },
    async getDetail(importRunId) {
      const [row] = await db.select().from(importRun).where(eq(importRun.id, importRunId));
      return row ? toView(row) : null;
    },
    async hasRunningImport() {
      const rows = await db.select({ id: importRun.id }).from(importRun).where(eq(importRun.status, "running")).limit(1);
      return rows.length > 0;
    },
  };
}
