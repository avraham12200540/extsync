import { and, eq } from "drizzle-orm";
import type { GuessDb } from "../db/client";
import { dailyChallenge, dailyChallengeRound, forumPost, forumUser, forumUserStats } from "../db/schema";
import type { EligibleTarget, RoundPlan } from "./daily-challenge";
import { resolveEligibility } from "./eligibility";
import type { CuratedPoolRepository, DailyChallengeRecord } from "./curated-pool-repository";

/**
 * Real Postgres-backed CuratedPoolRepository. Not integration-tested (no
 * PostgreSQL in this environment). Reconciles admin_override with the
 * stored computed_eligible signal via the same pure resolveEligibility
 * function the domain layer already uses, rather than trusting
 * computed_eligible alone (which is a cache, recomputed out of band - see
 * forum.ts's schema comment).
 */
export function createDrizzleCuratedPoolRepository(db: GuessDb): CuratedPoolRepository {
  return {
    async getEligibleTargets(): Promise<EligibleTarget[]> {
      const rows = await db
        .select({ user: forumUser, stats: forumUserStats })
        .from(forumUser)
        .innerJoin(forumUserStats, eq(forumUserStats.forumUserId, forumUser.id));

      const eligible: EligibleTarget[] = [];
      for (const { user, stats } of rows) {
        const decision = resolveEligibility({
          accountStatus: user.accountStatus,
          isSystemOrBot: user.isSystemOrBot,
          adminOverride: user.adminOverride,
          approvedPostCount: stats.approvedPostCount,
        });
        if (!decision.eligible) continue;

        const posts = await db
          .select({ id: forumPost.id })
          .from(forumPost)
          .where(and(eq(forumPost.forumUserId, user.id), eq(forumPost.moderationStatus, "approved")));

        eligible.push({
          forumUserId: user.id,
          forumUsername: user.forumUsername,
          approvedPostCount: stats.approvedPostCount,
          avgWordCount: stats.avgWordCount,
          avgQualityScore: stats.avgQualityScore,
          topCategories: (stats.topCategories as string[]) ?? [],
          firstActiveAt: stats.firstActiveAt,
          lastActiveAt: stats.lastActiveAt,
          approvedPostIds: posts.map((p) => p.id),
        });
      }
      return eligible;
    },

    async getPublishedDailyChallenge(dateKey): Promise<DailyChallengeRecord | null> {
      const [challenge] = await db
        .select()
        .from(dailyChallenge)
        .where(and(eq(dailyChallenge.date, dateKey), eq(dailyChallenge.status, "published")));
      if (!challenge) return null;

      const rounds = await db
        .select()
        .from(dailyChallengeRound)
        .where(eq(dailyChallengeRound.dailyChallengeId, challenge.id))
        .orderBy(dailyChallengeRound.orderInGame);

      return {
        id: challenge.id,
        dateKey,
        rounds: rounds.map((r) => ({
          orderInGame: r.orderInGame,
          targetForumUserId: r.targetForumUserId,
          postIds: r.postIds as string[],
          choiceUserIds: r.choiceUserIds as string[],
        })),
      };
    },

    async publishDailyChallenge(dateKey, rounds: RoundPlan[]): Promise<DailyChallengeRecord> {
      return db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(dailyChallenge)
          .values({ date: dateKey, status: "published" })
          .onConflictDoNothing({ target: dailyChallenge.date })
          .returning();

        if (!inserted) {
          const [existing] = await tx.select().from(dailyChallenge).where(eq(dailyChallenge.date, dateKey));
          if (!existing) throw new Error("publishDailyChallenge: no row after conflict");
          const existingRounds = await tx
            .select()
            .from(dailyChallengeRound)
            .where(eq(dailyChallengeRound.dailyChallengeId, existing.id))
            .orderBy(dailyChallengeRound.orderInGame);
          return {
            id: existing.id,
            dateKey,
            rounds: existingRounds.map((r) => ({
              orderInGame: r.orderInGame,
              targetForumUserId: r.targetForumUserId,
              postIds: r.postIds as string[],
              choiceUserIds: r.choiceUserIds as string[],
            })),
          };
        }

        await tx.insert(dailyChallengeRound).values(
          rounds.map((r) => ({
            dailyChallengeId: inserted.id,
            orderInGame: r.orderInGame,
            targetForumUserId: r.targetForumUserId,
            postIds: r.postIds,
            choiceUserIds: r.choiceUserIds,
          })),
        );

        return { id: inserted.id, dateKey, rounds };
      });
    },
  };
}
