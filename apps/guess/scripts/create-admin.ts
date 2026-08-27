/**
 * Offline admin-bootstrap script. Written and typechecked, but NEVER
 * executed by any automated agent, and not wired into any build/deploy
 * step. Running this for real is a manual action a human operator takes
 * once, directly against the isolated guess-db, during the (separate,
 * approval-gated) deployment stage - not something this codebase or CI
 * ever does on its own.
 *
 * Contract:
 *  - No default/hardcoded credential of any kind lives in this file.
 *  - Reads ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD from the
 *    process environment only; both are required, neither has a fallback.
 *  - Password hashing goes through src/admin/password.ts's
 *    hashAdminPassword - the SAME explicit Argon2id parameters the login
 *    handler verifies against (src/admin/config.ts's ARGON2_PARAMS) - so a
 *    bootstrapped admin can always log in; the params can never drift
 *    between this script and the real login path.
 *  - Rejects a password shorter than MIN_ADMIN_PASSWORD_LENGTH, or one
 *    that trivially equals the email or is a single repeated character -
 *    not a full password-strength library, but enough to catch the
 *    obviously-wrong inputs an operator might paste by accident.
 *  - Never logs the password, the resulting Argon2id hash, or any other
 *    secret. Only the normalized email (not a secret) and a plain
 *    success/failure message are ever printed.
 *
 * Usage (manual, later stage, never by this agent):
 *   ADMIN_BOOTSTRAP_EMAIL=... ADMIN_BOOTSTRAP_PASSWORD=... npm run create-admin
 */
import { normalizeAdminEmail } from "../src/admin/auth-service";
import { MIN_ADMIN_PASSWORD_LENGTH } from "../src/admin/config";
import { hashAdminPassword } from "../src/admin/password";
import { getDb } from "../src/db/client";
import { adminUser } from "../src/db/schema";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in the environment (no default is provided)`);
  }
  return value;
}

function assertNotWeak(password: string, normalizedEmail: string): void {
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_BOOTSTRAP_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
  }
  if (password.toLowerCase() === normalizedEmail) {
    throw new Error("ADMIN_BOOTSTRAP_PASSWORD must not be the same as the email address");
  }
  if (new Set(password).size === 1) {
    throw new Error("ADMIN_BOOTSTRAP_PASSWORD must not be a single repeated character");
  }
}

async function main(): Promise<void> {
  const email = normalizeAdminEmail(requireEnv("ADMIN_BOOTSTRAP_EMAIL"));
  const password = requireEnv("ADMIN_BOOTSTRAP_PASSWORD");

  assertNotWeak(password, email);

  const passwordHash = await hashAdminPassword(password);

  const db = getDb();
  await db
    .insert(adminUser)
    .values({ email, passwordHash })
    .onConflictDoUpdate({
      target: adminUser.email,
      set: { passwordHash, isActive: true, failedLoginCount: 0, lockedUntil: null },
    });

  // Deliberately no re-read/print of the stored row: it would risk
  // printing passwordHash. Success is reported by email alone.
  console.log(`admin user upserted for ${email}`);
}

main().catch((err: unknown) => {
  console.error("create-admin failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
