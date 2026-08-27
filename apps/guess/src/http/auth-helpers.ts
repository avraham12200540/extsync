import type { HttpDeps } from "./deps";
import { readCookie } from "./http-utils";
import type { PlayerSessionRecord } from "./session";
import { SESSION_COOKIE_NAME, requireCsrf, requireSession } from "./session";
import { ValidationError, idempotencyKeySchema } from "./validation";

/** Every mutating endpoint's first two checks, in the required order: valid session, then correct CSRF header. */
export async function authenticateAndVerifyCsrf(deps: HttpDeps, request: Request, now: Date): Promise<PlayerSessionRecord> {
  const rawSessionToken = readCookie(request, SESSION_COOKIE_NAME);
  const session = await requireSession(deps.sessionRepo, rawSessionToken, now);
  requireCsrf(session, request.headers.get("x-guess-csrf"));
  return session;
}

/** Session only, no CSRF - for GET endpoints that read session-scoped state but never mutate it. */
export async function authenticateOnly(deps: HttpDeps, request: Request, now: Date): Promise<PlayerSessionRecord> {
  const rawSessionToken = readCookie(request, SESSION_COOKIE_NAME);
  return requireSession(deps.sessionRepo, rawSessionToken, now);
}

export function requireIdempotencyKey(request: Request): string {
  const raw = request.headers.get("x-idempotency-key");
  const result = idempotencyKeySchema.safeParse(raw ?? "");
  if (!result.success) {
    throw new ValidationError("missing or invalid X-Idempotency-Key header");
  }
  return result.data;
}
