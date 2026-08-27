import { and, eq, sql } from "drizzle-orm";
import type { GuessDb } from "../db/client";
import { game, gameRound, guess as guessTable, roundChoice, roundPost } from "../db/schema";
import { CHOICES_PER_ROUND, GAME_EXPIRY_MS, ROUND_EXPIRY_MS, isRoundExhausted, netScoreForRound } from "./config";
import {
  ForbiddenGameAccessError,
  GameNotFoundError,
  InvalidChoiceError,
  RoundNotActiveError,
  RoundNotFoundError,
} from "./unit-of-work";
import type {
  AdvanceResult,
  ForumContentLookup,
  GameRecord,
  GameUnitOfWork,
  RoundPlanEntry,
  RoundRecord,
  SubmitGuessResult,
} from "./unit-of-work";

/** The type of `tx` inside `db.transaction(async (tx) => ...)` - distinct from GuessDb itself (it lacks `$client`), extracted structurally so helpers can accept either a top-level db or an open transaction. */
type Tx = Parameters<Parameters<GuessDb["transaction"]>[0]>[0];
type Executor = GuessDb | Tx;

/**
 * Real Postgres-backed implementation of GameUnitOfWork, mirroring
 * createInMemoryGameUnitOfWork's exact state-machine logic against the
 * live schema. Every mutating method runs inside `db.transaction(...)`
 * and takes a `SELECT ... FOR UPDATE` row lock on the game/round before
 * reading or writing it - the same serialization
 * tests/game/unit-of-work.test.ts's KeyedMutex simulates for the
 * in-memory fake.
 *
 * NOT integration-tested: there is no PostgreSQL available in this
 * environment, so nothing here has ever executed against a real
 * database. Its correctness rests on (a) being a direct, mechanical
 * mapping of the already-tested in-memory logic onto the already-tested
 * schema (see tests/schema.test.ts), and (b) TypeScript's structural
 * check that it satisfies the exact same GameUnitOfWork interface the
 * in-memory fake does. A later, approval-gated stage with a real
 * database is required before this can be trusted to actually behave
 * correctly under real transactions/locks/constraint violations.
 */
export function createDrizzleGameUnitOfWork(db: GuessDb): GameUnitOfWork {
  function toGameRecord(row: typeof game.$inferSelect): GameRecord {
    return {
      id: row.id,
      playerSessionId: row.playerSessionId,
      mode: row.mode,
      dailyChallengeId: row.dailyChallengeId,
      roundPlan: row.roundPlan as RoundPlanEntry[],
      totalRounds: row.totalRounds,
      currentRoundIndex: row.currentRoundIndex,
      totalScore: row.totalScore,
      status: row.status,
      shareToken: row.shareToken,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      expiresAt: row.expiresAt,
    };
  }

  async function loadRound(tx: Executor, gameId: string, roundId: string): Promise<RoundRecord | null> {
    const [roundRow] = await tx
      .select()
      .from(gameRound)
      .where(and(eq(gameRound.id, roundId), eq(gameRound.gameId, gameId)))
      .for("update");
    if (!roundRow) return null;
    const posts = await tx.select().from(roundPost).where(eq(roundPost.gameRoundId, roundId)).orderBy(roundPost.displayOrder);
    const choices = await tx.select().from(roundChoice).where(eq(roundChoice.gameRoundId, roundId)).orderBy(roundChoice.displayPosition);
    return {
      id: roundRow.id,
      gameId: roundRow.gameId,
      orderInGame: roundRow.orderInGame,
      targetForumUserId: roundRow.targetForumUserId,
      status: roundRow.status,
      hintsRevealedCount: roundRow.hintsRevealedCount,
      wrongGuessCount: roundRow.wrongGuessCount,
      scoreAwarded: roundRow.scoreAwarded,
      activatedAt: roundRow.activatedAt,
      resolvedAt: roundRow.resolvedAt,
      expiresAt: roundRow.expiresAt,
      posts: posts.map((p) => ({ displayOrder: p.displayOrder, forumPostId: p.forumPostId, cleanContent: "", revealed: p.revealed })),
      choices: choices.map((c) => ({ choiceId: c.choiceId, forumUserId: c.forumUserId, username: "", displayPosition: c.displayPosition })),
    };
  }

  async function expireIfNeeded(tx: Executor, gameRow: typeof game.$inferSelect, now: Date): Promise<void> {
    if (gameRow.status === "in_progress" && now.getTime() >= gameRow.expiresAt.getTime()) {
      await tx.update(game).set({ status: "abandoned" }).where(eq(game.id, gameRow.id));
    }
  }

  async function materializeRound(
    tx: Executor,
    gameRow: typeof game.$inferSelect,
    orderInGame: number,
    now: Date,
    content: ForumContentLookup,
  ): Promise<RoundRecord> {
    const [existing] = await tx
      .select()
      .from(gameRound)
      .where(and(eq(gameRound.gameId, gameRow.id), eq(gameRound.orderInGame, orderInGame)));
    if (existing) return (await loadRound(tx, gameRow.id, existing.id))!;

    const plan = (gameRow.roundPlan as RoundPlanEntry[])[orderInGame - 1];
    if (!plan) throw new RoundNotFoundError(`game ${gameRow.id} has no round plan entry for order ${orderInGame}`);

    const [roundRow] = await tx
      .insert(gameRound)
      .values({
        gameId: gameRow.id,
        orderInGame,
        targetForumUserId: plan.targetForumUserId,
        status: "active",
        hintsRevealedCount: 1,
        wrongGuessCount: 0,
        scoreAwarded: 0,
        activatedAt: now,
        expiresAt: new Date(now.getTime() + ROUND_EXPIRY_MS),
      })
      .returning();
    if (!roundRow) throw new Error("materializeRound: insert returned no row");

    await tx.insert(roundPost).values(
      await Promise.all(
        plan.postIds.map(async (forumPostId, i) => ({
          gameRoundId: roundRow.id,
          forumPostId,
          displayOrder: i + 1,
          revealed: i === 0,
        })),
      ),
    );

    const positions = [...Array(CHOICES_PER_ROUND).keys()].map((i) => i + 1);
    await tx.insert(roundChoice).values(
      plan.choiceUserIds.map((forumUserId, i) => ({
        gameRoundId: roundRow.id,
        forumUserId,
        displayPosition: positions[i]!,
      })),
    );

    return (await loadRound(tx, gameRow.id, roundRow.id))!;
  }

  return {
    async createOrResumeDailyGame({ playerSessionId, dailyChallengeId, roundPlan, now }) {
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(game)
          .where(and(eq(game.dailyChallengeId, dailyChallengeId), eq(game.playerSessionId, playerSessionId)));
        if (existing) return { game: toGameRecord(existing), created: false };

        const [row] = await tx
          .insert(game)
          .values({
            playerSessionId,
            mode: "daily",
            dailyChallengeId,
            roundPlan,
            totalRounds: roundPlan.length,
            currentRoundIndex: 0,
            totalScore: 0,
            status: "in_progress",
            startedAt: now,
            expiresAt: new Date(now.getTime() + GAME_EXPIRY_MS),
          })
          .onConflictDoNothing({ target: [game.dailyChallengeId, game.playerSessionId] })
          .returning();

        if (row) return { game: toGameRecord(row), created: true };

        // Lost the race to a concurrent identical request - the unique
        // partial index (uq_game_one_daily_per_session) means exactly one
        // insert wins; return the row it created.
        const [afterConflict] = await tx
          .select()
          .from(game)
          .where(and(eq(game.dailyChallengeId, dailyChallengeId), eq(game.playerSessionId, playerSessionId)));
        if (!afterConflict) throw new Error("createOrResumeDailyGame: no row after conflict");
        return { game: toGameRecord(afterConflict), created: false };
      });
    },

    async createFreeplayGame({ playerSessionId, roundPlan, now }) {
      const [row] = await db
        .insert(game)
        .values({
          playerSessionId,
          mode: "freeplay",
          dailyChallengeId: null,
          roundPlan,
          totalRounds: roundPlan.length,
          currentRoundIndex: 0,
          totalScore: 0,
          status: "in_progress",
          startedAt: now,
          expiresAt: new Date(now.getTime() + GAME_EXPIRY_MS),
        })
        .returning();
      if (!row) throw new Error("createFreeplayGame: insert returned no row");
      return toGameRecord(row);
    },

    async getGame(gameId) {
      const [row] = await db.select().from(game).where(eq(game.id, gameId));
      return row ? toGameRecord(row) : null;
    },

    async getGameByShareToken(shareToken) {
      const [row] = await db.select().from(game).where(eq(game.shareToken, shareToken));
      return row ? toGameRecord(row) : null;
    },

    async getCurrentRound(gameId, playerSessionId, now, content) {
      return db.transaction(async (tx) => {
        const [gameRow] = await tx.select().from(game).where(eq(game.id, gameId)).for("update");
        if (!gameRow) throw new GameNotFoundError(gameId);
        if (gameRow.playerSessionId !== playerSessionId) {
          throw new ForbiddenGameAccessError(`session ${playerSessionId} does not own game ${gameId}`);
        }
        await expireIfNeeded(tx, gameRow, now);
        return materializeRound(tx, gameRow, gameRow.currentRoundIndex + 1, now, content);
      });
    },

    async revealNextHint(gameId, roundId, playerSessionId, now) {
      return db.transaction(async (tx) => {
        const [gameRow] = await tx.select().from(game).where(eq(game.id, gameId)).for("update");
        if (!gameRow) throw new GameNotFoundError(gameId);
        if (gameRow.playerSessionId !== playerSessionId) {
          throw new ForbiddenGameAccessError(`session ${playerSessionId} does not own game ${gameId}`);
        }
        const round = await loadRound(tx, gameId, roundId);
        if (!round) throw new RoundNotFoundError(roundId);
        if (round.status !== "active" || now.getTime() >= round.expiresAt.getTime()) {
          if (round.status === "active") {
            await tx.update(gameRound).set({ status: "expired", resolvedAt: now, scoreAwarded: 0 }).where(eq(gameRound.id, roundId));
          }
          throw new RoundNotActiveError(`round ${roundId} is not active`);
        }
        if (round.hintsRevealedCount < round.posts.length) {
          const nextOrder = round.hintsRevealedCount + 1;
          await tx.update(gameRound).set({ hintsRevealedCount: nextOrder }).where(eq(gameRound.id, roundId));
          await tx
            .update(roundPost)
            .set({ revealed: true, revealedAt: now })
            .where(and(eq(roundPost.gameRoundId, roundId), eq(roundPost.displayOrder, nextOrder)));
        }
        return (await loadRound(tx, gameId, roundId))!;
      });
    },

    async submitGuess(gameId, roundId, playerSessionId, choiceId, now): Promise<SubmitGuessResult> {
      return db.transaction(async (tx) => {
        const [gameRow] = await tx.select().from(game).where(eq(game.id, gameId)).for("update");
        if (!gameRow) throw new GameNotFoundError(gameId);
        if (gameRow.playerSessionId !== playerSessionId) {
          throw new ForbiddenGameAccessError(`session ${playerSessionId} does not own game ${gameId}`);
        }

        const [existingGuess] = await tx
          .select()
          .from(guessTable)
          .where(
            and(
              eq(guessTable.gameRoundId, roundId),
              eq(guessTable.playerSessionId, playerSessionId),
              eq(guessTable.choiceId, choiceId),
            ),
          );
        const round = await loadRound(tx, gameId, roundId);
        if (!round) throw new RoundNotFoundError(roundId);

        if (existingGuess) {
          return {
            round,
            guess: {
              id: existingGuess.id,
              roundId: existingGuess.gameRoundId,
              choiceId: existingGuess.choiceId,
              playerSessionId: existingGuess.playerSessionId,
              isCorrect: existingGuess.isCorrect,
              attemptNumber: existingGuess.attemptNumber,
            },
            wasNewGuess: false,
          };
        }

        if (round.status !== "active" || now.getTime() >= round.expiresAt.getTime()) {
          throw new RoundNotActiveError(`round ${roundId} is not active`);
        }

        const choice = round.choices.find((c) => c.choiceId === choiceId);
        if (!choice) throw new InvalidChoiceError(`choice ${choiceId} does not belong to round ${roundId}`);

        const isCorrect = choice.forumUserId === round.targetForumUserId;
        const [attemptCountRow] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(guessTable)
          .where(eq(guessTable.gameRoundId, roundId));
        const attemptNumber = Number(attemptCountRow?.count ?? 0) + 1;

        const [guessRow] = await tx
          .insert(guessTable)
          .values({ gameRoundId: roundId, choiceId, playerSessionId, isCorrect, attemptNumber })
          .returning();
        if (!guessRow) throw new Error("submitGuess: insert returned no row");

        if (isCorrect) {
          const scoreAwarded = netScoreForRound(Math.max(1, round.hintsRevealedCount), round.wrongGuessCount);
          await tx
            .update(gameRound)
            .set({ status: "resolved_correct", resolvedAt: now, scoreAwarded })
            .where(eq(gameRound.id, roundId));
          await tx
            .update(game)
            .set({ totalScore: sql`${game.totalScore} + ${scoreAwarded}` })
            .where(eq(game.id, gameId));
        } else {
          const newWrongCount = round.wrongGuessCount + 1;
          if (isRoundExhausted(newWrongCount)) {
            await tx
              .update(gameRound)
              .set({ status: "resolved_incorrect", resolvedAt: now, scoreAwarded: 0, wrongGuessCount: newWrongCount })
              .where(eq(gameRound.id, roundId));
          } else {
            await tx.update(gameRound).set({ wrongGuessCount: newWrongCount }).where(eq(gameRound.id, roundId));
          }
        }

        const finalRound = (await loadRound(tx, gameId, roundId))!;
        return {
          round: finalRound,
          guess: {
            id: guessRow.id,
            roundId: guessRow.gameRoundId,
            choiceId: guessRow.choiceId,
            playerSessionId: guessRow.playerSessionId,
            isCorrect: guessRow.isCorrect,
            attemptNumber: guessRow.attemptNumber,
          },
          wasNewGuess: true,
        };
      });
    },

    async advanceToNextRound(gameId, playerSessionId, now, content): Promise<AdvanceResult> {
      return db.transaction(async (tx) => {
        const [gameRow] = await tx.select().from(game).where(eq(game.id, gameId)).for("update");
        if (!gameRow) throw new GameNotFoundError(gameId);
        if (gameRow.playerSessionId !== playerSessionId) {
          throw new ForbiddenGameAccessError(`session ${playerSessionId} does not own game ${gameId}`);
        }

        const currentOrder = gameRow.currentRoundIndex + 1;
        const [currentRoundRow] = await tx
          .select()
          .from(gameRound)
          .where(and(eq(gameRound.gameId, gameId), eq(gameRound.orderInGame, currentOrder)));
        if (currentRoundRow && currentRoundRow.status === "active" && now.getTime() < currentRoundRow.expiresAt.getTime()) {
          throw new RoundNotActiveError(`round ${currentRoundRow.id} is still active, resolve it before advancing`);
        }

        const nextIndex = gameRow.currentRoundIndex + 1;
        if (nextIndex >= gameRow.totalRounds) {
          const shareToken = crypto.randomUUID();
          const [updated] = await tx
            .update(game)
            .set({ currentRoundIndex: nextIndex, status: "completed", completedAt: now, shareToken })
            .where(eq(game.id, gameId))
            .returning();
          return { game: toGameRecord(updated!), round: null };
        }

        const [updated] = await tx.update(game).set({ currentRoundIndex: nextIndex }).where(eq(game.id, gameId)).returning();
        const nextRound = await materializeRound(tx, updated!, nextIndex + 1, now, content);
        return { game: toGameRecord(updated!), round: nextRound };
      });
    },
  };
}
