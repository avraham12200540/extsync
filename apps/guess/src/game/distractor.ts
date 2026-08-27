/**
 * Transparent, explainable distractor ranking - a weighted blend of
 * simple, inspectable similarity signals. No embeddings, no external AI
 * call of any kind: every number here is a plain arithmetic function of
 * already-computed stats (see forum_user_stats).
 */

export interface DistractorCandidate {
  forumUserId: string;
  forumUsername: string;
  approvedPostCount: number;
  avgWordCount: number;
  avgQualityScore: number;
  topCategories: string[];
  firstActiveAt: Date | null;
  lastActiveAt: Date | null;
}

export class InsufficientDistractorPoolError extends Error {}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[m]![n]!;
}

/** 1 for identical (case-insensitive) usernames, decaying toward 0 as edit distance grows relative to length. */
export function usernameSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a.toLowerCase(), b.toLowerCase());
  return Math.max(0, 1 - dist / maxLen);
}

/** Jaccard similarity of two category sets; two equally-uncategorized users are treated as similar (both empty -> 1), not penalized for missing data. */
export function categorySimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersectionSize = [...setA].filter((x) => setB.has(x)).length;
  const unionSize = new Set([...setA, ...setB]).size;
  return unionSize === 0 ? 1 : intersectionSize / unionSize;
}

/** 1 when equal, decaying as the log-scaled relative difference grows - avoids one very prolific poster dominating the raw difference. */
export function closenessRatio(a: number, b: number): number {
  const logA = Math.log(a + 1);
  const logB = Math.log(b + 1);
  const diff = Math.abs(logA - logB);
  const scale = Math.max(logA, logB, 1);
  return Math.max(0, 1 - diff / (scale + 1));
}

/** Overlap of two [first,last] activity windows relative to their union; unknown on either side scores a neutral 0.5, never 0 or 1. */
export function activityPeriodSimilarity(
  a: { firstActiveAt: Date | null; lastActiveAt: Date | null },
  b: { firstActiveAt: Date | null; lastActiveAt: Date | null },
): number {
  if (!a.firstActiveAt || !a.lastActiveAt || !b.firstActiveAt || !b.lastActiveAt) return 0.5;
  const aStart = a.firstActiveAt.getTime();
  const aEnd = a.lastActiveAt.getTime();
  const bStart = b.firstActiveAt.getTime();
  const bEnd = b.lastActiveAt.getTime();
  const overlapMs = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  const unionMs = Math.max(1, Math.max(aEnd, bEnd) - Math.min(aStart, bStart));
  return overlapMs / unionMs;
}

const SIMILARITY_WEIGHTS = {
  username: 0.3,
  category: 0.2,
  postCount: 0.15,
  wordCount: 0.15,
  quality: 0.1,
  activity: 0.1,
} as const;

/** Composite 0..1 similarity score - higher means "more confusable with the target," the whole point of a good distractor. */
export function similarityScore(target: DistractorCandidate, candidate: DistractorCandidate): number {
  return (
    SIMILARITY_WEIGHTS.username * usernameSimilarity(target.forumUsername, candidate.forumUsername) +
    SIMILARITY_WEIGHTS.category * categorySimilarity(target.topCategories, candidate.topCategories) +
    SIMILARITY_WEIGHTS.postCount * closenessRatio(target.approvedPostCount, candidate.approvedPostCount) +
    SIMILARITY_WEIGHTS.wordCount * closenessRatio(target.avgWordCount, candidate.avgWordCount) +
    SIMILARITY_WEIGHTS.quality * (1 - Math.abs(target.avgQualityScore - candidate.avgQualityScore)) +
    SIMILARITY_WEIGHTS.activity * activityPeriodSimilarity(target, candidate)
  );
}

function shuffleInPlace<T>(arr: T[], random: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

interface Scored {
  candidate: DistractorCandidate;
  score: number;
}

/** Full order: score descending, ties broken by forumUserId ascending - always reproducible, used for daily-mode determinism. */
function deterministicOrder(scored: Scored[]): Scored[] {
  return [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.candidate.forumUserId < b.candidate.forumUserId ? -1 : a.candidate.forumUserId > b.candidate.forumUserId ? 1 : 0;
  });
}

/** Score descending (stable), with each same-score run independently shuffled using the injected randomness - used for free-play. */
function randomOrder(scored: Scored[], random: () => number): Scored[] {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const result: Scored[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j]!.score === sorted[i]!.score) j++;
    const group = sorted.slice(i, j);
    shuffleInPlace(group, random);
    result.push(...group);
    i = j;
  }
  return result;
}

export interface SelectDistractorsOptions {
  excludeUserIds?: Set<string>;
  /** 'deterministic' for daily mode (stable tie-break by id); 'random' for free-play (requires a cryptographically-sourced `random`). */
  mode: "deterministic" | "random";
  random?: () => number;
}

/**
 * Returns exactly `count` distinct eligible distractors, ranked by
 * similarity to `target` and never including the target itself. Throws
 * InsufficientDistractorPoolError - rather than silently returning fewer
 * than requested - if the curated pool can't supply enough after
 * excluding the target and any caller-provided exclusions.
 */
export function selectDistractors(
  target: DistractorCandidate,
  pool: DistractorCandidate[],
  count: number,
  opts: SelectDistractorsOptions,
): DistractorCandidate[] {
  if (opts.mode === "random" && !opts.random) {
    throw new Error("selectDistractors: mode 'random' requires an injected `random` function");
  }
  const exclude = opts.excludeUserIds ?? new Set<string>();
  const eligible = pool.filter((c) => c.forumUserId !== target.forumUserId && !exclude.has(c.forumUserId));
  const uniqueByUserId = [...new Map(eligible.map((c) => [c.forumUserId, c])).values()];

  if (uniqueByUserId.length < count) {
    throw new InsufficientDistractorPoolError(
      `need ${count} distinct eligible distractors for target ${target.forumUserId}, found ${uniqueByUserId.length} after exclusions (pool size ${pool.length})`,
    );
  }

  const scored: Scored[] = uniqueByUserId.map((candidate) => ({ candidate, score: similarityScore(target, candidate) }));
  const ordered = opts.mode === "deterministic" ? deterministicOrder(scored) : randomOrder(scored, opts.random!);
  return ordered.slice(0, count).map((s) => s.candidate);
}

/**
 * "Avoid repeated targets/choices within a game where possible": first
 * tries to avoid reusing ANY user already used this game (as a target or
 * a distractor). If the curated pool is too small for that, it degrades
 * through two further tiers rather than failing the whole round on
 * exclusion bookkeeping alone: first, never reuse an exact TARGET as a
 * distractor (allowing a distractor to repeat across rounds); if a small
 * pool has, over many rounds, eventually had every user serve as a
 * target at least once (so `usedTargetIds` alone would exclude the
 * entire pool), the final tier drops all repeat-avoidance and selects
 * purely by similarity (the target itself is always still excluded,
 * inside selectDistractors). Only when the pool is fundamentally too
 * small for `count` distinct users at all - regardless of any exclusion -
 * does InsufficientDistractorPoolError propagate (fail clearly, never
 * silently return fewer than requested).
 */
export function selectDistractorsWithFallback(
  target: DistractorCandidate,
  pool: DistractorCandidate[],
  count: number,
  usedAnyIds: Set<string>,
  usedTargetIds: Set<string>,
  mode: "deterministic" | "random",
  random?: () => number,
): DistractorCandidate[] {
  try {
    return selectDistractors(target, pool, count, { mode, random, excludeUserIds: usedAnyIds });
  } catch (err) {
    if (!(err instanceof InsufficientDistractorPoolError)) throw err;
  }
  try {
    return selectDistractors(target, pool, count, { mode, random, excludeUserIds: usedTargetIds });
  } catch (err) {
    if (!(err instanceof InsufficientDistractorPoolError)) throw err;
  }
  return selectDistractors(target, pool, count, { mode, random });
}
