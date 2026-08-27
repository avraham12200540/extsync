/**
 * Single source of truth for /guess scoring. Server-only: nothing here is
 * ever meant to run in the browser, and no client-computed score is ever
 * trusted - API route handlers (a later stage) call these functions after
 * a guess is validated server-side and persist the result they return.
 *
 * Stage 1 note: this stays hardcoded on purpose. A database-backed
 * GameConfig override table is deliberately NOT introduced yet, so there
 * is exactly one source of truth for the score curve/penalty during this
 * stage - not two that could drift apart.
 */

/** Points awarded for a correct guess, indexed by (hintsRevealedCount - 1). */
export const SCORE_CURVE = [100, 75, 55, 35, 20] as const;

/** Points subtracted from the round's score per wrong guess before the correct one. */
export const WRONG_GUESS_PENALTY = 10;

/** After this many wrong guesses in a round, the round auto-resolves as incorrect. */
export const MAX_WRONG_GUESSES = 3;

export const MIN_HINTS_REVEALED = 1;
export const MAX_HINTS_REVEALED = SCORE_CURVE.length;

/**
 * Base points for a correct guess made after `hintsRevealedCount` hints
 * have been shown. Throws on an out-of-range or non-integer input rather
 * than silently clamping, since a caller passing a bad value here is a
 * bug that would otherwise mis-score a real player.
 */
export function baseScoreForHints(hintsRevealedCount: number): number {
  if (!Number.isInteger(hintsRevealedCount)) {
    throw new RangeError(`hintsRevealedCount must be an integer, got ${hintsRevealedCount}`);
  }
  if (hintsRevealedCount < MIN_HINTS_REVEALED || hintsRevealedCount > MAX_HINTS_REVEALED) {
    throw new RangeError(
      `hintsRevealedCount must be between ${MIN_HINTS_REVEALED} and ${MAX_HINTS_REVEALED}, got ${hintsRevealedCount}`,
    );
  }
  const score = SCORE_CURVE[hintsRevealedCount - 1];
  if (score === undefined) {
    // Unreachable given the range check above; guards noUncheckedIndexedAccess.
    throw new RangeError(`no score defined for hintsRevealedCount=${hintsRevealedCount}`);
  }
  return score;
}

/**
 * Net score for a round that resolved correctly: the base score for the
 * hint count used, minus the wrong-guess penalty for every wrong attempt
 * made first, floored at 0 (a round's score is never negative).
 */
export function netScoreForRound(hintsRevealedCount: number, wrongGuessCount: number): number {
  if (!Number.isInteger(wrongGuessCount) || wrongGuessCount < 0) {
    throw new RangeError(`wrongGuessCount must be a non-negative integer, got ${wrongGuessCount}`);
  }
  const base = baseScoreForHints(hintsRevealedCount);
  return Math.max(0, base - wrongGuessCount * WRONG_GUESS_PENALTY);
}

/** Whether a round should auto-resolve as incorrect given its wrong-guess count so far. */
export function isRoundExhausted(wrongGuessCount: number): boolean {
  return wrongGuessCount >= MAX_WRONG_GUESSES;
}
