/**
 * Central, server-only admin configuration - the ONE place password
 * hashing parameters, lockout thresholds, and pagination caps live.
 * Mirrors the src/game/config.ts convention for the same reason: one
 * import surface, no restated numbers scattered across handlers/services.
 */

/**
 * Explicit Argon2id parameters (OWASP-recommended baseline for a
 * server-side login: >=19 MiB memory, >=2 iterations, single-threaded).
 * Never left implicit/defaulted - see src/admin/password.ts - so a future
 * library version changing its own defaults can never silently weaken
 * this app's hashing strength.
 */
export const ARGON2_PARAMS = {
  memoryCostKib: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const MIN_ADMIN_PASSWORD_LENGTH = 12;

/** Failed attempts against ONE account (regardless of source IP) before that account is temporarily locked - independent of the per-IP rate limit (RATE_LIMITS.adminLogin). */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
/** How long an account stays locked once MAX_FAILED_LOGIN_ATTEMPTS is reached. */
export const ACCOUNT_LOCKOUT_MS = 15 * 60 * 1000;

/** Applies uniformly to every admin list endpoint (forum users, moderation queue, import runs) - never a caller-controlled unbounded page size. */
export const ADMIN_PAGE_SIZE_DEFAULT = 25;
export const ADMIN_PAGE_SIZE_MAX = 100;
