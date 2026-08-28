import crypto from "node:crypto";
import type { ForumUserStatsRepository } from "./forum-user-stats-repository";
import type { NodebbClient, TopicPost } from "./nodebb-client";
import { computeQualityMetrics, decideInitialModerationStatus, deriveModerationFlags } from "./quality";
import type { ForumRepository } from "./repository";
import { sanitizePost } from "./sanitize";

/**
 * Bounded, sequential importer run. Gameplay code must never import this
 * module - it exists only to be invoked from an admin-triggered or
 * cron-triggered process (a later, separate stage), never from a player
 * request path.
 *
 * "Sequential" and "one request in flight" are structural, not
 * best-effort: every NodeBB call in this file is awaited before the next
 * one starts, in a single control-flow path with no Promise.all/.race
 * over multiple requests.
 */

export interface ImportRunBudgets {
  maxTopics: number;
  maxPosts: number;
  /** Counts every NodeBB HTTP call this run makes (recent-topics pages + topic-detail pages combined). */
  maxPages: number;
  maxDurationMs: number;
}

export const DEFAULT_IMPORT_BUDGETS: ImportRunBudgets = {
  maxTopics: 20,
  maxPosts: 200,
  maxPages: 30,
  maxDurationMs: 5 * 60 * 1000,
};

/** Production default; tests inject 0 so suites run instantly. */
export const DEFAULT_PACING_MS = 1500;

export interface ImportRunDeps {
  client: Pick<NodebbClient, "getRecentTopics" | "getTopicDetail">;
  repository: ForumRepository;
  /** Recomputes forum_user_stats for every user touched by this run, once it finishes (successfully or not) - see runImport's own doc comment on why this is a distinct, separately-reported step. */
  statsRepository: ForumUserStatsRepository;
  /** Defaults to Date.now. Overridable so budget/duration tests are deterministic. */
  clock: () => number;
  /** Defaults to a real setTimeout-based sleep. Overridable so tests run instantly. */
  sleep: (ms: number) => Promise<void>;
  /** Minimum delay between consecutive outbound NodeBB requests. */
  pacingMs: number;
  budgets: ImportRunBudgets;
  triggerKind: "admin" | "cron";
  triggeredByAdminId?: string | null;
}

export function defaultImportRunDeps(
  overrides: Partial<ImportRunDeps> & Pick<ImportRunDeps, "client" | "repository" | "statsRepository">,
): ImportRunDeps {
  return {
    clock: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pacingMs: DEFAULT_PACING_MS,
    budgets: DEFAULT_IMPORT_BUDGETS,
    triggerKind: "admin",
    triggeredByAdminId: null,
    ...overrides,
  };
}

export type StopReason =
  | "completed"
  | "budget_topics"
  | "budget_posts"
  | "budget_pages"
  | "budget_duration"
  | "fatal_error";

export interface ImportRunSummary {
  importRunId: string;
  status: "success" | "partial_failure" | "failed";
  topicsProcessed: number;
  postsFetched: number;
  postsNew: number;
  /** Already-known posts re-encountered where upstream content diverged from what's stored (never overwritten). */
  postsDiverged: number;
  usersTouched: number;
  pagesFetched: number;
  stoppedReason: StopReason;
  /** Per-item failures that were isolated and did not abort the run. */
  errors: string[];
}

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

async function importOnePost(
  post: TopicPost,
  ctx: { forumCategoryCid: string; importRunId: string; repository: ForumRepository; touchedForumUids: Set<string> },
): Promise<{ isNew: boolean; diverged: boolean; isNewlyTouchedUser: boolean; forumUserInternalId: string }> {
  const forumUidKey = String(post.uid);
  const isNewlyTouchedUser = !ctx.touchedForumUids.has(forumUidKey);
  ctx.touchedForumUids.add(forumUidKey);

  const forumUser = await ctx.repository.upsertForumUser({
    forumUid: forumUidKey,
    forumUsername: post.user.username,
    forumUserslug: post.user.userslug,
  });

  const rawSha256 = sha256Hex(post.content);
  const forumPid = String(post.pid);
  const existing = await ctx.repository.findForumPostByForumPid(forumPid);

  if (existing) {
    if (existing.sha256Raw !== rawSha256) {
      await ctx.repository.markSourceDiverged(existing.id, new Date());
      return { isNew: false, diverged: true, isNewlyTouchedUser, forumUserInternalId: forumUser.id };
    }
    return { isNew: false, diverged: false, isNewlyTouchedUser, forumUserInternalId: forumUser.id };
  }

  const { cleanText, stats } = sanitizePost({
    rawHtml: post.content,
    authorUsername: post.user.username,
    authorUserslug: post.user.userslug,
  });
  const metrics = computeQualityMetrics(cleanText, stats);
  const flags = deriveModerationFlags(metrics);
  const moderationStatus = decideInitialModerationStatus(flags);

  await ctx.repository.insertForumPost({
    forumPid,
    forumTid: String(post.tid),
    forumUserId: forumUser.id,
    forumCategoryCid: ctx.forumCategoryCid,
    rawContent: post.content,
    cleanContent: cleanText,
    sha256Raw: rawSha256,
    postedAt: new Date(post.timestamp),
    importRunId: ctx.importRunId,
    moderationStatus,
    wordCount: metrics.wordCount,
    contentLength: metrics.contentLength,
    quoteRatio: metrics.quoteRatio,
    genericResponseScore: metrics.genericResponseScore,
    qualityScore: metrics.qualityScore,
    potentialLeakScore: metrics.potentialLeakScore,
    linksCount: metrics.linksCount,
    mentionsCount: metrics.mentionsCount,
    moderationFlags: flags,
  });

  return { isNew: true, diverged: false, isNewlyTouchedUser, forumUserInternalId: forumUser.id };
}

export async function runImport(deps: ImportRunDeps): Promise<ImportRunSummary> {
  const startedAt = deps.clock();
  const { budgets } = deps;

  const summary: ImportRunSummary = {
    importRunId: "",
    status: "success",
    topicsProcessed: 0,
    postsFetched: 0,
    postsNew: 0,
    postsDiverged: 0,
    usersTouched: 0,
    pagesFetched: 0,
    stoppedReason: "completed",
    errors: [],
  };

  let importRunId: string;
  try {
    const created = await deps.repository.createImportRun({
      triggerKind: deps.triggerKind,
      triggeredByAdminId: deps.triggeredByAdminId ?? null,
      sourceEndpoint: "/api/recent",
    });
    importRunId = created.id;
    summary.importRunId = importRunId;
  } catch (err) {
    // Cannot even open a run record - nothing to isolate, this is fatal.
    summary.status = "failed";
    summary.stoppedReason = "fatal_error";
    summary.errors.push(`failed to create ImportRun: ${err instanceof Error ? err.message : String(err)}`);
    return summary;
  }

  let firstRequest = true;
  const paced = async () => {
    if (!firstRequest) await deps.sleep(deps.pacingMs);
    firstRequest = false;
  };

  const durationExceeded = () => deps.clock() - startedAt >= budgets.maxDurationMs;

  let stopReason: StopReason | null = null;
  let recentPage = 1;
  const touchedForumUids = new Set<string>();
  const touchedForumUserInternalIds = new Set<string>();

  /**
   * Runs after the ImportRun row has already been finalized via
   * finishImportRun, so a stats-refresh failure can never retroactively
   * change what was already persisted as this run's own status/error
   * summary - a failed derived-stats refresh is a different failure mode
   * than a failed import, and must never make a genuinely successful
   * import report itself as failed (or the reverse: hide a real import
   * failure behind a stats-only success). Surfaced only via this
   * in-memory summary's errors array for the immediate caller's
   * visibility (e.g. admin audit metadata), never by mutating
   * summary.status or re-calling finishImportRun.
   */
  async function refreshTouchedStats(): Promise<void> {
    if (touchedForumUserInternalIds.size === 0) return;
    try {
      await deps.statsRepository.recomputeForForumUserIds([...touchedForumUserInternalIds]);
    } catch (err) {
      summary.errors.push(`stats refresh: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    outer: while (!stopReason) {
      if (durationExceeded()) {
        stopReason = "budget_duration";
        break;
      }
      if (summary.pagesFetched >= budgets.maxPages) {
        stopReason = "budget_pages";
        break;
      }

      await paced();
      const recent = await deps.client.getRecentTopics(recentPage);
      summary.pagesFetched += 1;
      await deps.repository.setImportRunCursor(importRunId, String(recentPage));

      if (recent.topics.length === 0) {
        stopReason = "completed";
        break;
      }

      for (const topic of recent.topics) {
        if (durationExceeded()) {
          stopReason = "budget_duration";
          break outer;
        }
        if (summary.topicsProcessed >= budgets.maxTopics) {
          stopReason = "budget_topics";
          break outer;
        }
        if (summary.pagesFetched >= budgets.maxPages) {
          stopReason = "budget_pages";
          break outer;
        }
        if (summary.postsFetched >= budgets.maxPosts) {
          stopReason = "budget_posts";
          break outer;
        }

        try {
          await paced();
          const topicDetail = await deps.client.getTopicDetail(topic.tid, topic.slug);
          summary.pagesFetched += 1;
          summary.topicsProcessed += 1;

          for (const post of topicDetail.posts) {
            if (summary.postsFetched >= budgets.maxPosts) {
              stopReason = "budget_posts";
              break;
            }
            if (durationExceeded()) {
              stopReason = "budget_duration";
              break;
            }
            try {
              const result = await importOnePost(post, {
                forumCategoryCid: String(topicDetail.cid),
                importRunId,
                repository: deps.repository,
                touchedForumUids,
              });
              summary.postsFetched += 1;
              if (result.isNew) summary.postsNew += 1;
              if (result.diverged) summary.postsDiverged += 1;
              if (result.isNewlyTouchedUser) summary.usersTouched += 1;
              touchedForumUserInternalIds.add(result.forumUserInternalId);
              await deps.repository.incrementImportRunCounters(importRunId, {
                postsFetched: 1,
                postsNew: result.isNew ? 1 : 0,
                postsUpdated: result.diverged ? 1 : 0,
                usersTouched: result.isNewlyTouchedUser ? 1 : 0,
              });
            } catch (err) {
              // Failure isolation: one bad post never aborts the run.
              summary.errors.push(`post pid=${post.pid}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          if (stopReason) break outer;
        } catch (err) {
          // Failure isolation: one bad topic (e.g. a transient NodeBB
          // error that exhausted the client's own retries) never aborts
          // the run - move on to the next topic.
          summary.errors.push(`topic tid=${topic.tid}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      recentPage += 1;
      if (recent.topics.length < 20) {
        // Fewer topics than a full page implies this was the last page.
        stopReason = "completed";
      }
    }
  } catch (err) {
    // Fatal, unisolated failure (e.g. the very first getRecentTopics call
    // itself failed after exhausting the client's retries).
    summary.status = summary.topicsProcessed > 0 || summary.postsFetched > 0 ? "partial_failure" : "failed";
    summary.stoppedReason = "fatal_error";
    summary.errors.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    await deps.repository.finishImportRun(importRunId, {
      status: summary.status,
      errorSummary: summary.errors.join("; ").slice(0, 2000),
    });
    await refreshTouchedStats();
    return summary;
  }

  summary.stoppedReason = stopReason ?? "completed";
  summary.status = summary.errors.length > 0 ? "partial_failure" : "success";

  await deps.repository.finishImportRun(importRunId, {
    status: summary.status,
    errorSummary: summary.errors.length > 0 ? summary.errors.join("; ").slice(0, 2000) : null,
  });
  await refreshTouchedStats();

  return summary;
}
