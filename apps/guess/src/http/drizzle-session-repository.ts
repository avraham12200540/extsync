import { eq } from "drizzle-orm";
import type { GuessDb } from "../db/client";
import { playerSession } from "../db/schema";
import type { PlayerSessionRecord, SessionRepository } from "./session";

/**
 * Real Postgres-backed SessionRepository. Not integration-tested (no
 * PostgreSQL in this environment) - mirrors the in-memory fake method for
 * method, and its correctness rests on the same reasoning documented for
 * createDrizzleGameUnitOfWork in src/game/drizzle-unit-of-work.ts.
 */
export function createDrizzleSessionRepository(db: GuessDb): SessionRepository {
  function toRecord(row: typeof playerSession.$inferSelect): PlayerSessionRecord {
    return { id: row.id, csrfTokenHash: row.csrfTokenHash, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, expiresAt: row.expiresAt };
  }

  return {
    async createSession(sessionTokenHash, csrfTokenHash, now, expiresAt) {
      const [row] = await db
        .insert(playerSession)
        .values({ sessionTokenHash, csrfTokenHash, createdAt: now, lastSeenAt: now, expiresAt })
        .returning();
      if (!row) throw new Error("createSession: insert returned no row");
      return toRecord(row);
    },
    async findSessionByTokenHash(sessionTokenHash) {
      const [row] = await db.select().from(playerSession).where(eq(playerSession.sessionTokenHash, sessionTokenHash));
      return row ? toRecord(row) : null;
    },
    async touchSession(sessionId, now) {
      await db.update(playerSession).set({ lastSeenAt: now }).where(eq(playerSession.id, sessionId));
    },
    async rotateSession(sessionId, newSessionTokenHash, newExpiresAt) {
      await db
        .update(playerSession)
        .set({ sessionTokenHash: newSessionTokenHash, expiresAt: newExpiresAt })
        .where(eq(playerSession.id, sessionId));
    },
    async rotateCsrf(sessionId, newCsrfTokenHash) {
      await db.update(playerSession).set({ csrfTokenHash: newCsrfTokenHash }).where(eq(playerSession.id, sessionId));
    },
  };
}
