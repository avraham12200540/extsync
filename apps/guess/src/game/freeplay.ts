import { CHOICES_PER_ROUND, FREEPLAY_ROUNDS, MAX_POSTS_PER_ROUND } from "./config";
import { canonicalOrder } from "./daily-challenge";
import type { EligibleTarget, RoundPlan } from "./daily-challenge";
import { InsufficientTargetPostsError } from "./daily-challenge";
import { selectDistractorsWithFallback } from "./distractor";
import { pickWithoutReplacement } from "./random";

export class InsufficientFreeplayPoolError extends Error {}

/**
 * Builds all FREEPLAY_ROUNDS (10) round plans for one free-play game,
 * upfront, in one call - not lazily as the player advances. That's what
 * "preselect/snapshot each round server-side" (the Stage 3 mission
 * requirement) means in practice: the caller persists this whole array
 * as Game.round_plan at game-creation time, so a later moderation/import
 * change can never alter a round this game already committed to,
 * matching the same snapshot discipline as daily-challenge.ts (just with
 * injected cryptographic randomness instead of a deterministic seed,
 * since free-play must NOT be reproducible/predictable).
 *
 * Target repeats: if the eligible pool has at least FREEPLAY_ROUNDS
 * distinct targets, every round gets a distinct one (no repeats). If the
 * pool is smaller, targets repeat via round-robin over a single
 * crypto-shuffle of the pool - spread as evenly as the pool size allows,
 * rather than "avoid repeats" being silently abandoned altogether.
 */
export function buildFreeplayRoundPlan(pool: EligibleTarget[], random: () => number): RoundPlan[] {
  if (pool.length === 0) {
    throw new InsufficientFreeplayPoolError("need at least 1 eligible target, found 0");
  }

  const canonicalPool = canonicalOrder(pool);
  const shuffledPool = pickWithoutReplacement(canonicalPool, canonicalPool.length, random);

  const usedTargetIds = new Set<string>();
  const usedAnyIds = new Set<string>();
  const rounds: RoundPlan[] = [];

  for (let index = 0; index < FREEPLAY_ROUNDS; index++) {
    const target = shuffledPool[index % shuffledPool.length]!;

    if (target.approvedPostIds.length < MAX_POSTS_PER_ROUND) {
      throw new InsufficientTargetPostsError(
        `target ${target.forumUserId} has only ${target.approvedPostIds.length} approved posts, need ${MAX_POSTS_PER_ROUND} - the pool must be pre-filtered by eligibility before calling this function`,
      );
    }

    usedTargetIds.add(target.forumUserId);
    usedAnyIds.add(target.forumUserId);

    const postIds = pickWithoutReplacement(target.approvedPostIds, MAX_POSTS_PER_ROUND, random);

    const distractors = selectDistractorsWithFallback(
      target,
      canonicalPool,
      CHOICES_PER_ROUND - 1,
      usedAnyIds,
      usedTargetIds,
      "random",
      random,
    );
    distractors.forEach((d) => usedAnyIds.add(d.forumUserId));

    const choiceUserIds = pickWithoutReplacement([target.forumUserId, ...distractors.map((d) => d.forumUserId)], CHOICES_PER_ROUND, random);

    rounds.push({ orderInGame: index + 1, targetForumUserId: target.forumUserId, postIds, choiceUserIds });
  }

  return rounds;
}
