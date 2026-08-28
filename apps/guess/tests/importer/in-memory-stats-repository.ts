import type { ForumUserStatsRepository } from "../../src/importer/forum-user-stats-repository";
import { computeForumUserStats } from "../../src/importer/stats";
import type { ForumUserStatsPostInput, ForumUserStatsValues } from "../../src/importer/stats";
import type { InMemoryForumRepository } from "./in-memory-repository";

export interface InMemoryForumUserStatsRepository extends ForumUserStatsRepository {
  /** Every persisted row, keyed by forum_user_id (the internal uuid, matching the real schema's primary key). */
  rows: Map<string, ForumUserStatsValues>;
  /** One entry per recomputeForForumUserIds call, in order - lets tests assert exactly which users a given call covered. */
  recomputeCalls: string[][];
}

/**
 * Mirrors createDrizzleForumUserStatsRepository's contract - reads
 * directly from an InMemoryForumRepository's own users/posts maps (one
 * pass over all posts, not a query per user) and always fully overwrites
 * a covered user's row, exactly like the real ON CONFLICT DO UPDATE
 * upsert - so the same idempotency/staleness guarantees hold here too.
 */
export function createInMemoryForumUserStatsRepository(forumRepo: InMemoryForumRepository): InMemoryForumUserStatsRepository {
  const rows = new Map<string, ForumUserStatsValues>();
  const recomputeCalls: string[][] = [];

  return {
    rows,
    recomputeCalls,
    async recomputeForForumUserIds(forumUserIds) {
      recomputeCalls.push([...forumUserIds]);
      if (forumUserIds.length === 0) return;

      const usersById = new Map([...forumRepo.users.values()].map((u) => [u.id, u]));

      const postsByUser = new Map<string, ForumUserStatsPostInput[]>();
      for (const post of forumRepo.posts.values()) {
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

      for (const forumUserId of forumUserIds) {
        const user = usersById.get(forumUserId);
        if (!user) continue;
        const stats = computeForumUserStats({
          username: user.forumUsername,
          posts: postsByUser.get(forumUserId) ?? [],
        });
        rows.set(forumUserId, stats);
      }
    },
  };
}
