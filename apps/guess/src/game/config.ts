/**
 * Central, server-only game configuration. This is the ONE place round
 * counts, expirations and eligibility thresholds live - other modules
 * import from here rather than restating a number. Scoring constants
 * themselves are NOT duplicated here: they still live in
 * src/lib/scoring.ts (the pre-existing single source of truth for the
 * score curve/penalty) and are simply re-exported so game-domain code has
 * one import surface for "everything about game rules."
 */
export {
  MAX_HINTS_REVEALED,
  MAX_WRONG_GUESSES,
  MIN_HINTS_REVEALED,
  SCORE_CURVE,
  WRONG_GUESS_PENALTY,
  baseScoreForHints,
  isRoundExhausted,
  netScoreForRound,
} from "../lib/scoring";

import { MAX_HINTS_REVEALED } from "../lib/scoring";

/** Rounds in a daily game. */
export const DAILY_ROUNDS = 5;
/** Rounds in a free-play game. */
export const FREEPLAY_ROUNDS = 10;
/** Multiple-choice options shown per round. */
export const CHOICES_PER_ROUND = 4;
/**
 * Posts (accumulating hints) shown per round, at most. Equal to
 * MAX_HINTS_REVEALED (the score curve's length) by construction - a round
 * can never reveal more hints than the curve has prices for. Asserted by
 * a test rather than silently assumed.
 */
export const MAX_POSTS_PER_ROUND = MAX_HINTS_REVEALED;

/** How long a single round stays answerable after activation. */
export const ROUND_EXPIRY_MS = 2 * 60 * 1000;
/** How long a whole game (daily or free-play) stays resumable before it's considered abandoned. */
export const GAME_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * A target (or distractor) needs at least this many approved posts so a
 * round can always fill MAX_POSTS_PER_ROUND hint slots. Must be >=
 * MAX_POSTS_PER_ROUND by construction - also asserted by a test.
 */
export const MIN_APPROVED_POSTS_FOR_ELIGIBILITY = MAX_POSTS_PER_ROUND;

/** IANA timezone used for the daily-challenge calendar date - never a hand-rolled DST approximation. */
export const DAILY_CHALLENGE_TIMEZONE = "Asia/Jerusalem";

/**
 * Bumping this changes every future daily challenge's derived ordering
 * without touching already-published challenges (each published
 * DailyChallenge snapshots its own rounds at construction time - see
 * daily-challenge.ts - so changing this constant never mutates the past).
 */
export const DAILY_CHALLENGE_SEED_VERSION = 1;
