/**
 * Read/write access to admin_user, scoped to exactly what login and
 * account-status checks need. Password hashing/verification never happens
 * here - see src/admin/password.ts - this module only stores and returns
 * the opaque hash string.
 */

export interface AdminUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
}

export interface AdminUserRepository {
  /** email must already be normalized (trim + lowercase) by the caller - see normalizeAdminEmail in auth-service.ts. */
  findByEmail(normalizedEmail: string): Promise<AdminUserRecord | null>;
  findById(adminUserId: string): Promise<AdminUserRecord | null>;
  /** newLockedUntil is null to clear/leave-unlocked, or a future Date to lock. */
  recordFailedLogin(adminUserId: string, now: Date, newFailedCount: number, newLockedUntil: Date | null): Promise<void>;
  recordSuccessfulLogin(adminUserId: string, now: Date): Promise<void>;
}

export function createInMemoryAdminUserRepository(seed: AdminUserRecord[] = []): AdminUserRepository & { users: Map<string, AdminUserRecord> } {
  const users = new Map<string, AdminUserRecord>();
  for (const user of seed) users.set(user.id, { ...user });

  function findByEmailInternal(normalizedEmail: string): AdminUserRecord | undefined {
    for (const user of users.values()) {
      if (user.email === normalizedEmail) return user;
    }
    return undefined;
  }

  return {
    users,
    async findByEmail(normalizedEmail) {
      const user = findByEmailInternal(normalizedEmail);
      return user ? { ...user } : null;
    },
    async findById(adminUserId) {
      const user = users.get(adminUserId);
      return user ? { ...user } : null;
    },
    async recordFailedLogin(adminUserId, _now, newFailedCount, newLockedUntil) {
      const user = users.get(adminUserId);
      if (!user) return;
      user.failedLoginCount = newFailedCount;
      user.lockedUntil = newLockedUntil;
    },
    async recordSuccessfulLogin(adminUserId, now) {
      const user = users.get(adminUserId);
      if (!user) return;
      user.failedLoginCount = 0;
      user.lockedUntil = null;
      user.lastLoginAt = now;
    },
  };
}
