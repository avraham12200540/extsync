import { CsrfFailedError, UnauthenticatedError, hashToken, verifyHashedToken } from "./session";
import type { CookieAttributes } from "./session";

/**
 * Admin-session primitives - deliberately separate from the player-session
 * cookie/token (session.ts) even though the underlying token-generation/
 * hashing/cookie-serialization primitives are shared and reused from
 * there. An admin session is higher-value than an anonymous player
 * session, so it gets: SameSite=Strict (not Lax), a short explicit
 * lifetime instead of 180 days, and sliding renewal bounded by an
 * absolute cap rather than open-ended rotation.
 *
 * Cookie Path is "/guess" - not "/guess/admin" - so it reaches both future
 * admin pages under /guess/admin and every /guess/api/admin/... route (see
 * the schema comment on admin_session for the earlier draft that got this
 * wrong).
 */

export const ADMIN_SESSION_COOKIE_NAME = "guess_admin_session";
export const ADMIN_CSRF_HEADER_NAME = "x-guess-admin-csrf";

/** Short, explicit admin session lifetime - re-login is expected roughly daily, not every 6 months like the player session. */
export const ADMIN_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours
/** An absolute lifetime cap from session creation, regardless of how much sliding renewal has extended expiresAt - bounds "renew forever without re-authenticating." */
export const ADMIN_SESSION_ABSOLUTE_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** Once expiresAt is within this window of "now", an authenticated mutating request proactively rotates the token and issues a fresh cookie/expiry - the sliding-renewal mechanism. */
export const ADMIN_SESSION_ROTATION_WINDOW_MS = 3 * 60 * 60 * 1000; // rotate once <=3h remain of the 12h lifetime

export function adminSessionCookieAttributes(isProduction: boolean): CookieAttributes {
  return {
    maxAgeSeconds: Math.floor(ADMIN_SESSION_MAX_AGE_MS / 1000),
    path: "/guess",
    httpOnly: true,
    secure: isProduction,
    sameSite: "Strict",
  };
}

export interface AdminSessionRecord {
  id: string;
  adminUserId: string;
  csrfTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  /** Joined from admin_user at read time - see the module doc comment on why an ongoing session must die the moment an account is deactivated, not just block future logins. */
  adminIsActive: boolean;
}

export interface AdminSessionRepository {
  createSession(input: {
    adminUserId: string;
    sessionTokenHash: string;
    csrfTokenHash: string;
    now: Date;
    expiresAt: Date;
    ipHash: string | null;
  }): Promise<AdminSessionRecord>;
  findSessionByTokenHash(sessionTokenHash: string): Promise<AdminSessionRecord | null>;
  extendExpiry(sessionId: string, newExpiresAt: Date): Promise<void>;
  rotateToken(sessionId: string, newSessionTokenHash: string, newExpiresAt: Date): Promise<void>;
  revokeSession(sessionId: string, now: Date): Promise<void>;
  /** Revokes every active session for adminUserId except exceptSessionId (if given); returns the number revoked. */
  revokeAllSessionsForAdmin(adminUserId: string, now: Date, exceptSessionId: string | null): Promise<number>;
}

export function createInMemoryAdminSessionRepository(deps: {
  generateId: () => string;
  isAdminActive: (adminUserId: string) => boolean;
}): AdminSessionRepository & {
  sessions: Map<string, AdminSessionRecord & { sessionTokenHash: string }>;
} {
  const sessions = new Map<string, AdminSessionRecord & { sessionTokenHash: string }>();
  const byTokenHash = new Map<string, string>();

  function liveRecord(id: string): (AdminSessionRecord & { sessionTokenHash: string }) | undefined {
    const record = sessions.get(id);
    if (!record) return undefined;
    record.adminIsActive = deps.isAdminActive(record.adminUserId);
    return record;
  }

  return {
    sessions,
    async createSession({ adminUserId, sessionTokenHash, csrfTokenHash, now, expiresAt, ipHash: _ipHash }) {
      const record = {
        id: deps.generateId(),
        adminUserId,
        csrfTokenHash,
        createdAt: now,
        expiresAt,
        revokedAt: null,
        adminIsActive: deps.isAdminActive(adminUserId),
        sessionTokenHash,
      };
      sessions.set(record.id, record);
      byTokenHash.set(sessionTokenHash, record.id);
      return record;
    },
    async findSessionByTokenHash(sessionTokenHash) {
      const id = byTokenHash.get(sessionTokenHash);
      if (!id) return null;
      return liveRecord(id) ?? null;
    },
    async extendExpiry(sessionId, newExpiresAt) {
      const record = sessions.get(sessionId);
      if (record) record.expiresAt = newExpiresAt;
    },
    async rotateToken(sessionId, newSessionTokenHash, newExpiresAt) {
      const record = sessions.get(sessionId);
      if (!record) return;
      byTokenHash.delete(record.sessionTokenHash);
      record.sessionTokenHash = newSessionTokenHash;
      record.expiresAt = newExpiresAt;
      byTokenHash.set(newSessionTokenHash, sessionId);
    },
    async revokeSession(sessionId, now) {
      const record = sessions.get(sessionId);
      if (record) record.revokedAt = now;
    },
    async revokeAllSessionsForAdmin(adminUserId, now, exceptSessionId) {
      let count = 0;
      for (const record of sessions.values()) {
        if (record.adminUserId !== adminUserId) continue;
        if (record.id === exceptSessionId) continue;
        if (record.revokedAt) continue;
        record.revokedAt = now;
        count += 1;
      }
      return count;
    },
  };
}

export interface CreatedAdminSession {
  rawSessionToken: string;
  rawCsrfToken: string;
  sessionExpiresAt: Date;
  sessionId: string;
}

export async function createAdminSession(
  repo: AdminSessionRepository,
  adminUserId: string,
  now: Date,
  gen: { randomToken: () => string },
  ipHash: string | null,
): Promise<CreatedAdminSession> {
  const rawSessionToken = gen.randomToken();
  const rawCsrfToken = gen.randomToken();
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_MAX_AGE_MS);
  const record = await repo.createSession({
    adminUserId,
    sessionTokenHash: hashToken(rawSessionToken),
    csrfTokenHash: hashToken(rawCsrfToken),
    now,
    expiresAt,
    ipHash,
  });
  return { rawSessionToken, rawCsrfToken, sessionExpiresAt: expiresAt, sessionId: record.id };
}

function isLive(session: AdminSessionRecord, now: Date): boolean {
  if (session.revokedAt) return false;
  if (session.expiresAt.getTime() <= now.getTime()) return false;
  if (!session.adminIsActive) return false;
  return true;
}

/** Read-only authentication check - never touches/extends/rotates anything, so it is safe to use from GET handlers (which must never mutate state). */
export async function requireAdminSession(repo: AdminSessionRepository, rawSessionToken: string | null, now: Date): Promise<AdminSessionRecord> {
  if (!rawSessionToken) throw new UnauthenticatedError("no admin session cookie present");
  const session = await repo.findSessionByTokenHash(hashToken(rawSessionToken));
  if (!session || !isLive(session, now)) {
    throw new UnauthenticatedError("admin session missing, expired, revoked, or account deactivated");
  }
  return session;
}

export function requireAdminCsrf(session: AdminSessionRecord, submittedRawCsrfToken: string | null): void {
  if (!submittedRawCsrfToken) throw new CsrfFailedError(`missing ${ADMIN_CSRF_HEADER_NAME} header`);
  if (!verifyHashedToken(submittedRawCsrfToken, session.csrfTokenHash)) {
    throw new CsrfFailedError("admin csrf token mismatch");
  }
}

export interface AdminSessionAndCsrfResult {
  session: AdminSessionRecord;
  /** Present only when this call rotated the token - the caller's Response must carry this as a fresh Set-Cookie header. */
  rotatedRawSessionToken: string | null;
}

/**
 * Full authentication for a MUTATING admin endpoint: session + CSRF, plus
 * sliding renewal (extend expiresAt) and, once close to expiry, token
 * rotation (fresh raw token + cookie). Deliberately only ever called from
 * mutating (CSRF-protected) handlers - never from a read-only GET handler,
 * so "GET must not mutate state" holds by construction: the only code path
 * that extends/rotates a session is gated behind the same CSRF check every
 * other admin mutation already requires.
 */
export async function requireAdminSessionAndCsrf(
  repo: AdminSessionRepository,
  rawSessionToken: string | null,
  submittedRawCsrfToken: string | null,
  now: Date,
  gen: { randomToken: () => string },
): Promise<AdminSessionAndCsrfResult> {
  const session = await requireAdminSession(repo, rawSessionToken, now);
  requireAdminCsrf(session, submittedRawCsrfToken);

  const remainingMs = session.expiresAt.getTime() - now.getTime();
  const absoluteDeadline = session.createdAt.getTime() + ADMIN_SESSION_ABSOLUTE_MAX_MS;
  const proposedExpiry = Math.min(now.getTime() + ADMIN_SESSION_MAX_AGE_MS, absoluteDeadline);

  if (remainingMs <= ADMIN_SESSION_ROTATION_WINDOW_MS && proposedExpiry > now.getTime()) {
    const rawSessionTokenNew = gen.randomToken();
    await repo.rotateToken(session.id, hashToken(rawSessionTokenNew), new Date(proposedExpiry));
    return { session, rotatedRawSessionToken: rawSessionTokenNew };
  }

  if (proposedExpiry > session.expiresAt.getTime()) {
    await repo.extendExpiry(session.id, new Date(proposedExpiry));
  }
  return { session, rotatedRawSessionToken: null };
}
