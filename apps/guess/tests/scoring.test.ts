import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_HINTS_REVEALED,
  MAX_WRONG_GUESSES,
  MIN_HINTS_REVEALED,
  SCORE_CURVE,
  WRONG_GUESS_PENALTY,
  baseScoreForHints,
  isRoundExhausted,
  netScoreForRound,
} from "../src/lib/scoring";

test("SCORE_CURVE matches the approved policy exactly", () => {
  assert.deepEqual(SCORE_CURVE, [100, 75, 55, 35, 20]);
});

test("baseScoreForHints returns the curve value for each valid hint count", () => {
  for (let hints = MIN_HINTS_REVEALED; hints <= MAX_HINTS_REVEALED; hints++) {
    assert.equal(baseScoreForHints(hints), SCORE_CURVE[hints - 1]);
  }
});

test("baseScoreForHints rejects out-of-range input instead of clamping", () => {
  assert.throws(() => baseScoreForHints(0), RangeError);
  assert.throws(() => baseScoreForHints(6), RangeError);
  assert.throws(() => baseScoreForHints(-1), RangeError);
});

test("baseScoreForHints rejects non-integer input", () => {
  assert.throws(() => baseScoreForHints(1.5), RangeError);
  assert.throws(() => baseScoreForHints(Number.NaN), RangeError);
});

test("netScoreForRound with zero wrong guesses equals the base score", () => {
  assert.equal(netScoreForRound(1, 0), 100);
  assert.equal(netScoreForRound(5, 0), 20);
});

test("netScoreForRound subtracts the penalty per wrong guess", () => {
  assert.equal(netScoreForRound(1, 1), 100 - WRONG_GUESS_PENALTY);
  assert.equal(netScoreForRound(1, 2), 100 - 2 * WRONG_GUESS_PENALTY);
});

test("netScoreForRound never returns a negative score", () => {
  assert.equal(netScoreForRound(5, 100), 0);
});

test("netScoreForRound rejects a negative wrong-guess count", () => {
  assert.throws(() => netScoreForRound(1, -1), RangeError);
});

test("isRoundExhausted flips at MAX_WRONG_GUESSES", () => {
  assert.equal(isRoundExhausted(MAX_WRONG_GUESSES - 1), false);
  assert.equal(isRoundExhausted(MAX_WRONG_GUESSES), true);
  assert.equal(isRoundExhausted(MAX_WRONG_GUESSES + 1), true);
});

test("score curve is monotonically non-increasing (more hints never scores higher)", () => {
  for (let i = 1; i < SCORE_CURVE.length; i++) {
    assert.ok((SCORE_CURVE[i] as number) <= (SCORE_CURVE[i - 1] as number));
  }
});
