import assert from "node:assert/strict";
import { test } from "node:test";
import { createInMemoryAdminAuditRepository } from "../../src/admin/audit";
import { createInMemoryAdminUserRepository } from "../../src/admin/admin-user-repository";
import { InvalidAdminCredentialsError, attemptAdminLogin } from "../../src/admin/auth-service";
import { ACCOUNT_LOCKOUT_MS, MAX_FAILED_LOGIN_ATTEMPTS } from "../../src/admin/config";
import { hashAdminPassword } from "../../src/admin/password";
import { createInMemoryAdminSessionRepository } from "../../src/http/admin-session";

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

async function setup(seedPassword = "correct-horse-battery-staple") {
  const passwordHash = await hashAdminPassword(seedPassword);
  const adminUserRepo = createInMemoryAdminUserRepository([
    { id: "admin-1", email: "admin@example.invalid", passwordHash, isActive: true, failedLoginCount: 0, lockedUntil: null, lastLoginAt: null },
  ]);
  const adminSessionRepo = createInMemoryAdminSessionRepository({
    generateId: () => nextId("sess"),
    isAdminActive: (id) => adminUserRepo.users.get(id)?.isActive ?? false,
  });
  const auditRepo = createInMemoryAdminAuditRepository({ generateId: () => nextId("audit") });
  return { adminUserRepo, adminSessionRepo, auditRepo };
}

test("correct email + password logs in and creates a session", async () => {
  const deps = await setup();
  const result = await attemptAdminLogin(deps, {
    email: "  Admin@Example.Invalid  ",
    password: "correct-horse-battery-staple",
    now: NOW,
    ipHash: null,
    requestCorrelationId: "req-1",
    gen: { randomToken: nextToken },
  });
  assert.equal(result.adminUserId, "admin-1");
  assert.ok(result.rawSessionToken);
  assert.ok(result.rawCsrfToken);
  const audited = deps.auditRepo.events.at(-1);
  assert.equal(audited?.action, "admin.login_success");
});

test("wrong password throws InvalidAdminCredentialsError and increments failedLoginCount", async () => {
  const deps = await setup();
  await assert.rejects(
    attemptAdminLogin(deps, { email: "admin@example.invalid", password: "totally-wrong", now: NOW, ipHash: null, requestCorrelationId: "r", gen: { randomToken: nextToken } }),
    InvalidAdminCredentialsError,
  );
  const account = await deps.adminUserRepo.findByEmail("admin@example.invalid");
  assert.equal(account?.failedLoginCount, 1);
});

test("a nonexistent account throws the exact same error type/message as a wrong password - no account-enumeration signal", async () => {
  const deps = await setup();
  let unknownError: unknown;
  let wrongPasswordError: unknown;
  try {
    await attemptAdminLogin(deps, { email: "nobody@example.invalid", password: "irrelevant", now: NOW, ipHash: null, requestCorrelationId: "r1", gen: { randomToken: nextToken } });
  } catch (err) {
    unknownError = err;
  }
  try {
    await attemptAdminLogin(deps, { email: "admin@example.invalid", password: "wrong", now: NOW, ipHash: null, requestCorrelationId: "r2", gen: { randomToken: nextToken } });
  } catch (err) {
    wrongPasswordError = err;
  }
  assert.ok(unknownError instanceof InvalidAdminCredentialsError);
  assert.ok(wrongPasswordError instanceof InvalidAdminCredentialsError);
  assert.equal((unknownError as Error).message, (wrongPasswordError as Error).message);
});

test("account locks after MAX_FAILED_LOGIN_ATTEMPTS and further correct-password attempts still fail while locked", async () => {
  const deps = await setup();
  for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
    await assert.rejects(
      attemptAdminLogin(deps, { email: "admin@example.invalid", password: "wrong", now: NOW, ipHash: null, requestCorrelationId: `r${i}`, gen: { randomToken: nextToken } }),
    );
  }
  const locked = await deps.adminUserRepo.findByEmail("admin@example.invalid");
  assert.ok(locked?.lockedUntil !== null);

  // Even the CORRECT password fails while locked - lockout is not bypassable by finally guessing right.
  await assert.rejects(
    attemptAdminLogin(deps, { email: "admin@example.invalid", password: "correct-horse-battery-staple", now: NOW, ipHash: null, requestCorrelationId: "r-locked", gen: { randomToken: nextToken } }),
    InvalidAdminCredentialsError,
  );
});

test("after the lockout window passes, a correct login succeeds again and resets the counter", async () => {
  const deps = await setup();
  for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
    await assert.rejects(
      attemptAdminLogin(deps, { email: "admin@example.invalid", password: "wrong", now: NOW, ipHash: null, requestCorrelationId: `r${i}`, gen: { randomToken: nextToken } }),
    );
  }
  const afterLockout = new Date(NOW.getTime() + ACCOUNT_LOCKOUT_MS + 1000);
  const result = await attemptAdminLogin(deps, {
    email: "admin@example.invalid",
    password: "correct-horse-battery-staple",
    now: afterLockout,
    ipHash: null,
    requestCorrelationId: "r-after",
    gen: { randomToken: nextToken },
  });
  assert.equal(result.adminUserId, "admin-1");
  const account = await deps.adminUserRepo.findByEmail("admin@example.invalid");
  assert.equal(account?.failedLoginCount, 0);
  assert.equal(account?.lockedUntil, null);
});

test("a deactivated account cannot log in even with the correct password", async () => {
  const deps = await setup();
  const account = deps.adminUserRepo.users.get("admin-1")!;
  account.isActive = false;
  await assert.rejects(
    attemptAdminLogin(deps, { email: "admin@example.invalid", password: "correct-horse-battery-staple", now: NOW, ipHash: null, requestCorrelationId: "r", gen: { randomToken: nextToken } }),
    InvalidAdminCredentialsError,
  );
});
