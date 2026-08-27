import type { AdminSessionRepository } from "../http/admin-session";
import { createAdminSession } from "../http/admin-session";
import type { AdminUserRepository } from "./admin-user-repository";
import type { AdminAuditRepository } from "./audit";
import { recordAuditEvent } from "./audit";
import { ACCOUNT_LOCKOUT_MS, MAX_FAILED_LOGIN_ATTEMPTS } from "./config";
import { verifyAdminPassword, verifyAgainstDummyHash } from "./password";

export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Thrown for every login failure reason (unknown email, wrong password,
 * locked account, deactivated account) - deliberately the same class with
 * the same message every time, so a handler mapping it to an HTTP response
 * cannot accidentally leak which reason applied. See the module doc below
 * for the full constant-shape/timing-parity design.
 */
export class InvalidAdminCredentialsError extends Error {}

export interface AttemptAdminLoginDeps {
  adminUserRepo: AdminUserRepository;
  adminSessionRepo: AdminSessionRepository;
  auditRepo: AdminAuditRepository;
}

export interface AttemptAdminLoginInput {
  email: string;
  password: string;
  now: Date;
  ipHash: string | null;
  requestCorrelationId: string;
  gen: { randomToken: () => string };
}

export interface AdminLoginResult {
  rawSessionToken: string;
  rawCsrfToken: string;
  sessionExpiresAt: Date;
  adminUserId: string;
}

/**
 * Constant-shape login against account enumeration: every failure path
 * throws the identical InvalidAdminCredentialsError, and every path that
 * can determine "no real account" (or "account exists but should not
 * proceed") still performs a real Argon2id verify of comparable cost - see
 * password.ts's verifyAgainstDummyHash - so response timing cannot become
 * a second oracle alongside the response body. Per-account bounded
 * lockout (adminUser.failedLoginCount/lockedUntil) never gets its own
 * distinguishable status/message either - a locked account fails exactly
 * like a wrong password, not with a different code a client could act on.
 * IP-level throttling (RATE_LIMITS.adminLogin, enforced by the caller
 * BEFORE this function runs) is the only intentionally-different-looking
 * failure (429), and that is safe: it is account-agnostic by construction.
 */
export async function attemptAdminLogin(deps: AttemptAdminLoginDeps, input: AttemptAdminLoginInput): Promise<AdminLoginResult> {
  const normalizedEmail = normalizeAdminEmail(input.email);
  const account = await deps.adminUserRepo.findByEmail(normalizedEmail);

  if (!account) {
    await verifyAgainstDummyHash(input.password);
    await recordAuditEvent(deps.auditRepo, {
      actorAdminId: null,
      action: "admin.login_failed",
      targetType: null,
      targetId: null,
      requestCorrelationId: input.requestCorrelationId,
      metadata: { reason: "no_such_account" },
      now: input.now,
    });
    throw new InvalidAdminCredentialsError("invalid credentials");
  }

  const isLocked = account.lockedUntil !== null && account.lockedUntil.getTime() > input.now.getTime();
  const passwordOk = await verifyAdminPassword(account.passwordHash, input.password);

  if (isLocked || !account.isActive || !passwordOk) {
    if (!isLocked) {
      const newFailedCount = account.failedLoginCount + 1;
      const shouldLock = newFailedCount >= MAX_FAILED_LOGIN_ATTEMPTS;
      await deps.adminUserRepo.recordFailedLogin(
        account.id,
        input.now,
        newFailedCount,
        shouldLock ? new Date(input.now.getTime() + ACCOUNT_LOCKOUT_MS) : null,
      );
    }
    await recordAuditEvent(deps.auditRepo, {
      actorAdminId: account.id,
      action: "admin.login_failed",
      targetType: "admin_user",
      targetId: account.id,
      requestCorrelationId: input.requestCorrelationId,
      metadata: { reason: isLocked ? "locked" : !account.isActive ? "inactive" : "wrong_password" },
      now: input.now,
    });
    throw new InvalidAdminCredentialsError("invalid credentials");
  }

  await deps.adminUserRepo.recordSuccessfulLogin(account.id, input.now);
  const created = await createAdminSession(deps.adminSessionRepo, account.id, input.now, input.gen, input.ipHash);

  await recordAuditEvent(deps.auditRepo, {
    actorAdminId: account.id,
    action: "admin.login_success",
    targetType: "admin_session",
    targetId: created.sessionId,
    requestCorrelationId: input.requestCorrelationId,
    metadata: {},
    now: input.now,
  });

  return {
    rawSessionToken: created.rawSessionToken,
    rawCsrfToken: created.rawCsrfToken,
    sessionExpiresAt: created.sessionExpiresAt,
    adminUserId: account.id,
  };
}
