import { netScoreForRound } from "./config";
import type { GameRecord, RoundRecord } from "./unit-of-work";

/**
 * Pure mappers from internal domain records to what a future HTTP layer
 * is allowed to serialize to a client. Every field a RoundView/GameView
 * can carry is listed explicitly below - nothing here ever spreads a
 * domain record (`{...round}`) precisely so a field added to RoundRecord
 * later cannot silently leak through a view model without a deliberate
 * edit here.
 *
 * Before a round resolves, the ONLY things a client may learn about it
 * are: its own opaque round id, order/status/counts, sanitized revealed
 * post text, the four candidate usernames (with opaque choice ids, NOT
 * the underlying forum_user_id), and the server-computed current
 * available score. It must never learn: the target's forum_user_id,
 * forum_uid/userslug, any post's pid/tid/source URL, raw_content,
 * moderation metadata, the daily seed, or which choice is correct.
 *
 * After resolution, the response may additionally reveal which opaque
 * choice_id/username was correct (needed for player feedback) and the
 * score awarded - still never the underlying forum identity/source data.
 */

export interface RoundPostView {
  displayOrder: number;
  cleanText: string;
}

export interface RoundChoiceView {
  choiceId: string;
  username: string;
}

export interface RoundView {
  roundId: string;
  orderInGame: number;
  status: RoundRecord["status"];
  hintsRevealedCount: number;
  maxHints: number;
  expiresAt: string;
  revealedPosts: RoundPostView[];
  choices: RoundChoiceView[];
  wrongGuessCount: number;
  /** What a correct guess would award right now; 0 once the round is no longer active. */
  currentAvailableScore: number;
  /** Populated only once status !== "active". */
  scoreAwarded: number | null;
  correctChoiceId: string | null;
  correctUsername: string | null;
}

export function toRoundView(round: RoundRecord): RoundView {
  const resolved = round.status !== "active";
  const correctChoice = round.choices.find((c) => c.forumUserId === round.targetForumUserId);

  return {
    roundId: round.id,
    orderInGame: round.orderInGame,
    status: round.status,
    hintsRevealedCount: round.hintsRevealedCount,
    maxHints: round.posts.length,
    expiresAt: round.expiresAt.toISOString(),
    revealedPosts: round.posts
      .filter((p) => p.revealed)
      .map((p) => ({ displayOrder: p.displayOrder, cleanText: p.cleanContent })),
    choices: round.choices.map((c) => ({ choiceId: c.choiceId, username: c.username })),
    wrongGuessCount: round.wrongGuessCount,
    currentAvailableScore: resolved ? 0 : netScoreForRound(Math.max(1, round.hintsRevealedCount), round.wrongGuessCount),
    scoreAwarded: resolved ? round.scoreAwarded : null,
    correctChoiceId: resolved ? (correctChoice?.choiceId ?? null) : null,
    correctUsername: resolved ? (correctChoice?.username ?? null) : null,
  };
}

export interface GameView {
  gameId: string;
  mode: GameRecord["mode"];
  status: GameRecord["status"];
  currentRoundIndex: number;
  totalRounds: number;
  totalScore: number;
  expiresAt: string;
  /** Only non-null once the game is completed - see game.ts's schema comment on why this is safe to serve publicly. */
  shareToken: string | null;
}

export function toGameView(game: GameRecord): GameView {
  return {
    gameId: game.id,
    mode: game.mode,
    status: game.status,
    currentRoundIndex: game.currentRoundIndex,
    totalRounds: game.totalRounds,
    totalScore: game.totalScore,
    expiresAt: game.expiresAt.toISOString(),
    shareToken: game.shareToken,
  };
}

export interface ShareResultsView {
  mode: GameRecord["mode"];
  totalScore: number;
  totalRounds: number;
  completedAt: string | null;
}

/** Public, share-safe: intended for the unauthenticated /results/:shareToken view - no session id, no round-level data. */
export function toShareResultsView(game: GameRecord): ShareResultsView {
  return {
    mode: game.mode,
    totalScore: game.totalScore,
    totalRounds: game.totalRounds,
    completedAt: game.completedAt ? game.completedAt.toISOString() : null,
  };
}
