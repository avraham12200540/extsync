import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHOICES_PER_ROUND,
  DAILY_ROUNDS,
  FREEPLAY_ROUNDS,
  MAX_HINTS_REVEALED,
  MAX_POSTS_PER_ROUND,
  MIN_APPROVED_POSTS_FOR_ELIGIBILITY,
  SCORE_CURVE,
} from "../../src/game/config";

test("MAX_POSTS_PER_ROUND is exactly the score curve's length - a round can never need more hint prices than exist", () => {
  assert.equal(MAX_POSTS_PER_ROUND, SCORE_CURVE.length);
  assert.equal(MAX_POSTS_PER_ROUND, MAX_HINTS_REVEALED);
});

test("MIN_APPROVED_POSTS_FOR_ELIGIBILITY is at least MAX_POSTS_PER_ROUND - a round must always be fillable", () => {
  assert.ok(MIN_APPROVED_POSTS_FOR_ELIGIBILITY >= MAX_POSTS_PER_ROUND);
});

test("round/choice counts match the approved architecture", () => {
  assert.equal(DAILY_ROUNDS, 5);
  assert.equal(FREEPLAY_ROUNDS, 10);
  assert.equal(CHOICES_PER_ROUND, 4);
});
