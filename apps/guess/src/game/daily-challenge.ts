import crypto from "node:crypto";
import { CHOICES_PER_ROUND, DAILY_CHALLENGE_TIMEZONE, DAILY_ROUNDS, MAX_POSTS_PER_ROUND } from "./config";
import type { DistractorCandidate } from "./distractor";
import { selectDistractorsWithFallback } from "./distractor";
import { mulberry32, pickWithoutReplacement, seedHexToUint32 } from "./random";

export interface EligibleTarget extends DistractorCandidate {
  approvedPostIds: string[];
}

export interface RoundPlan {
  orderInGame: number;
  targetForumUserId: string;
  postIds: string[];
  choiceUserIds: string[];
}

export interface DailyChallengeSeedInput {
  dateKey: string;
  version: number;
  /** Server-only key material - never a hardcoded literal, never sent to the client, injected by the caller (a later runtime-config stage). */
  serverSecret: string;
}

export class InsufficientDailyPoolError extends Error {}
export class InsufficientTargetPostsError extends Error {}

/**
 * The Israel-calendar date for "today," as an explicit IANA-timezone
 * computation via Intl.DateTimeFormat - not a hand-written UTC-offset/DST
 * approximation. Node's ICU data (bundled by default since Node 13) fully
 * covers Asia/Jerusalem, including its DST transitions.
 */
export function computeIsraelDateKey(nowUtc: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: DAILY_CHALLENGE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(nowUtc); // en-CA formats as YYYY-MM-DD.
}

/**
 * Versioned seed derivation. The seed itself, and everything derived
 * from it, is server-only: it is never returned in any view model (see
 * view-models.ts) and never reaches a client. Changing DAILY_CHALLENGE_SEED_VERSION
 * in config.ts changes all FUTURE daily challenges' derivation without
 * touching already-published ones, since each DailyChallenge snapshots
 * its own rounds at construction time (see buildDailyChallengePlan below)
 * - a published challenge is never recomputed.
 */
export function computeDailySeed(input: DailyChallengeSeedInput): string {
  return crypto.createHash("sha256").update(`${input.version}:${input.dateKey}:${input.serverSecret}`, "utf8").digest("hex");
}

/**
 * Domain-separated sub-seed for a single round's on-screen choice order,
 * derived from the day's own seed plus that round's index. "Domain
 * separated" means this is never just "the next values pulled from the
 * same mulberry32 stream computeDailySeed feeds" - it is its own
 * independent SHA-256 over a distinct, literal namespace string
 * ("choice-order") plus the round index, so shuffling a round's choices
 * can never be correlated with, or accidentally perturb, the target/post
 * selection stream above. Same dailySeedHex + same orderInGame always
 * yields the same sub-seed (every player sees the same order for a given
 * daily round); a different round index or a different day yields an
 * unrelated one.
 */
export function computeChoiceOrderSeed(dailySeedHex: string, orderInGame: number): string {
  return crypto.createHash("sha256").update(`${dailySeedHex}:choice-order:${orderInGame}`, "utf8").digest("hex");
}

/** Stable, canonical ordering used as the base of every seeded operation below - reproducibility must never depend on incoming array/DB row order. */
export function canonicalOrder<T extends { forumUserId: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.forumUserId < b.forumUserId ? -1 : a.forumUserId > b.forumUserId ? 1 : 0));
}

/**
 * Builds the day's 5 rounds deterministically: same `pool` (a snapshot of
 * the curated, eligible-target dataset) + same `seedInput` always
 * produces the same ordered targets/posts/choices. The pool must be
 * captured by the caller as of construction time (a "dataset snapshot") -
 * this function itself has no notion of "later changes," it only
 * guarantees that identical inputs produce identical outputs.
 *
 * Once a DailyChallenge is published (its rounds persisted, e.g. via
 * daily_challenge_round.post_ids/choice_user_ids), it is NEVER
 * reconstructed - a later import/moderation change simply changes what
 * pool a *future* day's construction would see, it cannot alter this
 * result after the fact, because this function's output is what gets
 * persisted once, not recomputed on read.
 */
export function buildDailyChallengePlan(pool: EligibleTarget[], seedInput: DailyChallengeSeedInput): RoundPlan[] {
  if (pool.length < DAILY_ROUNDS) {
    throw new InsufficientDailyPoolError(`need at least ${DAILY_ROUNDS} eligible targets, found ${pool.length}`);
  }

  const canonicalPool = canonicalOrder(pool);
  const seedHex = computeDailySeed(seedInput);
  const random = mulberry32(seedHexToUint32(seedHex));

  const selectedTargets = pickWithoutReplacement(canonicalPool, DAILY_ROUNDS, random);

  const usedTargetIds = new Set<string>();
  const usedAnyIds = new Set<string>();
  const rounds: RoundPlan[] = [];

  selectedTargets.forEach((target, index) => {
    if (target.approvedPostIds.length < MAX_POSTS_PER_ROUND) {
      throw new InsufficientTargetPostsError(
        `target ${target.forumUserId} has only ${target.approvedPostIds.length} approved posts, need ${MAX_POSTS_PER_ROUND} - the pool must be pre-filtered by eligibility before calling this function`,
      );
    }
    usedTargetIds.add(target.forumUserId);
    usedAnyIds.add(target.forumUserId);

    const canonicalPostIds = [...target.approvedPostIds].sort();
    const postIds = pickWithoutReplacement(canonicalPostIds, MAX_POSTS_PER_ROUND, random);

    const distractors = selectDistractorsWithFallback(
      target,
      canonicalPool,
      CHOICES_PER_ROUND - 1,
      usedAnyIds,
      usedTargetIds,
      "deterministic",
    );
    distractors.forEach((d) => usedAnyIds.add(d.forumUserId));

    const orderInGame = index + 1;
    // Canonical order first (so the shuffle's input never depends on
    // distractor-selection iteration order), then an unbiased, per-round
    // deterministic shuffle - never the raw sorted order, which would
    // otherwise make every daily round's target position a predictable
    // function of UUID sort order instead of independently randomized.
    const canonicalChoiceIds = [target.forumUserId, ...distractors.map((d) => d.forumUserId)].sort();
    const choiceOrderRandom = mulberry32(seedHexToUint32(computeChoiceOrderSeed(seedHex, orderInGame)));
    const choiceUserIds = pickWithoutReplacement(canonicalChoiceIds, canonicalChoiceIds.length, choiceOrderRandom);

    rounds.push({ orderInGame, targetForumUserId: target.forumUserId, postIds, choiceUserIds });
  });

  return rounds;
}
