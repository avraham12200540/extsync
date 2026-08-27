import { and, eq, sql } from "drizzle-orm";
import type { GuessDb } from "../db/client";
import { forumPost, forumPostRevision, forumUser } from "../db/schema";
import { ADMIN_PAGE_SIZE_MAX } from "./config";
import { ModerationConflictError, ModerationPostNotFoundError } from "./moderation-repository";
import type { ModerationFlag, ModerationPostDetail, ModerationQueueItem, ModerationRepository, ModerationStatus } from "./moderation-repository";
import { buildForumPostSourceUrl } from "./source-url";

const QUEUE_COLUMNS = {
  id: forumPost.id,
  forumPid: forumPost.forumPid,
  forumUserId: forumPost.forumUserId,
  forumUsername: forumUser.forumUsername,
  moderationStatus: forumPost.moderationStatus,
  qualityScore: forumPost.qualityScore,
  potentialLeakScore: forumPost.potentialLeakScore,
  moderationFlags: forumPost.moderationFlags,
  wordCount: forumPost.wordCount,
  postedAt: forumPost.postedAt,
  moderationVersion: forumPost.moderationVersion,
  sourceDiverged: forumPost.sourceDiverged,
} as const;

const DETAIL_COLUMNS = {
  ...QUEUE_COLUMNS,
  rawContent: forumPost.rawContent,
  cleanContent: forumPost.cleanContent,
  forumTid: forumPost.forumTid,
  forumCategoryCid: forumPost.forumCategoryCid,
  contentLength: forumPost.contentLength,
  quoteRatio: forumPost.quoteRatio,
  genericResponseScore: forumPost.genericResponseScore,
  linksCount: forumPost.linksCount,
  mentionsCount: forumPost.mentionsCount,
  sourceDivergedAt: forumPost.sourceDivergedAt,
  createdAt: forumPost.createdAt,
  updatedAt: forumPost.updatedAt,
} as const;

type QueueRow = {
  id: string;
  forumPid: string;
  forumUserId: string;
  forumUsername: string;
  moderationStatus: ModerationStatus;
  qualityScore: number;
  potentialLeakScore: number;
  moderationFlags: unknown;
  wordCount: number;
  postedAt: Date;
  moderationVersion: number;
  sourceDiverged: boolean;
};

function toQueueItem(row: QueueRow): ModerationQueueItem {
  return {
    id: row.id,
    forumPid: row.forumPid,
    forumUserId: row.forumUserId,
    forumUsername: row.forumUsername,
    moderationStatus: row.moderationStatus,
    qualityScore: row.qualityScore,
    potentialLeakScore: row.potentialLeakScore,
    moderationFlags: (row.moderationFlags as ModerationFlag[] | null) ?? [],
    wordCount: row.wordCount,
    postedAt: row.postedAt,
    moderationVersion: row.moderationVersion,
    sourceDiverged: row.sourceDiverged,
  };
}

type DetailRow = QueueRow & {
  rawContent: string;
  cleanContent: string | null;
  forumTid: string;
  forumCategoryCid: string;
  contentLength: number;
  quoteRatio: number;
  genericResponseScore: number;
  linksCount: number;
  mentionsCount: number;
  sourceDivergedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDetail(row: DetailRow): ModerationPostDetail {
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

/**
 * Real Postgres-backed ModerationRepository. Not integration-tested (no
 * PostgreSQL in this environment). Optimistic concurrency on
 * approve/reject/edit is a single conditional
 * `UPDATE ... WHERE id = $1 AND moderation_version = $2 RETURNING *` -
 * genuinely atomic at the database level (unlike the import-run overlap
 * check, this does not rely on an advisory lock or any read-then-write
 * gap) - so this specific guarantee does NOT need a live-database caveat
 * the way the import trigger's overlap lock does.
 */
export function createDrizzleModerationRepository(db: GuessDb): ModerationRepository {
  async function fetchDetail(forumPostId: string): Promise<ModerationPostDetail | null> {
    const [row] = await db
      .select(DETAIL_COLUMNS)
      .from(forumPost)
      .innerJoin(forumUser, eq(forumUser.id, forumPost.forumUserId))
      .where(eq(forumPost.id, forumPostId));
    return row ? toDetail(row) : null;
  }

  async function finishConditionalUpdate(forumPostId: string, updatedRowPresent: boolean): Promise<ModerationPostDetail> {
    if (updatedRowPresent) {
      const detail = await fetchDetail(forumPostId);
      if (!detail) throw new ModerationPostNotFoundError(forumPostId);
      return detail;
    }
    const existing = await fetchDetail(forumPostId);
    if (!existing) throw new ModerationPostNotFoundError(forumPostId);
    throw new ModerationConflictError(existing.moderationVersion);
  }

  return {
    async listQueue(input) {
      const pageSize = Math.min(input.pageSize, ADMIN_PAGE_SIZE_MAX);
      const where = input.status !== undefined ? eq(forumPost.moderationStatus, input.status) : undefined;

      const countRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(forumPost)
        .where(where ?? sql`true`);
      const count = countRows[0]?.count ?? 0;

      const sortColumn =
        input.sortField === "postedAt"
          ? forumPost.postedAt
          : input.sortField === "qualityScore"
            ? forumPost.qualityScore
            : input.sortField === "potentialLeakScore"
              ? forumPost.potentialLeakScore
              : forumPost.wordCount;
      const orderExpr = input.sortDirection === "asc" ? sql`${sortColumn} asc` : sql`${sortColumn} desc`;

      const rows = await db
        .select(QUEUE_COLUMNS)
        .from(forumPost)
        .innerJoin(forumUser, eq(forumUser.id, forumPost.forumUserId))
        .where(where ?? sql`true`)
        .orderBy(orderExpr)
        .limit(pageSize)
        .offset((input.page - 1) * pageSize);

      return { items: rows.map(toQueueItem), totalCount: count, page: input.page, pageSize };
    },

    async getPostDetail(forumPostId) {
      return fetchDetail(forumPostId);
    },

    async approvePost(forumPostId, expectedVersion, now) {
      const updated = await db
        .update(forumPost)
        .set({ moderationStatus: "approved", moderationVersion: sql`${forumPost.moderationVersion} + 1`, updatedAt: now })
        .where(and(eq(forumPost.id, forumPostId), eq(forumPost.moderationVersion, expectedVersion)))
        .returning({ id: forumPost.id });
      return finishConditionalUpdate(forumPostId, updated.length > 0);
    },

    async rejectPost(forumPostId, expectedVersion, now) {
      const updated = await db
        .update(forumPost)
        .set({ moderationStatus: "rejected", moderationVersion: sql`${forumPost.moderationVersion} + 1`, updatedAt: now })
        .where(and(eq(forumPost.id, forumPostId), eq(forumPost.moderationVersion, expectedVersion)))
        .returning({ id: forumPost.id });
      return finishConditionalUpdate(forumPostId, updated.length > 0);
    },

    async editCleanContent(forumPostId, newCleanContent, expectedVersion, adminUserId, now) {
      return db.transaction(async (tx) => {
        const [current] = await tx.select({ cleanContent: forumPost.cleanContent }).from(forumPost).where(eq(forumPost.id, forumPostId));
        if (!current) throw new ModerationPostNotFoundError(forumPostId);

        const [updated] = await tx
          .update(forumPost)
          .set({ cleanContent: newCleanContent, moderationVersion: sql`${forumPost.moderationVersion} + 1`, updatedAt: now })
          .where(and(eq(forumPost.id, forumPostId), eq(forumPost.moderationVersion, expectedVersion)))
          .returning({ id: forumPost.id, moderationVersion: forumPost.moderationVersion });

        if (!updated) {
          const [row] = await tx.select({ moderationVersion: forumPost.moderationVersion }).from(forumPost).where(eq(forumPost.id, forumPostId));
          throw new ModerationConflictError(row?.moderationVersion ?? expectedVersion);
        }

        await tx.insert(forumPostRevision).values({
          forumPostId,
          previousCleanContent: current.cleanContent,
          editedByAdminId: adminUserId,
          editedAt: now,
        });

        const [row] = await tx
          .select(DETAIL_COLUMNS)
          .from(forumPost)
          .innerJoin(forumUser, eq(forumUser.id, forumPost.forumUserId))
          .where(eq(forumPost.id, forumPostId));
        if (!row) throw new ModerationPostNotFoundError(forumPostId);
        return toDetail(row);
      });
    },
  };
}
