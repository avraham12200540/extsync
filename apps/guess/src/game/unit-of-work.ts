import { CHOICES_PER_ROUND, GAME_EXPIRY_MS, ROUND_EXPIRY_MS, isRoundExhausted, netScoreForRound } from "./config";

/**
 * Server-authoritative round transitions, expressed as a repository/
 * unit-of-work interface so the state machine (this file) never touches
 * a database directly - createInMemoryGameUnitOfWork below is a faithful
 * implementation used by every domain test; a real Postgres/Drizzle
 * adapter (drizzle-unit-of-work.ts) implements the same interface but is
 * NOT exercised by any test here (no PostgreSQL in this environment).
 *
 * IDs (game/round/choice) are always opaque, generated via the injected
 * `generateId` (crypto.randomUUID by default) - never derived from a
 * forum_user_id/forum_pid in any way.
 */

export type GameMode = "daily" | "freeplay";
export type GameStatus = "in_progress" | "completed" | "abandoned";
export type RoundStatus = "active" | "resolved_correct" | "resolved_incorrect" | "expired";

export interface RoundPlanEntry {
  targetForumUserId: string;
  postIds: string[];
  choiceUserIds: string[];
}

export interface GameRecord {
  id: string;
  playerSessionId: string;
  mode: GameMode;
  dailyChallengeId: string | null;
  roundPlan: RoundPlanEntry[];
  totalRounds: number;
  currentRoundIndex: number;
  totalScore: number;
  status: GameStatus;
  shareToken: string | null;
  startedAt: Date;
  completedAt: Date | null;
  expiresAt: Date;
}

export interface RoundPostRecord {
  displayOrder: number;
  forumPostId: string;
  cleanContent: string;
  revealed: boolean;
}

export interface RoundChoiceRecord {
  choiceId: string;
  forumUserId: string;
  username: string;
  displayPosition: number;
}

export interface RoundRecord {
  id: string;
  gameId: string;
  orderInGame: number;
  targetForumUserId: string;
  status: RoundStatus;
  hintsRevealedCount: number;
  wrongGuessCount: number;
  scoreAwarded: number;
  activatedAt: Date;
  resolvedAt: Date | null;
  expiresAt: Date;
  posts: RoundPostRecord[];
  choices: RoundChoiceRecord[];
}

export interface GuessRecord {
  id: string;
  roundId: string;
  choiceId: string;
  playerSessionId: string;
  isCorrect: boolean;
  attemptNumber: number;
}

/** What a caller needs to materialize round posts (clean text) and choice usernames from opaque forum ids - supplied by the caller, this module has no forum-data access of its own. */
export interface ForumContentLookup {
  getCleanContent(forumPostId: string): Promise<string>;
  getUsername(forumUserId: string): Promise<string>;
}

export class GameNotFoundError extends Error {}
export class RoundNotFoundError extends Error {}
export class ForbiddenGameAccessError extends Error {}
export class InvalidChoiceError extends Error {}
export class RoundNotActiveError extends Error {}
export class GameAlreadyExistsForDailyChallengeError extends Error {
  constructor(public readonly existingGame: GameRecord) {
    super(`session already has a game for this daily challenge (${existingGame.id})`);
  }
}

export interface SubmitGuessResult {
  round: RoundRecord;
  guess: GuessRecord;
  /** True only the first time this exact (round, session, choice) guess is recorded - false on an idempotent replay. */
  wasNewGuess: boolean;
}

export interface AdvanceResult {
  game: GameRecord;
  /** Present when the game still has rounds left; absent (game.status === 'completed') once the last round resolves. */
  round: RoundRecord | null;
}

export interface GameUnitOfWork {
  createOrResumeDailyGame(input: {
    playerSessionId: string;
    dailyChallengeId: string;
    roundPlan: RoundPlanEntry[];
    now: Date;
  }): Promise<{ game: GameRecord; created: boolean }>;

  createFreeplayGame(input: { playerSessionId: string; roundPlan: RoundPlanEntry[]; now: Date }): Promise<GameRecord>;

  getGame(gameId: string): Promise<GameRecord | null>;

  /** Public, unauthenticated lookup for the share-safe results view - only ever populated once a game is completed (see toShareResultsView), so a valid shareToken exposes nothing session-identifying. */
  getGameByShareToken(shareToken: string): Promise<GameRecord | null>;

  /** Materializes (creating GameRound/RoundPost/RoundChoice rows if this is the first visit) and returns the current round. Lazily expires the round/game if `now` is past their expiry. Ownership-checked like every other operation here - a session can never read another session's round state. */
  getCurrentRound(gameId: string, playerSessionId: string, now: Date, content: ForumContentLookup): Promise<RoundRecord>;

  revealNextHint(gameId: string, roundId: string, playerSessionId: string, now: Date): Promise<RoundRecord>;

  submitGuess(gameId: string, roundId: string, playerSessionId: string, choiceId: string, now: Date): Promise<SubmitGuessResult>;

  /** Only allowed once the current round is resolved (correct/incorrect/expired) - never mid-round. */
  advanceToNextRound(gameId: string, playerSessionId: string, now: Date, content: ForumContentLookup): Promise<AdvanceResult>;
}

interface GenerateIdDep {
  generateId: () => string;
}

/** A tiny async mutex keyed by string - simulates the serialization a real `SELECT ... FOR UPDATE` transaction provides, so concurrent calls against the SAME game/round in the in-memory fake behave the way the real adapter is expected to (see drizzle-unit-of-work.ts). */
class KeyedMutex {
  private queues = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queues.set(
      key,
      prior.then(() => gate),
    );
    await prior;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

function assertOwnership(game: GameRecord, playerSessionId: string): void {
  if (game.playerSessionId !== playerSessionId) {
    throw new ForbiddenGameAccessError(`session ${playerSessionId} does not own game ${game.id}`);
  }
}

function currentScoreAvailable(round: RoundRecord): number {
  return netScoreForRound(Math.max(1, round.hintsRevealedCount), round.wrongGuessCount);
}

export function createInMemoryGameUnitOfWork(deps: GenerateIdDep): GameUnitOfWork {
  const games = new Map<string, GameRecord>();
  const rounds = new Map<string, RoundRecord>(); // keyed by roundId
  const roundIdByGameAndOrder = new Map<string, string>(); // `${gameId}:${orderInGame}` -> roundId
  const guesses = new Map<string, GuessRecord>(); // keyed by `${roundId}:${playerSessionId}:${choiceId}`
  const dailyGameBySessionAndChallenge = new Map<string, string>(); // `${dailyChallengeId}:${playerSessionId}` -> gameId
  const mutex = new KeyedMutex();

  function expireIfNeeded(game: GameRecord, round: RoundRecord | null, now: Date): void {
    if (game.status === "in_progress" && now.getTime() >= game.expiresAt.getTime()) {
      game.status = "abandoned";
    }
    if (round && round.status === "active" && now.getTime() >= round.expiresAt.getTime()) {
      round.status = "expired";
      round.resolvedAt = now;
      round.scoreAwarded = 0;
    }
  }

  async function materializeRound(game: GameRecord, orderInGame: number, now: Date, content: ForumContentLookup): Promise<RoundRecord> {
    const key = `${game.id}:${orderInGame}`;
    const existingId = roundIdByGameAndOrder.get(key);
    if (existingId) return rounds.get(existingId)!;

    const plan = game.roundPlan[orderInGame - 1];
    if (!plan) throw new RoundNotFoundError(`game ${game.id} has no round plan entry for order ${orderInGame}`);

    const posts: RoundPostRecord[] = await Promise.all(
      plan.postIds.map(async (forumPostId, i) => ({
        displayOrder: i + 1,
        forumPostId,
        cleanContent: await content.getCleanContent(forumPostId),
        revealed: i === 0, // the first hint is revealed immediately on activation
      })),
    );

    // choiceId is a fresh opaque id per round instance (never the forum_user_id), and display position is freshly randomized per instance - matching the Stage 1 anti-correlation design even for daily mode, where only the underlying candidate *set* is shared across players.
    const positions = [...Array(CHOICES_PER_ROUND).keys()].map((i) => i + 1);
    const choices: RoundChoiceRecord[] = await Promise.all(
      plan.choiceUserIds.map(async (forumUserId, i) => ({
        choiceId: deps.generateId(),
        forumUserId,
        username: await content.getUsername(forumUserId),
        displayPosition: positions[i]!,
      })),
    );

    const round: RoundRecord = {
      id: deps.generateId(),
      gameId: game.id,
      orderInGame,
      targetForumUserId: plan.targetForumUserId,
      status: "active",
      hintsRevealedCount: 1,
      wrongGuessCount: 0,
      scoreAwarded: 0,
      activatedAt: now,
      resolvedAt: null,
      expiresAt: new Date(now.getTime() + ROUND_EXPIRY_MS),
      posts,
      choices,
    };
    rounds.set(round.id, round);
    roundIdByGameAndOrder.set(key, round.id);
    return round;
  }

  return {
    async createOrResumeDailyGame({ playerSessionId, dailyChallengeId, roundPlan, now }) {
      const resumeKey = `${dailyChallengeId}:${playerSessionId}`;
      const existingId = dailyGameBySessionAndChallenge.get(resumeKey);
      if (existingId) {
        return { game: games.get(existingId)!, created: false };
      }
      const game: GameRecord = {
        id: deps.generateId(),
        playerSessionId,
        mode: "daily",
        dailyChallengeId,
        roundPlan,
        totalRounds: roundPlan.length,
        currentRoundIndex: 0,
        totalScore: 0,
        status: "in_progress",
        shareToken: null,
        startedAt: now,
        completedAt: null,
        expiresAt: new Date(now.getTime() + GAME_EXPIRY_MS),
      };
      games.set(game.id, game);
      dailyGameBySessionAndChallenge.set(resumeKey, game.id);
      return { game, created: true };
    },

    async createFreeplayGame({ playerSessionId, roundPlan, now }) {
      const game: GameRecord = {
        id: deps.generateId(),
        playerSessionId,
        mode: "freeplay",
        dailyChallengeId: null,
        roundPlan,
        totalRounds: roundPlan.length,
        currentRoundIndex: 0,
        totalScore: 0,
        status: "in_progress",
        shareToken: null,
        startedAt: now,
        completedAt: null,
        expiresAt: new Date(now.getTime() + GAME_EXPIRY_MS),
      };
      games.set(game.id, game);
      return game;
    },

    async getGame(gameId) {
      return games.get(gameId) ?? null;
    },

    async getGameByShareToken(shareToken) {
      for (const game of games.values()) {
        if (game.shareToken === shareToken) return game;
      }
      return null;
    },

    async getCurrentRound(gameId, playerSessionId, now, content) {
      return mutex.run(gameId, async () => {
        const game = games.get(gameId);
        if (!game) throw new GameNotFoundError(gameId);
        assertOwnership(game, playerSessionId);
        const orderInGame = game.currentRoundIndex + 1;
        const round = await materializeRound(game, orderInGame, now, content);
        expireIfNeeded(game, round, now);
        return round;
      });
    },

    async revealNextHint(gameId, roundId, playerSessionId, now) {
      return mutex.run(roundId, async () => {
        const game = games.get(gameId);
        if (!game) throw new GameNotFoundError(gameId);
        assertOwnership(game, playerSessionId);
        const round = rounds.get(roundId);
        if (!round || round.gameId !== gameId) throw new RoundNotFoundError(roundId);

        expireIfNeeded(game, round, now);
        if (round.status !== "active") {
          throw new RoundNotActiveError(`round ${roundId} is ${round.status}, cannot reveal a hint`);
        }

        if (round.hintsRevealedCount < round.posts.length) {
          round.hintsRevealedCount += 1;
          const next = round.posts[round.hintsRevealedCount - 1];
          if (next) next.revealed = true;
        }
        // Idempotent no-op once every post is already revealed - never an error.
        return round;
      });
    },

    async submitGuess(gameId, roundId, playerSessionId, choiceId, now) {
      return mutex.run(roundId, async () => {
        const game = games.get(gameId);
        if (!game) throw new GameNotFoundError(gameId);
        assertOwnership(game, playerSessionId);
        const round = rounds.get(roundId);
        if (!round || round.gameId !== gameId) throw new RoundNotFoundError(roundId);

        const guessKey = `${roundId}:${playerSessionId}:${choiceId}`;
        const existingGuess = guesses.get(guessKey);
        if (existingGuess) {
          // Idempotent replay: return what was already recorded, apply no second penalty, no re-scoring.
          return { round, guess: existingGuess, wasNewGuess: false };
        }

        expireIfNeeded(game, round, now);
        if (round.status !== "active") {
          throw new RoundNotActiveError(`round ${roundId} is ${round.status}, cannot submit a guess`);
        }

        const choice = round.choices.find((c) => c.choiceId === choiceId);
        if (!choice) {
          throw new InvalidChoiceError(`choice ${choiceId} does not belong to round ${roundId}`);
        }

        const isCorrect = choice.forumUserId === round.targetForumUserId;
        const attemptNumber = [...guesses.values()].filter((g) => g.roundId === roundId).length + 1;
        const guess: GuessRecord = { id: deps.generateId(), roundId, choiceId, playerSessionId, isCorrect, attemptNumber };
        guesses.set(guessKey, guess);

        if (isCorrect) {
          round.status = "resolved_correct";
          round.resolvedAt = now;
          round.scoreAwarded = currentScoreAvailable(round);
          game.totalScore += round.scoreAwarded;
        } else {
          round.wrongGuessCount += 1;
          if (isRoundExhausted(round.wrongGuessCount)) {
            round.status = "resolved_incorrect";
            round.resolvedAt = now;
            round.scoreAwarded = 0;
          }
        }

        return { round, guess, wasNewGuess: true };
      });
    },

    async advanceToNextRound(gameId, playerSessionId, now, content) {
      return mutex.run(gameId, async () => {
        const game = games.get(gameId);
        if (!game) throw new GameNotFoundError(gameId);
        assertOwnership(game, playerSessionId);

        const currentOrder = game.currentRoundIndex + 1;
        const currentRoundId = roundIdByGameAndOrder.get(`${gameId}:${currentOrder}`);
        const currentRound = currentRoundId ? rounds.get(currentRoundId) : undefined;
        if (currentRound) {
          expireIfNeeded(game, currentRound, now);
          if (currentRound.status === "active") {
            throw new RoundNotActiveError(`round ${currentRound.id} is still active, resolve it before advancing`);
          }
        }

        game.currentRoundIndex += 1;
        if (game.currentRoundIndex >= game.totalRounds) {
          game.status = "completed";
          game.completedAt = now;
          game.shareToken = deps.generateId();
          return { game, round: null };
        }

        const nextRound = await materializeRound(game, game.currentRoundIndex + 1, now, content);
        return { game, round: nextRound };
      });
    },
  };
}
