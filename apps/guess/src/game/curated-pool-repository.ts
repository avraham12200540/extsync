import type { EligibleTarget, RoundPlan } from "./daily-challenge";

/**
 * Supplies the "curated dataset snapshot" daily-challenge.ts and
 * freeplay.ts are written against (they take a pool as a plain argument,
 * deliberately staying pure/testable - see Stage 3). This is the one
 * piece that actually fetches it, and the one piece that persists a
 * daily challenge's published rounds so every later request for the same
 * date reads back the same plan rather than reconstructing it.
 */

export interface DailyChallengeRecord {
  id: string;
  dateKey: string;
  rounds: RoundPlan[];
}

export interface CuratedPoolRepository {
  /** Effective-eligible targets (admin override reconciled with the computed signal - see src/game/eligibility.ts), each with enough approved post ids to fill a round. */
  getEligibleTargets(now: Date): Promise<EligibleTarget[]>;
  getPublishedDailyChallenge(dateKey: string): Promise<DailyChallengeRecord | null>;
  /** Idempotent by dateKey - a concurrent publish for the same date returns the row that actually won, never a second one. */
  publishDailyChallenge(dateKey: string, rounds: RoundPlan[]): Promise<DailyChallengeRecord>;
}

export function createInMemoryCuratedPoolRepository(
  deps: { generateId: () => string },
  seedTargets: EligibleTarget[] = [],
): CuratedPoolRepository & { targets: EligibleTarget[]; challenges: Map<string, DailyChallengeRecord> } {
  const targets = [...seedTargets];
  const challenges = new Map<string, DailyChallengeRecord>();

  return {
    targets,
    challenges,
    async getEligibleTargets() {
      return targets;
    },
    async getPublishedDailyChallenge(dateKey) {
      return challenges.get(dateKey) ?? null;
    },
    async publishDailyChallenge(dateKey, rounds) {
      const existing = challenges.get(dateKey);
      if (existing) return existing;
      const record: DailyChallengeRecord = { id: deps.generateId(), dateKey, rounds };
      challenges.set(dateKey, record);
      return record;
    },
  };
}
