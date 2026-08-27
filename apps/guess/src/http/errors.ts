import { InsufficientDailyPoolError, InsufficientTargetPostsError } from "../game/daily-challenge";
import { InsufficientDistractorPoolError } from "../game/distractor";
import { InsufficientFreeplayPoolError } from "../game/freeplay";
import {
  ForbiddenGameAccessError,
  GameNotFoundError,
  InvalidChoiceError,
  RoundNotActiveError,
  RoundNotFoundError,
} from "../game/unit-of-work";
import { InvalidAdminCredentialsError } from "../admin/auth-service";
import { ForumUserNotFoundError } from "../admin/forum-user-repository";
import { ImportAlreadyRunningError } from "../admin/import-service";
import { ImportRunNotFoundError } from "../admin/import-run-repository";
import { ModerationConflictError, ModerationPostNotFoundError } from "../admin/moderation-repository";
import { IdempotencyConflictError, IdempotencyInFlightError } from "./idempotency";
import { CrossOriginRequestError } from "./origin-check";
import { RateLimitExceededError } from "./rate-limit";
import { CsrfFailedError, UnauthenticatedError } from "./session";
import { ValidationError } from "./validation";

/**
 * One place mapping every domain/infra error to a stable HTTP
 * status/code/message - never a raw stack trace, DB error, target id,
 * source id, raw content, or seed. `message` is always a fixed, generic
 * string (never `err.message`, which could echo back internal detail);
 * ValidationError is the one exception, since its message is
 * constructed entirely from our own field names, not from anything the
 * database or domain layer could leak.
 *
 * "Not found" and "not yours" (ForbiddenGameAccessError) deliberately
 * collapse to the exact same status/code/message - if they differed, a
 * client could enumerate valid game ids by noticing which error a guess
 * gets, turning a 404-vs-403 distinction into an existence oracle.
 */
export interface ApiErrorShape {
  status: number;
  code: string;
  message: string;
  retryAfterSeconds?: number;
}

export function mapErrorToResponse(err: unknown): ApiErrorShape {
  if (err instanceof UnauthenticatedError) {
    return { status: 401, code: "unauthenticated", message: "Sign-in required." };
  }
  if (err instanceof CsrfFailedError) {
    return { status: 403, code: "csrf_failed", message: "CSRF validation failed." };
  }
  if (err instanceof CrossOriginRequestError) {
    return { status: 403, code: "cross_origin_request", message: "Request origin could not be verified." };
  }
  if (err instanceof InvalidAdminCredentialsError) {
    return { status: 401, code: "invalid_credentials", message: "Invalid email or password." };
  }
  if (err instanceof ModerationPostNotFoundError || err instanceof ForumUserNotFoundError || err instanceof ImportRunNotFoundError) {
    return { status: 404, code: "not_found", message: "Not found." };
  }
  if (err instanceof ModerationConflictError) {
    return { status: 409, code: "moderation_conflict", message: "This post was changed by someone else since you last loaded it." };
  }
  if (err instanceof ImportAlreadyRunningError) {
    return { status: 409, code: "import_already_running", message: "An import run is already in progress." };
  }
  if (err instanceof GameNotFoundError || err instanceof RoundNotFoundError || err instanceof ForbiddenGameAccessError) {
    return { status: 404, code: "not_found", message: "Not found." };
  }
  if (err instanceof InvalidChoiceError) {
    return { status: 400, code: "invalid_choice", message: "That choice does not belong to this round." };
  }
  if (err instanceof RoundNotActiveError) {
    return { status: 409, code: "round_not_active", message: "This round is no longer active." };
  }
  if (
    err instanceof InsufficientDistractorPoolError ||
    err instanceof InsufficientDailyPoolError ||
    err instanceof InsufficientFreeplayPoolError ||
    err instanceof InsufficientTargetPostsError
  ) {
    return { status: 503, code: "insufficient_curated_content", message: "Not enough content is available right now." };
  }
  if (err instanceof RateLimitExceededError) {
    return { status: 429, code: "rate_limited", message: "Too many requests.", retryAfterSeconds: err.retryAfterSeconds };
  }
  if (err instanceof IdempotencyConflictError) {
    return { status: 409, code: "idempotency_key_conflict", message: "This idempotency key was already used with a different request." };
  }
  if (err instanceof IdempotencyInFlightError) {
    return { status: 409, code: "idempotency_in_flight", message: "This request is already being processed." };
  }
  if (err instanceof ValidationError) {
    return { status: 400, code: "invalid_request", message: err.message };
  }
  return { status: 500, code: "internal_error", message: "An unexpected error occurred." };
}
