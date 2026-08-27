import type { CuratedPoolRepository, DailyChallengeRecord } from "./curated-pool-repository";
import { DAILY_CHALLENGE_SEED_VERSION } from "./config";
import { buildDailyChallengePlan, computeIsraelDateKey } from "./daily-challenge";

/**
 * The first request for a given Israel-calendar day triggers
 * construction (buildDailyChallengePlan, pure/deterministic) and
 * publication; every subsequent request for that same day just reads the
 * already-published rows back - `publishDailyChallenge`'s idempotent-by-date
 * semantics (backed by daily_challenge's unique `date` index) mean a race
 * between two simultaneous "first players of the day" still converges on
 * exactly one published challenge, never two.
 */
export async function getOrPublishTodaysDailyChallenge(
  pool: CuratedPoolRepository,
  now: Date,
  serverSecret: string,
): Promise<DailyChallengeRecord> {
  const dateKey = computeIsraelDateKey(now);
  const existing = await pool.getPublishedDailyChallenge(dateKey);
  if (existing) return existing;

  const targets = await pool.getEligibleTargets(now);
  const rounds = buildDailyChallengePlan(targets, { dateKey, version: DAILY_CHALLENGE_SEED_VERSION, serverSecret });
  return pool.publishDailyChallenge(dateKey, rounds);
}
