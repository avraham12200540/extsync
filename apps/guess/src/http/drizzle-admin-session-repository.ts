import { and, eq, isNull, ne } from "drizzle-orm";
import type { GuessDb } from "../db/client";
import { adminSession, adminUser } from "../db/schema";
import type { AdminSessionRecord, AdminSessionRepository } from "./admin-session";

/**
 * Real Postgres-backed AdminSessionRepository. Not integration-tested (no
 * PostgreSQL in this environment) - mirrors the in-memory fake method for
 * method; adminIsActive is computed via a join against admin_user on every
 * read, exactly like the in-memory fake recomputes it from the shared
 * admin-user map, so a deactivated account's sessions die immediately
 * rather than only blocking future logins.
 */
export function createDrizzleAdminSessionRepository(db: GuessDb): AdminSessionRepository {
  function toRecord(row: {
    id: string;
    adminUserId: string;
    csrfTokenHash: string;
    createdAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
    adminIsActive: boolean;
  }): AdminSessionRecord {
    return {
      id: row.id,
      adminUserId: row.adminUserId,
      csrfTokenHash: row.csrfTokenHash,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      adminIsActive: row.adminIsActive,
    };
  }

  return {
    async createSession({ adminUserId, sessionTokenHash, csrfTokenHash, now, expiresAt }) {
      const [row] = await db
        .insert(adminSession)
        .values({ adminUserId, sessionTokenHash, csrfTokenHash, createdAt: now, expiresAt })
        .returning();
      if (!row) throw new Error("createSession: insert returned no row");
      const [userRow] = await db.select({ isActive: adminUser.isActive }).from(adminUser).where(eq(adminUser.id, adminUserId));
      return toRecord({ ...row, adminIsActive: userRow?.isActive ?? false });
    },

    async findSessionByTokenHash(sessionTokenHash) {
      const [row] = await db
        .select({
          id: adminSession.id,
          adminUserId: adminSession.adminUserId,
          csrfTokenHash: adminSession.csrfTokenHash,
          createdAt: adminSession.createdAt,
          expiresAt: adminSession.expiresAt,
          revokedAt: adminSession.revokedAt,
          adminIsActive: adminUser.isActive,
        })
        .from(adminSession)
        .innerJoin(adminUser, eq(adminSession.adminUserId, adminUser.id))
        .where(eq(adminSession.sessionTokenHash, sessionTokenHash));
      return row ? toRecord(row) : null;
    },

    async extendExpiry(sessionId, newExpiresAt) {
      await db.update(adminSession).set({ expiresAt: newExpiresAt }).where(eq(adminSession.id, sessionId));
    },

    async rotateToken(sessionId, newSessionTokenHash, newExpiresAt) {
      await db
        .update(adminSession)
        .set({ sessionTokenHash: newSessionTokenHash, expiresAt: newExpiresAt })
        .where(eq(adminSession.id, sessionId));
    },

    async revokeSession(sessionId, now) {
      await db.update(adminSession).set({ revokedAt: now }).where(eq(adminSession.id, sessionId));
    },

    async revokeAllSessionsForAdmin(adminUserId, now, exceptSessionId) {
      const conditions = [eq(adminSession.adminUserId, adminUserId), isNull(adminSession.revokedAt)];
      if (exceptSessionId) conditions.push(ne(adminSession.id, exceptSessionId));
      const rows = await db
        .update(adminSession)
        .set({ revokedAt: now })
        .where(and(...conditions))
        .returning({ id: adminSession.id });
      return rows.length;
    },
  };
}
