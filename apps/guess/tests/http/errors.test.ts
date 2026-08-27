import assert from "node:assert/strict";
import { test } from "node:test";
import { InsufficientDailyPoolError } from "../../src/game/daily-challenge";
import { InsufficientDistractorPoolError } from "../../src/game/distractor";
import { InsufficientFreeplayPoolError } from "../../src/game/freeplay";
import { ForbiddenGameAccessError, GameNotFoundError, InvalidChoiceError, RoundNotActiveError } from "../../src/game/unit-of-work";
import { mapErrorToResponse } from "../../src/http/errors";
import { IdempotencyConflictError } from "../../src/http/idempotency";
import { RateLimitExceededError } from "../../src/http/rate-limit";
import { CsrfFailedError, UnauthenticatedError } from "../../src/http/session";
import { ValidationError } from "../../src/http/validation";

test("maps known domain/infra errors to stable status/code pairs", () => {
  assert.deepEqual(
    { status: mapErrorToResponse(new UnauthenticatedError()).status, code: mapErrorToResponse(new UnauthenticatedError()).code },
    { status: 401, code: "unauthenticated" },
  );
  assert.equal(mapErrorToResponse(new CsrfFailedError()).status, 403);
  assert.equal(mapErrorToResponse(new InvalidChoiceError()).status, 400);
  assert.equal(mapErrorToResponse(new RoundNotActiveError()).status, 409);
  assert.equal(mapErrorToResponse(new InsufficientDistractorPoolError()).status, 503);
  assert.equal(mapErrorToResponse(new InsufficientDailyPoolError()).status, 503);
  assert.equal(mapErrorToResponse(new InsufficientFreeplayPoolError()).status, 503);
  assert.equal(mapErrorToResponse(new IdempotencyConflictError()).status, 409);
  assert.equal(mapErrorToResponse(new ValidationError("bad")).status, 400);
});

test("GameNotFoundError and ForbiddenGameAccessError map to the exact same status/code/message - no existence oracle", () => {
  const notFound = mapErrorToResponse(new GameNotFoundError());
  const forbidden = mapErrorToResponse(new ForbiddenGameAccessError());
  assert.deepEqual(notFound, forbidden);
  assert.equal(notFound.status, 404);
});

test("RateLimitExceededError carries retryAfterSeconds through to the mapped shape", () => {
  const mapped = mapErrorToResponse(new RateLimitExceededError(42));
  assert.equal(mapped.status, 429);
  assert.equal(mapped.retryAfterSeconds, 42);
});

test("an unknown error maps to a generic 500 with no leaked detail", () => {
  const mapped = mapErrorToResponse(new Error("some internal DB connection string leaked here: postgres://user:pass@host/db"));
  assert.equal(mapped.status, 500);
  assert.equal(mapped.code, "internal_error");
  assert.doesNotMatch(mapped.message, /postgres:\/\//);
  assert.doesNotMatch(mapped.message, /user:pass/);
});

test("a non-Error thrown value still maps safely", () => {
  const mapped = mapErrorToResponse("just a string throw");
  assert.equal(mapped.status, 500);
});

test("ValidationError's message is used verbatim (constructed only from our own field names, safe to reveal)", () => {
  const mapped = mapErrorToResponse(new ValidationError("invalid path parameter: gameId"));
  assert.equal(mapped.message, "invalid path parameter: gameId");
});
