import type { EligibilityFlag, EligibilityOverride, ForumAccountStatus } from "../game/eligibility";
import { resolveEligibility } from "../game/eligibility";
import { ADMIN_PAGE_SIZE_MAX } from "./config";

export class ForumUserNotFoundError extends Error {}

/**
 * Admin-facing read/write access to forum_user (+forum_user_stats),
 * scoped to what the eligibility list/detail/override endpoints need.
 * "Effective eligible/reasons" is always resolveEligibility()'s output
 * (admin override reconciled with the computed signal) - the same
 * function gameplay's curated-pool-repository uses - never a
 * re-implementation, so admin-visible eligibility can never drift from
 * what actually determines who can appear as a target/distractor.
 */

export interface AdminForumUserSummary {
  id: string;
  forumUid: string;
  forumUsername: string;
  forumUserslug: string;
  accountStatus: ForumAccountStatus;
  isSystemOrBot: boolean;
  adminOverride: EligibilityOverride;
  computedEligible: boolean;
  effectiveEligible: boolean;
  approvedPostCount: number;
  totalPostCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminForumUserDetail extends AdminForumUserSummary {
  effectiveReasons: EligibilityFlag[];
  computedReasons: EligibilityFlag[];
  avgWordCount: number;
  avgQualityScore: number;
  usernameLength: number;
  firstActiveAt: Date | null;
  lastActiveAt: Date | null;
}

export const FORUM_USER_SORT_FIELDS = ["forumUsername", "createdAt", "updatedAt", "approvedPostCount"] as const;
export type ForumUserSortField = (typeof FORUM_USER_SORT_FIELDS)[number];
export type SortDirection = "asc" | "desc";

export interface ListForumUsersFilter {
  effectiveEligibleOnly?: boolean;
  accountStatus?: ForumAccountStatus;
  adminOverride?: EligibilityOverride;
  /** Case-insensitive substring match against forumUsername - admin search convenience, never used to construct a query the way it would if this were raw SQL string concatenation (the Drizzle impl always parameterizes it). */
  usernameContains?: string;
}

export interface ListForumUsersInput {
  filter: ListForumUsersFilter;
  sortField: ForumUserSortField;
  sortDirection: SortDirection;
  page: number;
  pageSize: number;
}

export interface ListForumUsersResult {
  items: AdminForumUserSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface AdminForumUserRepository {
  list(input: ListForumUsersInput): Promise<ListForumUsersResult>;
  getDetail(forumUserId: string): Promise<AdminForumUserDetail | null>;
  setEligibilityOverride(forumUserId: string, override: EligibilityOverride, now: Date): Promise<AdminForumUserDetail | null>;
}

export interface SeedForumUser {
  id: string;
  forumUid: string;
  forumUsername: string;
  forumUserslug: string;
  accountStatus: ForumAccountStatus;
  isSystemOrBot: boolean;
  adminOverride: EligibilityOverride;
  computedEligible: boolean;
  computedReasons: EligibilityFlag[];
  createdAt: Date;
  updatedAt: Date;
  approvedPostCount: number;
  totalPostCount: number;
  avgWordCount: number;
  avgQualityScore: number;
  usernameLength: number;
  firstActiveAt: Date | null;
  lastActiveAt: Date | null;
}

function toDetail(row: SeedForumUser): AdminForumUserDetail {
  const effective = resolveEligibility({
    accountStatus: row.accountStatus,
    isSystemOrBot: row.isSystemOrBot,
    adminOverride: row.adminOverride,
    approvedPostCount: row.approvedPostCount,
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
    computedReasons: row.computedReasons,
    approvedPostCount: row.approvedPostCount,
    totalPostCount: row.totalPostCount,
    avgWordCount: row.avgWordCount,
    avgQualityScore: row.avgQualityScore,
    usernameLength: row.usernameLength,
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

export function createInMemoryAdminForumUserRepository(seed: SeedForumUser[] = []): AdminForumUserRepository & { rows: Map<string, SeedForumUser> } {
  const rows = new Map<string, SeedForumUser>();
  for (const row of seed) rows.set(row.id, { ...row });

  function matchesFilter(detail: AdminForumUserDetail, filter: ListForumUsersFilter): boolean {
    if (filter.effectiveEligibleOnly !== undefined && detail.effectiveEligible !== filter.effectiveEligibleOnly) return false;
    if (filter.accountStatus !== undefined && detail.accountStatus !== filter.accountStatus) return false;
    if (filter.adminOverride !== undefined && detail.adminOverride !== filter.adminOverride) return false;
    if (filter.usernameContains !== undefined && !detail.forumUsername.toLowerCase().includes(filter.usernameContains.toLowerCase())) return false;
    return true;
  }

  return {
    rows,
    async list(input) {
      const pageSize = Math.min(input.pageSize, ADMIN_PAGE_SIZE_MAX);
      const details = [...rows.values()].map(toDetail).filter((d) => matchesFilter(d, input.filter));

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
      const row = rows.get(forumUserId);
      return row ? toDetail(row) : null;
    },
    async setEligibilityOverride(forumUserId, override, now) {
      const row = rows.get(forumUserId);
      if (!row) return null;
      row.adminOverride = override;
      row.updatedAt = now;
      return toDetail(row);
    },
  };
}
