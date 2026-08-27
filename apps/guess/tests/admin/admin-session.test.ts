import assert from "node:assert/strict";
import { test } from "node:test";
import { CsrfFailedError, UnauthenticatedError } from "../../src/http/session";
import {
  ADMIN_SESSION_MAX_AGE_MS,
  ADMIN_SESSION_ROTATION_WINDOW_MS,
  adminSessionCookieAttributes,
  createAdminSession,
  createInMemoryAdminSessionRepository,
  requireAdminCsrf,
  requireAdminSession,
  requireAdminSessionAndCsrf,
} from "../../src/http/admin-session";

const NOW = new Date("2026-01-01T12:00:00Z");
let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
let tokenCounter = 0;
function nextToken() {
  tokenCounter += 1;
  return `raw-token-${tokenCounter}`;
}

function setup(isActive = true) {
  const repo = createInMemoryAdminSessionRepository({ generateId: () => nextId("sess"), isAdminActive: () => isActive });
  return repo;
}

test("adminSessionCookieAttributes: Path=/guess, SameSite=Strict, HttpOnly always true, Secure only in production", () => {
  const dev = adminSessionCookieAttributes(false);
  const prod = adminSessionCookieAttributes(true);
  assert.equal(dev.path, "/guess");
  assert.equal(dev.sameSite, "Strict");
  assert.equal(dev.httpOnly, true);
  assert.equal(dev.secure, false);
  assert.equal(prod.secure, true);
  assert.equal(dev.maxAgeSeconds, Math.floor(ADMIN_SESSION_MAX_AGE_MS / 1000));
});

test("requireAdminSession rejects a missing cookie", async () => {
  const repo = setup();
  await assert.rejects(requireAdminSession(repo, null, NOW), UnauthenticatedError);
});

test("requireAdminSession rejects an unknown token", async () => {
  const repo = setup();
  await assert.rejects(requireAdminSession(repo, "not-a-real-token", NOW), UnauthenticatedError);
});

test("requireAdminSession rejects an expired session", async () => {
  const repo = setup();
  const created = await createAdminSession(repo, "admin-1", NOW, { randomToken: nextToken }, null);
  const later = new Date(created.sessionExpiresAt.getTime() + 1000);
  await assert.rejects(requireAdminSession(repo, created.rawSessionToken, later), UnauthenticatedError);
});

test("requireAdminSession rejects a revoked session", async () => {
  const repo = setup();
  const created = await createAdminSession(repo, "admin-1", NOW, { randomToken: nextToken }, null);
  const session = await requireAdminSession(repo, created.rawSessionToken, NOW);
  await repo.revokeSession(session.id, NOW);
  await assert.rejects(requireAdminSession(repo, created.rawSessionToken, NOW), UnauthenticatedError);
});

test("requireAdminSession rejects a session whose admin account has been deactivated - dies immediately, not just on next login", async () => {
  const repo = setup(false); // isAdminActive always false
  const created = await createAdminSession(repo, "admin-1", NOW, { randomToken: nextToken }, null);
  await assert.rejects(requireAdminSession(repo, created.rawSessionToken, NOW), UnauthenticatedError);
});

test("requireAdminCsrf rejects a missing header and a mismatched token", async () => {
  const repo = setup();
  const created = await createAdminSession(repo, "admin-1", NOW, { randomToken: nextToken }, null);
  const session = await requireAdminSession(repo, created.rawSessionToken, NOW);
  assert.throws(() => requireAdminCsrf(session, null), CsrfFailedError);
  assert.throws(() => requireAdminCsrf(session, "wrong-csrf-token"), CsrfFailedError);
  assert.doesNotThrow(() => requireAdminCsrf(session, created.rawCsrfToken));
});

test("requireAdminSessionAndCsrf does not rotate/extend a fresh session (no sliding action needed)", async () => {
  const repo = setup();
  const created = await createAdminSession(repo, "admin-1", NOW, { randomToken: nextToken }, null);
  const result = await requireAdminSessionAndCsrf(repo, created.rawSessionToken, created.rawCsrfToken, NOW, { randomToken: nextToken });
  assert.equal(result.rotatedRawSessionToken, null);
});

test("requireAdminSessionAndCsrf rotates the token once within the rotation window of expiry", async () => {
  const repo = setup();
  const created = await createAdminSession(repo, "admin-1", NOW, { randomToken: nextToken }, null);
  const nearExpiry = new Date(created.sessionExpiresAt.getTime() - ADMIN_SESSION_ROTATION_WINDOW_MS + 1000);
  const result = await requireAdminSessionAndCsrf(repo, created.rawSessionToken, created.rawCsrfToken, nearExpiry, { randomToken: nextToken });
  assert.ok(result.rotatedRawSessionToken, "expected a fresh token to be issued");
  assert.notEqual(result.rotatedRawSessionToken, created.rawSessionToken);

  // The OLD token must no longer authenticate after rotation.
  await assert.rejects(requireAdminSession(repo, created.rawSessionToken, nearExpiry), UnauthenticatedError);
  // The NEW token must.
  const revalidated = await requireAdminSession(repo, result.rotatedRawSessionToken!, nearExpiry);
  assert.equal(revalidated.adminUserId, "admin-1");
});

test("requireAdminSessionAndCsrf on a GET-only read path is never invoked - requireAdminSession alone never mutates the repository", async () => {
  const repo = setup();
  const created = await createAdminSession(repo, "admin-1", NOW, { randomToken: nextToken }, null);
  const before = repo.sessions.get((await requireAdminSession(repo, created.rawSessionToken, NOW)).id);
  const beforeExpiry = before?.expiresAt.getTime();
  // Simulate several read-only calls, as a GET handler would.
  await requireAdminSession(repo, created.rawSessionToken, NOW);
  await requireAdminSession(repo, created.rawSessionToken, NOW);
  const after = repo.sessions.get((await requireAdminSession(repo, created.rawSessionToken, NOW)).id);
  assert.equal(after?.expiresAt.getTime(), beforeExpiry, "read-only session checks must never extend expiresAt");
});

test("revokeAllSessionsForAdmin revokes every other session but never the excepted (current) one", async () => {
  const repo = setup();
  const a = await createAdminSession(repo, "admin-1", NOW, { randomToken: nextToken }, null);
  const b = await createAdminSession(repo, "admin-1", NOW, { randomToken: nextToken }, null);
  const c = await createAdminSession(repo, "admin-1", NOW, { randomToken: nextToken }, null);
  const sessionA = await requireAdminSession(repo, a.rawSessionToken, NOW);

  const revokedCount = await repo.revokeAllSessionsForAdmin("admin-1", NOW, sessionA.id);
  assert.equal(revokedCount, 2);

  await assert.doesNotReject(requireAdminSession(repo, a.rawSessionToken, NOW), "the excepted session must remain valid");
  await assert.rejects(requireAdminSession(repo, b.rawSessionToken, NOW), UnauthenticatedError);
  await assert.rejects(requireAdminSession(repo, c.rawSessionToken, NOW), UnauthenticatedError);
});
