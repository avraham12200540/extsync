import { inArray, sql } from "drizzle-orm";
import type { GuessDb } from "../db/client";
import { forumPost, forumUser, forumUserStats } from "../db/schema";
import { computeForumUserStats } from "./stats";
import type { ForumUserStatsPostInput } from "./stats";

/**
 * Recomputes and upserts forum_user_stats - the one place that turns
 * persisted forum_user/forum_post rows into the derived signal
 * src/game/curated-pool-repository.ts's getEligibleTargets and
 * src/game/distractor.ts actually read. Deliberately its own small
 * interface, separate from ForumRepository (the importer's own
 * read/write seam), so future admin tooling (e.g. a manual "recompute
 * stats" action, independent of any live import) can depend on this
 * alone without pulling in importer-specific concerns like NodeBB pacing.
 */
export interface ForumUserStatsRepository {
  /**
   * Always a full recompute from source per user - never an incremental
   * patch of the existing row - so a stale prior value can never survive
   * a call that covers that user. No-op for an empty array.
   */
  recomputeForForumUserIds(forumUserIds: string[]): Promise<void>;
}

/**
 * Real, Postgres-backed implementation. Not integration-tested (no
 * PostgreSQL in this environment) - its correctness rests on (a) being a
 * thin mapping onto the already-tested schema (tests/schema.test.ts) and
 * the already-unit-tested pure computeForumUserStats, and (b) the
 * interface contract above being exhaustively exercised against the
 * in-memory fake (tests/importer/in-memory-stats-repository.ts).
 *
 * Batched by design: exactly two SELECTs (users, posts) and one
 * multi-row upsert per call, regardless of how many forumUserIds are
 * passed in - never one query per user.
 */
export function createDrizzleForumUserStatsRepository(db: GuessDb): ForumUserStatsRepository {
  return {
    async recomputeForForumUserIds(forumUserIds) {
      if (forumUserIds.length === 0) return;

      await db.transaction(async (tx) => {
        const users = await tx
          .select({ id: forumUser.id, forumUsername: forumUser.forumUsername })
          .from(forumUser)
          .where(inArray(forumUser.id, forumUserIds));
        if (users.length === 0) return;

        const posts = await tx
          .select({
            forumUserId: forumPost.forumUserId,
            moderationStatus: forumPost.moderationStatus,
            wordCount: forumPost.wordCount,
            qualityScore: forumPost.qualityScore,
            forumCategoryCid: forumPost.forumCategoryCid,
            postedAt: forumPost.postedAt,
          })
          .from(forumPost)
          .where(inArray(forumPost.forumUserId, forumUserIds));

        const postsByUser = new Map<string, ForumUserStatsPostInput[]>();
        for (const post of posts) {
          const list = postsByUser.get(post.forumUserId) ?? [];
          list.push({
            moderationStatus: post.moderationStatus,
            wordCount: post.wordCount,
            qualityScore: post.qualityScore,
            forumCategoryCid: post.forumCategoryCid,
            postedAt: post.postedAt,
          });
          postsByUser.set(post.forumUserId, list);
        }

        const rows = users.map((user) => {
          const stats = computeForumUserStats({
            username: user.forumUsername,
            posts: postsByUser.get(user.id) ?? [],
          });
          return {
            forumUserId: user.id,
            approvedPostCount: stats.approvedPostCount,
            totalPostCount: stats.totalPostCount,
            avgWordCount: stats.avgWordCount,
            avgQualityScore: stats.avgQualityScore,
            topCategories: stats.topCategories,
            usernameLength: stats.usernameLength,
            firstActiveAt: stats.firstActiveAt,
            lastActiveAt: stats.lastActiveAt,
            updatedAt: new Date(),
          };
        });

        await tx
          .insert(forumUserStats)
          .values(rows)
          .onConflictDoUpdate({
            target: forumUserStats.forumUserId,
            set: {
              approvedPostCount: sql`excluded.approved_post_count`,
              totalPostCount: sql`excluded.total_post_count`,
              avgWordCount: sql`excluded.avg_word_count`,
              avgQualityScore: sql`excluded.avg_quality_score`,
              topCategories: sql`excluded.top_categories`,
              usernameLength: sql`excluded.username_length`,
              firstActiveAt: sql`excluded.first_active_at`,
              lastActiveAt: sql`excluded.last_active_at`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      });
    },
  };
}
