import crypto from "node:crypto";

/**
 * Anonymous player-session primitives: 256-bit random raw tokens, hashed
 * at rest (never the raw value), served via an HttpOnly cookie. The raw
 * session token NEVER appears in a JSON response body, a log line, or a
 * URL - only in the Set-Cookie header, and only ever read back from the
 * request Cookie header.
 */

export const SESSION_COOKIE_NAME = "guess_session";
export const SESSION_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000; // 180 days, sliding
/** A session older than this since creation is rotated (fresh token + cookie) on its next bootstrap call - the rotation policy this module implements. */
export const SESSION_ROTATION_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function generateRawToken(): string {
  return crypto.randomBytes(32).toString("base64url"); // 256 bits
}

export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Hashes `rawToken` and compares it to `storedHash` in constant time - never compares raw values, never short-circuits on a byte mismatch. */
export function verifyHashedToken(rawToken: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashToken(rawToken), "utf8");
  const stored = Buffer.from(storedHash, "utf8");
  if (candidate.length !== stored.length) return false; // both are fixed-length sha256 hex (64 chars) in practice; this guard only exists because timingSafeEqual requires equal-length buffers
  return crypto.timingSafeEqual(candidate, stored);
}

export interface CookieAttributes {
  maxAgeSeconds: number;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
}

export function serializeCookie(name: string, value: string, attrs: CookieAttributes): string {
  const parts = [`${name}=${value}`, `Max-Age=${attrs.maxAgeSeconds}`, `Path=${attrs.path}`];
  if (attrs.httpOnly) parts.push("HttpOnly");
  if (attrs.secure) parts.push("Secure");
  parts.push(`SameSite=${attrs.sameSite}`);
  return parts.join("; ");
}

/** A cookie with Max-Age=0 and an empty value - clears the session cookie in a client that respects the same name/path. */
export function expiredCookie(name: string, path: string, secure: boolean): string {
  return serializeCookie(name, "", { maxAgeSeconds: 0, path, httpOnly: true, secure, sameSite: "Lax" });
}

/**
 * `isProduction` is an explicit, injected boolean - never read from
 * `process.env` inside this pure function - so both the production
 * (Secure cookie) and development (non-Secure, so local E2E over plain
 * HTTP keeps working) branches are directly testable without mutating
 * process.env in a test.
 */
export function sessionCookieAttributes(isProduction: boolean): CookieAttributes {
  return {
    maxAgeSeconds: Math.floor(SESSION_MAX_AGE_MS / 1000),
    path: "/guess",
    httpOnly: true,
    secure: isProduction,
    sameSite: "Lax",
  };
}

export interface PlayerSessionRecord {
  id: string;
  csrfTokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface SessionRepository {
  createSession(sessionTokenHash: string, csrfTokenHash: string, now: Date, expiresAt: Date): Promise<PlayerSessionRecord>;
  findSessionByTokenHash(sessionTokenHash: string): Promise<PlayerSessionRecord | null>;
  touchSession(sessionId: string, now: Date): Promise<void>;
  rotateSession(sessionId: string, newSessionTokenHash: string, newExpiresAt: Date): Promise<void>;
  rotateCsrf(sessionId: string, newCsrfTokenHash: string): Promise<void>;
}

export function createInMemorySessionRepository(deps: { generateId: () => string }): SessionRepository & {
  sessions: Map<string, PlayerSessionRecord & { sessionTokenHash: string }>;
} {
  const sessions = new Map<string, PlayerSessionRecord & { sessionTokenHash: string }>();
  const byTokenHash = new Map<string, string>(); // sessionTokenHash -> sessionId

  return {
    sessions,
    async createSession(sessionTokenHash, csrfTokenHash, now, expiresAt) {
      const record = { id: deps.generateId(), csrfTokenHash, createdAt: now, lastSeenAt: now, expiresAt, sessionTokenHash };
      sessions.set(record.id, record);
      byTokenHash.set(sessionTokenHash, record.id);
      return record;
    },
    async findSessionByTokenHash(sessionTokenHash) {
      const id = byTokenHash.get(sessionTokenHash);
      if (!id) return null;
      return sessions.get(id) ?? null;
    },
    async touchSession(sessionId, now) {
      const record = sessions.get(sessionId);
      if (record) record.lastSeenAt = now;
    },
    async rotateSession(sessionId, newSessionTokenHash, newExpiresAt) {
      const record = sessions.get(sessionId);
      if (!record) return;
      byTokenHash.delete(record.sessionTokenHash);
      record.sessionTokenHash = newSessionTokenHash;
      record.expiresAt = newExpiresAt;
      byTokenHash.set(newSessionTokenHash, sessionId);
    },
    async rotateCsrf(sessionId, newCsrfTokenHash) {
      const record = sessions.get(sessionId);
      if (record) record.csrfTokenHash = newCsrfTokenHash;
    },
  };
}

export interface BootstrapResult {
  /** For the Set-Cookie header only - never put this in a JSON body. */
  rawSessionToken: string;
  /** Returned once, in the JSON body, so same-origin JS can read it and attach it as X-Guess-CSRF on later mutating requests. */
  rawCsrfToken: string;
  sessionExpiresAt: Date;
  rotatedSession: boolean;
  isNewSession: boolean;
}

/**
 * Every bootstrap call rotates the CSRF token (simple, always-fresh
 * policy - a client is expected to call this once per app load before
 * any mutating request). The session token itself only rotates once it's
 * older than SESSION_ROTATION_THRESHOLD_MS, so an ordinary page reload
 * doesn't force a new cookie on every visit.
 */
export async function bootstrapSession(
  repo: SessionRepository,
  now: Date,
  existingRawSessionToken: string | null,
  gen: { randomToken: () => string },
): Promise<BootstrapResult> {
  const freshCsrfRaw = gen.randomToken();
  const freshCsrfHash = hashToken(freshCsrfRaw);

  if (existingRawSessionToken) {
    const existing = await repo.findSessionByTokenHash(hashToken(existingRawSessionToken));
    if (existing && existing.expiresAt.getTime() > now.getTime()) {
      const shouldRotateSession = now.getTime() - existing.createdAt.getTime() > SESSION_ROTATION_THRESHOLD_MS;
      await repo.rotateCsrf(existing.id, freshCsrfHash);

      if (shouldRotateSession) {
        const newRawSessionToken = gen.randomToken();
        const newExpiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);
        await repo.rotateSession(existing.id, hashToken(newRawSessionToken), newExpiresAt);
        return {
          rawSessionToken: newRawSessionToken,
          rawCsrfToken: freshCsrfRaw,
          sessionExpiresAt: newExpiresAt,
          rotatedSession: true,
          isNewSession: false,
        };
      }

      await repo.touchSession(existing.id, now);
      return {
        rawSessionToken: existingRawSessionToken,
        rawCsrfToken: freshCsrfRaw,
        sessionExpiresAt: existing.expiresAt,
        rotatedSession: false,
        isNewSession: false,
      };
    }
  }

  const rawSessionToken = gen.randomToken();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);
  await repo.createSession(hashToken(rawSessionToken), freshCsrfHash, now, expiresAt);
  return { rawSessionToken, rawCsrfToken: freshCsrfRaw, sessionExpiresAt: expiresAt, rotatedSession: false, isNewSession: true };
}

export class UnauthenticatedError extends Error {}
export class CsrfFailedError extends Error {}

export async function requireSession(repo: SessionRepository, rawSessionToken: string | null, now: Date): Promise<PlayerSessionRecord> {
  if (!rawSessionToken) throw new UnauthenticatedError("no session cookie present");
  const session = await repo.findSessionByTokenHash(hashToken(rawSessionToken));
  if (!session || session.expiresAt.getTime() <= now.getTime()) {
    throw new UnauthenticatedError("session missing or expired");
  }
  return session;
}

export function requireCsrf(session: PlayerSessionRecord, submittedRawCsrfToken: string | null): void {
  if (!submittedRawCsrfToken) throw new CsrfFailedError("missing X-Guess-CSRF header");
  if (!verifyHashedToken(submittedRawCsrfToken, session.csrfTokenHash)) {
    throw new CsrfFailedError("csrf token mismatch");
  }
}
