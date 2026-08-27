import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CsrfFailedError,
  SESSION_ROTATION_THRESHOLD_MS,
  UnauthenticatedError,
  bootstrapSession,
  createInMemorySessionRepository,
  expiredCookie,
  generateRawToken,
  hashToken,
  requireCsrf,
  requireSession,
  serializeCookie,
  sessionCookieAttributes,
  verifyHashedToken,
} from "../../src/http/session";

let idCounter = 0;
function freshId(): string {
  idCounter += 1;
  return `sess-${idCounter}`;
}
let tokenCounter = 0;
function fakeRandomToken(): string {
  tokenCounter += 1;
  return `raw-token-${tokenCounter}`;
}

const NOW = new Date("2026-01-01T00:00:00Z");

test("generateRawToken produces distinct, non-trivial-length tokens", () => {
  const a = generateRawToken();
  const b = generateRawToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
});

test("hashToken is deterministic", () => {
  assert.equal(hashToken("abc"), hashToken("abc"));
  assert.notEqual(hashToken("abc"), hashToken("abd"));
});

test("verifyHashedToken accepts the correct raw token and rejects a wrong one", () => {
  const raw = "my-raw-token";
  const hash = hashToken(raw);
  assert.equal(verifyHashedToken(raw, hash), true);
  assert.equal(verifyHashedToken("wrong-token", hash), false);
});

test("serializeCookie includes all required attributes", () => {
  const cookie = serializeCookie("guess_session", "abc123", {
    maxAgeSeconds: 100,
    path: "/guess",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
  assert.match(cookie, /^guess_session=abc123/);
  assert.match(cookie, /Max-Age=100/);
  assert.match(cookie, /Path=\/guess/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});

test("sessionCookieAttributes: Secure is present in production, absent in development", () => {
  const prod = sessionCookieAttributes(true);
  const dev = sessionCookieAttributes(false);
  assert.equal(prod.secure, true);
  assert.equal(dev.secure, false);
  assert.equal(prod.path, "/guess");
  assert.equal(dev.path, "/guess");
  assert.equal(prod.httpOnly, true);
  assert.equal(dev.httpOnly, true);
  assert.equal(prod.sameSite, "Lax");
});

test("cookie attribute rendering reflects the dev/prod branch end to end", () => {
  const prodCookie = serializeCookie("guess_session", "x", sessionCookieAttributes(true));
  const devCookie = serializeCookie("guess_session", "x", sessionCookieAttributes(false));
  assert.match(prodCookie, /Secure/);
  assert.doesNotMatch(devCookie, /Secure/);
});

test("expiredCookie clears with Max-Age=0", () => {
  const cookie = expiredCookie("guess_session", "/guess", true);
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /guess_session=;/);
});

test("bootstrapSession with no existing cookie creates a new session and returns fresh raw tokens", async () => {
  const repo = createInMemorySessionRepository({ generateId: freshId });
  const result = await bootstrapSession(repo, NOW, null, { randomToken: fakeRandomToken });
  assert.equal(result.isNewSession, true);
  assert.equal(result.rotatedSession, false);
  assert.ok(result.rawSessionToken);
  assert.ok(result.rawCsrfToken);
  assert.equal(repo.sessions.size, 1);
});

test("bootstrapSession with a valid, recent existing session reuses the session token and only rotates CSRF", async () => {
  const repo = createInMemorySessionRepository({ generateId: freshId });
  const first = await bootstrapSession(repo, NOW, null, { randomToken: fakeRandomToken });

  const later = new Date(NOW.getTime() + 60_000);
  const second = await bootstrapSession(repo, later, first.rawSessionToken, { randomToken: fakeRandomToken });

  assert.equal(second.isNewSession, false);
  assert.equal(second.rotatedSession, false);
  assert.equal(second.rawSessionToken, first.rawSessionToken, "session token must not change on an ordinary resume");
  assert.notEqual(second.rawCsrfToken, first.rawCsrfToken, "csrf token rotates on every bootstrap");
  assert.equal(repo.sessions.size, 1, "must not create a second session row");
});

test("bootstrapSession rotates the session token once it is older than the rotation threshold", async () => {
  const repo = createInMemorySessionRepository({ generateId: freshId });
  const first = await bootstrapSession(repo, NOW, null, { randomToken: fakeRandomToken });

  const muchLater = new Date(NOW.getTime() + SESSION_ROTATION_THRESHOLD_MS + 1000);
  const second = await bootstrapSession(repo, muchLater, first.rawSessionToken, { randomToken: fakeRandomToken });

  assert.equal(second.rotatedSession, true);
  assert.notEqual(second.rawSessionToken, first.rawSessionToken);
  assert.equal(repo.sessions.size, 1, "rotation updates the existing row in place, it does not create a second one");
});

test("bootstrapSession with an expired session cookie falls through to creating a brand new session", async () => {
  const repo = createInMemorySessionRepository({ generateId: freshId });
  const first = await bootstrapSession(repo, NOW, null, { randomToken: fakeRandomToken });

  const afterExpiry = new Date(first.sessionExpiresAt.getTime() + 1000);
  const second = await bootstrapSession(repo, afterExpiry, first.rawSessionToken, { randomToken: fakeRandomToken });

  assert.equal(second.isNewSession, true);
  assert.notEqual(second.rawSessionToken, first.rawSessionToken);
});

test("bootstrapSession with a garbage/unknown cookie value falls through to creating a new session, not an error", async () => {
  const repo = createInMemorySessionRepository({ generateId: freshId });
  const result = await bootstrapSession(repo, NOW, "totally-made-up-token", { randomToken: fakeRandomToken });
  assert.equal(result.isNewSession, true);
});

test("requireSession rejects a missing cookie", async () => {
  const repo = createInMemorySessionRepository({ generateId: freshId });
  await assert.rejects(() => requireSession(repo, null, NOW), UnauthenticatedError);
});

test("requireSession rejects an expired session", async () => {
  const repo = createInMemorySessionRepository({ generateId: freshId });
  const result = await bootstrapSession(repo, NOW, null, { randomToken: fakeRandomToken });
  const afterExpiry = new Date(result.sessionExpiresAt.getTime() + 1000);
  await assert.rejects(() => requireSession(repo, result.rawSessionToken, afterExpiry), UnauthenticatedError);
});

test("requireSession accepts a valid session and returns its record", async () => {
  const repo = createInMemorySessionRepository({ generateId: freshId });
  const result = await bootstrapSession(repo, NOW, null, { randomToken: fakeRandomToken });
  const session = await requireSession(repo, result.rawSessionToken, NOW);
  assert.ok(session.id);
});

test("requireCsrf rejects a missing header", async () => {
  const repo = createInMemorySessionRepository({ generateId: freshId });
  const result = await bootstrapSession(repo, NOW, null, { randomToken: fakeRandomToken });
  const session = await requireSession(repo, result.rawSessionToken, NOW);
  assert.throws(() => requireCsrf(session, null), CsrfFailedError);
});

test("requireCsrf rejects a wrong token", async () => {
  const repo = createInMemorySessionRepository({ generateId: freshId });
  const result = await bootstrapSession(repo, NOW, null, { randomToken: fakeRandomToken });
  const session = await requireSession(repo, result.rawSessionToken, NOW);
  assert.throws(() => requireCsrf(session, "wrong-csrf-token"), CsrfFailedError);
});

test("requireCsrf accepts the correct token issued at bootstrap", async () => {
  const repo = createInMemorySessionRepository({ generateId: freshId });
  const result = await bootstrapSession(repo, NOW, null, { randomToken: fakeRandomToken });
  const session = await requireSession(repo, result.rawSessionToken, NOW);
  assert.doesNotThrow(() => requireCsrf(session, result.rawCsrfToken));
});
