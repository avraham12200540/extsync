import { eq } from "drizzle-orm";
import type { GuessDb } from "../db/client";
import { adminUser } from "../db/schema";
import type { AdminUserRecord, AdminUserRepository } from "./admin-user-repository";

/**
 * Real Postgres-backed AdminUserRepository. Not integration-tested (no
 * PostgreSQL in this environment) - mirrors the in-memory fake method for
 * method, same reasoning documented on the other Drizzle adapters in this
 * codebase (e.g. drizzle-session-repository.ts).
 */
export function createDrizzleAdminUserRepository(db: GuessDb): AdminUserRepository {
  function toRecord(row: typeof adminUser.$inferSelect): AdminUserRecord {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      isActive: row.isActive,
      failedLoginCount: row.failedLoginCount,
      lockedUntil: row.lockedUntil,
      lastLoginAt: row.lastLoginAt,
    };
  }

  return {
    async findByEmail(normalizedEmail) {
      const [row] = await db.select().from(adminUser).where(eq(adminUser.email, normalizedEmail));
      return row ? toRecord(row) : null;
    },
    async findById(adminUserId) {
      const [row] = await db.select().from(adminUser).where(eq(adminUser.id, adminUserId));
      return row ? toRecord(row) : null;
    },
    async recordFailedLogin(adminUserId, now, newFailedCount, newLockedUntil) {
      await db
        .update(adminUser)
        .set({ failedLoginCount: newFailedCount, lockedUntil: newLockedUntil, updatedAt: now })
        .where(eq(adminUser.id, adminUserId));
    },
    async recordSuccessfulLogin(adminUserId, now) {
      await db
        .update(adminUser)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now })
        .where(eq(adminUser.id, adminUserId));
    },
  };
}
