import { eq, sql } from "drizzle-orm";
import type { GuessDb } from "../db/client";
import { forumPost, forumUser, importRun } from "../db/schema";

/**
 * The importer never touches the database directly - every read/write it
 * needs goes through this interface. That is what makes the importer's
 * paging/budget/pacing/dedup logic unit-testable without PostgreSQL: swap
 * `createDrizzleForumRepository` for an in-memory fake in tests (see
 * tests/importer/in-memory-repository.ts) and the same run-import code
 * runs against either.
 */

export interface UpsertForumUserInput {
  forumUid: string;
  forumUsername: string;
  forumUserslug: string;
}

export interface ForumUserRecord {
  id: string;
  forumUid: string;
  forumUsername: string;
  forumUserslug: string;
}

export interface InsertForumPostInput {
  forumPid: string;
  forumTid: string;
  forumUserId: string;
  forumCategoryCid: string;
  rawContent: string;
  cleanContent: string;
  sha256Raw: string;
  postedAt: Date;
  importRunId: string;
  moderationStatus: "pending" | "needs_review";
  wordCount: number;
  contentLength: number;
  quoteRatio: number;
  genericResponseScore: number;
  qualityScore: number;
  potentialLeakScore: number;
  linksCount: number;
  mentionsCount: number;
  moderationFlags: Array<{ code: string; reason: string }>;
}

export interface ForumPostRecord {
  id: string;
  forumPid: string;
  sha256Raw: string;
  moderationStatus: string;
  sourceDiverged: boolean;
}

export interface CreateImportRunInput {
  triggerKind: "admin" | "cron";
  triggeredByAdminId?: string | null;
  sourceEndpoint: string;
}

export interface ImportRunCountersDelta {
  postsFetched?: number;
  postsNew?: number;
  postsUpdated?: number;
  usersTouched?: number;
  rateLimitEvents?: number;
}

export interface FinishImportRunInput {
  status: "success" | "partial_failure" | "failed";
  errorSummary?: string | null;
}

export interface ForumRepository {
  /** Insert-or-update by forum_uid; username/userslug can legitimately change on the forum. */
  upsertForumUser(input: UpsertForumUserInput): Promise<ForumUserRecord>;
  findForumPostByForumPid(forumPid: string): Promise<ForumPostRecord | null>;
  /** Caller must have already checked findForumPostByForumPid returned null - this never upserts. */
  insertForumPost(input: InsertForumPostInput): Promise<ForumPostRecord>;
  /** Records that a re-fetch of an already-known post found different upstream content, without touching raw_content. */
  markSourceDiverged(forumPostId: string, when: Date): Promise<void>;
  createImportRun(input: CreateImportRunInput): Promise<{ id: string }>;
  incrementImportRunCounters(importRunId: string, delta: ImportRunCountersDelta): Promise<void>;
  setImportRunCursor(importRunId: string, cursor: string | null): Promise<void>;
  finishImportRun(importRunId: string, input: FinishImportRunInput): Promise<void>;
}

/**
 * Real implementation, backed by the live Postgres schema via Drizzle.
 * Not exercised by any test in this slice - there is no PostgreSQL
 * available in this environment. Its correctness rests on: (a) it being a
 * thin, direct mapping onto the already-tested schema (see
 * tests/schema.test.ts), and (b) the interface contract above being
 * exhaustively exercised against the in-memory fake, which every method
 * here implements identically in shape.
 */
export function createDrizzleForumRepository(db: GuessDb): ForumRepository {
  return {
    async upsertForumUser(input) {
      const [row] = await db
        .insert(forumUser)
        .values({
          forumUid: input.forumUid,
          forumUsername: input.forumUsername,
          forumUserslug: input.forumUserslug,
        })
        .onConflictDoUpdate({
          target: forumUser.forumUid,
          set: {
            forumUsername: input.forumUsername,
            forumUserslug: input.forumUserslug,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!row) throw new Error("upsertForumUser: insert/update returned no row");
      return {
        id: row.id,
        forumUid: row.forumUid,
        forumUsername: row.forumUsername,
        forumUserslug: row.forumUserslug,
      };
    },

    async findForumPostByForumPid(forumPid) {
      const [row] = await db.select().from(forumPost).where(eq(forumPost.forumPid, forumPid)).limit(1);
      if (!row) return null;
      return {
        id: row.id,
        forumPid: row.forumPid,
        sha256Raw: row.sha256Raw,
        moderationStatus: row.moderationStatus,
        sourceDiverged: row.sourceDiverged,
      };
    },

    async insertForumPost(input) {
      const [row] = await db
        .insert(forumPost)
        .values({
          forumPid: input.forumPid,
          forumTid: input.forumTid,
          forumUserId: input.forumUserId,
          forumCategoryCid: input.forumCategoryCid,
          rawContent: input.rawContent,
          cleanContent: input.cleanContent,
          sha256Raw: input.sha256Raw,
          postedAt: input.postedAt,
          importRunId: input.importRunId,
          moderationStatus: input.moderationStatus,
          wordCount: input.wordCount,
          contentLength: input.contentLength,
          quoteRatio: input.quoteRatio,
          genericResponseScore: input.genericResponseScore,
          qualityScore: input.qualityScore,
          potentialLeakScore: input.potentialLeakScore,
          linksCount: input.linksCount,
          mentionsCount: input.mentionsCount,
          moderationFlags: input.moderationFlags,
        })
        .returning();
      if (!row) throw new Error("insertForumPost: insert returned no row");
      return {
        id: row.id,
        forumPid: row.forumPid,
        sha256Raw: row.sha256Raw,
        moderationStatus: row.moderationStatus,
        sourceDiverged: row.sourceDiverged,
      };
    },

    async markSourceDiverged(forumPostId, when) {
      await db
        .update(forumPost)
        .set({
          sourceDiverged: true,
          sourceDivergedAt: when,
          // Conservative: content changing upstream after approval means a
          // human should look again before it's trusted for a game round.
          // Never escalates a post that was never approved in the first place.
          moderationStatus: sql`CASE WHEN ${forumPost.moderationStatus} = 'approved' THEN 'needs_review' ELSE ${forumPost.moderationStatus} END`,
          updatedAt: when,
        })
        .where(eq(forumPost.id, forumPostId));
    },

    async createImportRun(input) {
      const [row] = await db
        .insert(importRun)
        .values({
          triggerKind: input.triggerKind,
          triggeredByAdminId: input.triggeredByAdminId ?? null,
          sourceEndpoint: input.sourceEndpoint,
          status: "running",
        })
        .returning({ id: importRun.id });
      if (!row) throw new Error("createImportRun: insert returned no row");
      return { id: row.id };
    },

    async incrementImportRunCounters(importRunId, delta) {
      await db
        .update(importRun)
        .set({
          postsFetched: sql`${importRun.postsFetched} + ${delta.postsFetched ?? 0}`,
          postsNew: sql`${importRun.postsNew} + ${delta.postsNew ?? 0}`,
          postsUpdated: sql`${importRun.postsUpdated} + ${delta.postsUpdated ?? 0}`,
          usersTouched: sql`${importRun.usersTouched} + ${delta.usersTouched ?? 0}`,
          rateLimitEvents: sql`${importRun.rateLimitEvents} + ${delta.rateLimitEvents ?? 0}`,
        })
        .where(eq(importRun.id, importRunId));
    },

    async setImportRunCursor(importRunId, cursor) {
      await db.update(importRun).set({ cursorUsed: cursor }).where(eq(importRun.id, importRunId));
    },

    async finishImportRun(importRunId, input) {
      await db
        .update(importRun)
        .set({
          status: input.status,
          errorSummary: input.errorSummary ?? null,
          finishedAt: new Date(),
        })
        .where(eq(importRun.id, importRunId));
    },
  };
}
