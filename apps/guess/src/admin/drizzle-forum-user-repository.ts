import { and, eq, ilike } from "drizzle-orm";
import type { GuessDb } from "../db/client";
import { forumUser, forumUserStats } from "../db/schema";
import type { EligibilityFlag } from "../game/eligibility";
import { resolveEligibility } from "../game/eligibility";
import { ADMIN_PAGE_SIZE_MAX } from "./config";
import type { AdminForumUserDetail, AdminForumUserRepository, AdminForumUserSummary, ListForumUsersFilter } from "./forum-user-repository";

type JoinedRow = {
  id: string;
  forumUid: string;
  forumUsername: string;
  forumUserslug: string;
  accountStatus: "unknown" | "active" | "deleted" | "banned";
  isSystemOrBot: boolean;
  adminOverride: "none" | "force_eligible" | "force_ineligible";
  computedEligible: boolean;
  eligibilityReasons: unknown;
  createdAt: Date;
  updatedAt: Date;
  approvedPostCount: number | null;
  totalPostCount: number | null;
  avgWordCount: number | null;
  avgQualityScore: number | null;
  usernameLength: number | null;
  firstActiveAt: Date | null;
  lastActiveAt: Date | null;
};

function toDetail(row: JoinedRow): AdminForumUserDetail {
  const approvedPostCount = row.approvedPostCount ?? 0;
  const effective = resolveEligibility({
    accountStatus: row.accountStatus,
    isSystemOrBot: row.isSystemOrBot,
    adminOverride: row.adminOverride,
    approvedPostCount,
  });
  return {
    id: row.id,
    forumUid: row.forumUid,
    forumUsername: row.forumUsername,
    forumUserslug: row.forumUserslug,
    accountStatus: row.accountStatus,
    isSystemOrBot: row.isSystemOrBot,
    adminOverride: row.adminOverride,
    computedEligible: row.computedEligible,
    effectiveEligible: effective.eligible,
    effectiveReasons: effective.reasons,
    computedReasons: (row.eligibilityReasons as EligibilityFlag[] | null) ?? [],
    approvedPostCount,
    totalPostCount: row.totalPostCount ?? 0,
    avgWordCount: row.avgWordCount ?? 0,
    avgQualityScore: row.avgQualityScore ?? 0,
    usernameLength: row.usernameLength ?? row.forumUsername.length,
    firstActiveAt: row.firstActiveAt,
    lastActiveAt: row.lastActiveAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSummary(detail: AdminForumUserDetail): AdminForumUserSummary {
  const { effectiveReasons: _r, computedReasons: _cr, avgWordCount: _a, avgQualityScore: _q, usernameLength: _u, firstActiveAt: _f, lastActiveAt: _l, ...summary } = detail;
  return summary;
}

const JOIN_COLUMNS = {
  id: forumUser.id,
  forumUid: forumUser.forumUid,
  forumUsername: forumUser.forumUsername,
  forumUserslug: forumUser.forumUserslug,
  accountStatus: forumUser.accountStatus,
  isSystemOrBot: forumUser.isSystemOrBot,
  adminOverride: forumUser.adminOverride,
  computedEligible: forumUser.computedEligible,
  eligibilityReasons: forumUser.eligibilityReasons,
  createdAt: forumUser.createdAt,
  updatedAt: forumUser.updatedAt,
  approvedPostCount: forumUserStats.approvedPostCount,
  totalPostCount: forumUserStats.totalPostCount,
  avgWordCount: forumUserStats.avgWordCount,
  avgQualityScore: forumUserStats.avgQualityScore,
  usernameLength: forumUserStats.usernameLength,
  firstActiveAt: forumUserStats.firstActiveAt,
  lastActiveAt: forumUserStats.lastActiveAt,
} as const;

/**
 * Real Postgres-backed AdminForumUserRepository. Not integration-tested
 * (no PostgreSQL in this environment). `effectiveEligibleOnly` filtering
 * happens in application code (via resolveEligibility, the single source
 * of truth for that decision) after pushing every other filter down to
 * SQL - this trades some DB-side efficiency at large row counts for a
 * guarantee that "effective eligible" here can never drift from what
 * gameplay's own eligibility resolution decides. Acceptable for an admin
 * surface at the current expected forum_user row count; a future stage
 * could cache the resolved boolean in a column if this ever needs to
 * scale further, at the cost of a recompute step keeping it fresh.
 */
export function createDrizzleAdminForumUserRepository(db: GuessDb): AdminForumUserRepository {
  function buildWhere(filter: ListForumUsersFilter) {
    const conditions = [];
    if (filter.accountStatus !== undefined) conditions.push(eq(forumUser.accountStatus, filter.accountStatus));
    if (filter.adminOverride !== undefined) conditions.push(eq(forumUser.adminOverride, filter.adminOverride));
    if (filter.usernameContains !== undefined && filter.usernameContains.length > 0) {
      conditions.push(ilike(forumUser.forumUsername, `%${filter.usernameContains}%`));
    }
    return conditions.length > 0 ? and(...conditions) : undefined;
  }

  return {
    async list(input) {
      const pageSize = Math.min(input.pageSize, ADMIN_PAGE_SIZE_MAX);
      const where = buildWhere(input.filter);

      const rows = await db
        .select(JOIN_COLUMNS)
        .from(forumUser)
        .leftJoin(forumUserStats, eq(forumUserStats.forumUserId, forumUser.id))
        .where(where);

      let details = rows.map(toDetail);
      if (input.filter.effectiveEligibleOnly !== undefined) {
        details = details.filter((d) => d.effectiveEligible === input.filter.effectiveEligibleOnly);
      }

      details.sort((a, b) => {
        let cmp = 0;
        if (input.sortField === "forumUsername") cmp = a.forumUsername.localeCompare(b.forumUsername);
        else if (input.sortField === "createdAt") cmp = a.createdAt.getTime() - b.createdAt.getTime();
        else if (input.sortField === "updatedAt") cmp = a.updatedAt.getTime() - b.updatedAt.getTime();
        else if (input.sortField === "approvedPostCount") cmp = a.approvedPostCount - b.approvedPostCount;
        return input.sortDirection === "asc" ? cmp : -cmp;
      });

      const start = (input.page - 1) * pageSize;
      const pageItems = details.slice(start, start + pageSize).map(toSummary);
      return { items: pageItems, totalCount: details.length, page: input.page, pageSize };
    },

    async getDetail(forumUserId) {
      const [row] = await db
        .select(JOIN_COLUMNS)
        .from(forumUser)
        .leftJoin(forumUserStats, eq(forumUserStats.forumUserId, forumUser.id))
        .where(eq(forumUser.id, forumUserId));
      return row ? toDetail(row) : null;
    },

    async setEligibilityOverride(forumUserId, override, now) {
      const [updated] = await db
        .update(forumUser)
        .set({ adminOverride: override, updatedAt: now })
        .where(eq(forumUser.id, forumUserId))
        .returning({ id: forumUser.id });
      if (!updated) return null;
      return this.getDetail(forumUserId);
    },
  };
}
