/**
 * Pure, deterministic recomputation of forum_user_stats from a user's
 * persisted posts. No database access, no randomness - safe to call
 * repeatedly with the same input and always get the same output
 * (idempotent), which is exactly what the importer's post-run stats
 * refresh and any future admin "recompute" tooling both need.
 */

export interface ForumUserStatsPostInput {
  moderationStatus: string;
  wordCount: number;
  qualityScore: number;
  forumCategoryCid: string;
  postedAt: Date;
}

export interface ForumUserStatsInput {
  username: string;
  posts: ForumUserStatsPostInput[];
}

export interface ForumUserStatsValues {
  approvedPostCount: number;
  totalPostCount: number;
  avgWordCount: number;
  avgQualityScore: number;
  topCategories: string[];
  usernameLength: number;
  firstActiveAt: Date | null;
  lastActiveAt: Date | null;
}

/** How many of a user's most-frequent post categories to retain - enough for distractor.ts's Jaccard category signal to be meaningful, small enough to stay a cheap, stable summary rather than a full histogram. */
const TOP_CATEGORIES_LIMIT = 5;

/**
 * Every field except totalPostCount is derived from APPROVED posts only -
 * deliberately, not "all imported posts." Two reasons: (1) approved is the
 * only status a human has actually reviewed, so it is the only content this
 * game ever shows a player or measures a user's "writing style" against;
 * (2) the distractor candidate pool (src/game/curated-pool-repository.ts's
 * getEligibleTargets) is already restricted to users who clear the
 * approved-post eligibility threshold, so these secondary signals are only
 * ever read for users who already have qualifying approved content - there
 * is no case where broadening to pending/needs_review content would add
 * real coverage, only noise from never-reviewed material.
 *
 * totalPostCount is the one deliberate exception: it counts every
 * persisted post regardless of moderation status, because its whole
 * purpose (together with forum_user_stats' approvedPostCount <=
 * totalPostCount database check) is to show the gap between "imported" and
 * "approved" - collapsing it to approved-only would make the column
 * redundant with approvedPostCount and the check constraint meaningless.
 */
export function computeForumUserStats(input: ForumUserStatsInput): ForumUserStatsValues {
  const approvedPosts = input.posts.filter((p) => p.moderationStatus === "approved");
  const totalPostCount = input.posts.length;
  const approvedPostCount = approvedPosts.length;

  const avgWordCount =
    approvedPostCount === 0 ? 0 : Math.round(approvedPosts.reduce((sum, p) => sum + p.wordCount, 0) / approvedPostCount);

  const avgQualityScore =
    approvedPostCount === 0 ? 0 : approvedPosts.reduce((sum, p) => sum + p.qualityScore, 0) / approvedPostCount;

  const categoryCounts = new Map<string, number>();
  for (const post of approvedPosts) {
    categoryCounts.set(post.forumCategoryCid, (categoryCounts.get(post.forumCategoryCid) ?? 0) + 1);
  }
  const topCategories = [...categoryCounts.entries()]
    .sort(([cidA, countA], [cidB, countB]) => (countB !== countA ? countB - countA : cidA < cidB ? -1 : cidA > cidB ? 1 : 0))
    .slice(0, TOP_CATEGORIES_LIMIT)
    .map(([cid]) => cid);

  let firstActiveAt: Date | null = null;
  let lastActiveAt: Date | null = null;
  for (const post of approvedPosts) {
    if (!firstActiveAt || post.postedAt < firstActiveAt) firstActiveAt = post.postedAt;
    if (!lastActiveAt || post.postedAt > lastActiveAt) lastActiveAt = post.postedAt;
  }

  return {
    approvedPostCount,
    totalPostCount,
    avgWordCount,
    avgQualityScore,
    topCategories,
    usernameLength: input.username.length,
    firstActiveAt,
    lastActiveAt,
  };
}
