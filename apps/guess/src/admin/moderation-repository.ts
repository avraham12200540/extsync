import { buildForumPostSourceUrl } from "./source-url";
import { ADMIN_PAGE_SIZE_MAX } from "./config";

/**
 * Admin-facing read/write access to forum_post's moderation lifecycle.
 * raw_content only ever appears in ModerationPostDetail (the protected,
 * authenticated single-post detail response) - never in the queue list
 * view, never in any public/gameplay-facing type. Every mutation requires
 * the caller's last-read moderationVersion (optimistic concurrency) and
 * returns the new version, so a client can never silently overwrite a
 * decision another admin already made.
 */

export type ModerationStatus = "pending" | "approved" | "rejected" | "needs_review";
export interface ModerationFlag {
  code: string;
  reason: string;
}

export interface ModerationQueueItem {
  id: string;
  forumPid: string;
  forumUserId: string;
  forumUsername: string;
  moderationStatus: ModerationStatus;
  qualityScore: number;
  potentialLeakScore: number;
  moderationFlags: ModerationFlag[];
  wordCount: number;
  postedAt: Date;
  moderationVersion: number;
  sourceDiverged: boolean;
}

export interface ModerationPostDetail extends ModerationQueueItem {
  rawContent: string;
  cleanContent: string | null;
  forumTid: string;
  forumCategoryCid: string;
  sourceUrl: string;
  contentLength: number;
  quoteRatio: number;
  genericResponseScore: number;
  linksCount: number;
  mentionsCount: number;
  sourceDivergedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const MODERATION_SORT_FIELDS = ["postedAt", "qualityScore", "potentialLeakScore", "wordCount"] as const;
export type ModerationSortField = (typeof MODERATION_SORT_FIELDS)[number];
export type SortDirection = "asc" | "desc";

export interface ListModerationQueueInput {
  status?: ModerationStatus;
  sortField: ModerationSortField;
  sortDirection: SortDirection;
  page: number;
  pageSize: number;
}

export interface ListModerationQueueResult {
  items: ModerationQueueItem[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export class ModerationPostNotFoundError extends Error {}
export class ModerationConflictError extends Error {
  constructor(public readonly currentVersion: number) {
    super(`expected version does not match current version ${currentVersion}`);
  }
}

export interface ModerationRepository {
  listQueue(input: ListModerationQueueInput): Promise<ListModerationQueueResult>;
  getPostDetail(forumPostId: string): Promise<ModerationPostDetail | null>;
  approvePost(forumPostId: string, expectedVersion: number, now: Date): Promise<ModerationPostDetail>;
  rejectPost(forumPostId: string, expectedVersion: number, now: Date): Promise<ModerationPostDetail>;
  /** Creates a ForumPostRevision capturing the previous clean_content before overwriting it - raw_content is never touched. */
  editCleanContent(forumPostId: string, newCleanContent: string, expectedVersion: number, adminUserId: string, now: Date): Promise<ModerationPostDetail>;
}

export interface SeedModerationPost {
  id: string;
  forumPid: string;
  forumTid: string;
  forumCategoryCid: string;
  forumUserId: string;
  forumUsername: string;
  rawContent: string;
  cleanContent: string | null;
  moderationStatus: ModerationStatus;
  moderationVersion: number;
  qualityScore: number;
  potentialLeakScore: number;
  moderationFlags: ModerationFlag[];
  wordCount: number;
  contentLength: number;
  quoteRatio: number;
  genericResponseScore: number;
  linksCount: number;
  mentionsCount: number;
  sourceDiverged: boolean;
  sourceDivergedAt: Date | null;
  postedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeedRevision {
  id: string;
  forumPostId: string;
  previousCleanContent: string | null;
  editedByAdminId: string | null;
  editedAt: Date;
}

function toQueueItem(row: SeedModerationPost): ModerationQueueItem {
  return {
    id: row.id,
    forumPid: row.forumPid,
    forumUserId: row.forumUserId,
    forumUsername: row.forumUsername,
    moderationStatus: row.moderationStatus,
    qualityScore: row.qualityScore,
    potentialLeakScore: row.potentialLeakScore,
    moderationFlags: row.moderationFlags,
    wordCount: row.wordCount,
    postedAt: row.postedAt,
    moderationVersion: row.moderationVersion,
    sourceDiverged: row.sourceDiverged,
  };
}

function toDetail(row: SeedModerationPost): ModerationPostDetail {
  return {
    ...toQueueItem(row),
    rawContent: row.rawContent,
    cleanContent: row.cleanContent,
    forumTid: row.forumTid,
    forumCategoryCid: row.forumCategoryCid,
    sourceUrl: buildForumPostSourceUrl(row.forumPid),
    contentLength: row.contentLength,
    quoteRatio: row.quoteRatio,
    genericResponseScore: row.genericResponseScore,
    linksCount: row.linksCount,
    mentionsCount: row.mentionsCount,
    sourceDivergedAt: row.sourceDivergedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createInMemoryModerationRepository(
  deps: { generateId: () => string },
  seed: SeedModerationPost[] = [],
): ModerationRepository & { rows: Map<string, SeedModerationPost>; revisions: SeedRevision[] } {
  const rows = new Map<string, SeedModerationPost>();
  for (const row of seed) rows.set(row.id, { ...row });
  const revisions: SeedRevision[] = [];

  function requireVersionMatch(row: SeedModerationPost, expectedVersion: number): void {
    if (row.moderationVersion !== expectedVersion) {
      throw new ModerationConflictError(row.moderationVersion);
    }
  }

  return {
    rows,
    revisions,
    async listQueue(input) {
      const pageSize = Math.min(input.pageSize, ADMIN_PAGE_SIZE_MAX);
      let items = [...rows.values()];
      if (input.status !== undefined) items = items.filter((r) => r.moderationStatus === input.status);

      items.sort((a, b) => {
        let cmp = 0;
        if (input.sortField === "postedAt") cmp = a.postedAt.getTime() - b.postedAt.getTime();
        else if (input.sortField === "qualityScore") cmp = a.qualityScore - b.qualityScore;
        else if (input.sortField === "potentialLeakScore") cmp = a.potentialLeakScore - b.potentialLeakScore;
        else if (input.sortField === "wordCount") cmp = a.wordCount - b.wordCount;
        return input.sortDirection === "asc" ? cmp : -cmp;
      });

      const start = (input.page - 1) * pageSize;
      const pageItems = items.slice(start, start + pageSize).map(toQueueItem);
      return { items: pageItems, totalCount: items.length, page: input.page, pageSize };
    },

    async getPostDetail(forumPostId) {
      const row = rows.get(forumPostId);
      return row ? toDetail(row) : null;
    },

    async approvePost(forumPostId, expectedVersion, now) {
      const row = rows.get(forumPostId);
      if (!row) throw new ModerationPostNotFoundError(forumPostId);
      requireVersionMatch(row, expectedVersion);
      row.moderationStatus = "approved";
      row.moderationVersion += 1;
      row.updatedAt = now;
      return toDetail(row);
    },

    async rejectPost(forumPostId, expectedVersion, now) {
      const row = rows.get(forumPostId);
      if (!row) throw new ModerationPostNotFoundError(forumPostId);
      requireVersionMatch(row, expectedVersion);
      row.moderationStatus = "rejected";
      row.moderationVersion += 1;
      row.updatedAt = now;
      return toDetail(row);
    },

    async editCleanContent(forumPostId, newCleanContent, expectedVersion, adminUserId, now) {
      const row = rows.get(forumPostId);
      if (!row) throw new ModerationPostNotFoundError(forumPostId);
      requireVersionMatch(row, expectedVersion);
      revisions.push({
        id: deps.generateId(),
        forumPostId,
        previousCleanContent: row.cleanContent,
        editedByAdminId: adminUserId,
        editedAt: now,
      });
      row.cleanContent = newCleanContent;
      row.moderationVersion += 1;
      row.updatedAt = now;
      return toDetail(row);
    },
  };
}
