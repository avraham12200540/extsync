import { and, eq } from "drizzle-orm";
import type { GuessDb } from "../db/client";
import { idempotencyKey } from "../db/schema";
import type { IdempotencyRecord, IdempotencyRepository } from "./idempotency";

/**
 * Real Postgres-backed IdempotencyRepository. Not integration-tested (no
 * PostgreSQL in this environment). Uses insert-then-fetch-on-conflict
 * against the idempotency_key table's unique (key, endpoint) index - the
 * same "lost the race, read back what won" idiom already used by
 * createDrizzleGameUnitOfWork's daily-game creation.
 */
// -1 is a sentinel meaning "reserved, not yet completed" in the DB row -
// never a real HTTP status code, and translated back to `null` (the
// IdempotencyRecord contract's "pending" value) on every read.
// response_body is NOT NULL in the schema (it's the completed response's
// JSON, not meant to ever be absent for a finished row), so the pending
// placeholder uses an empty JSON object rather than SQL NULL.
const PENDING_SENTINEL = -1;
const PENDING_BODY_PLACEHOLDER = {};

export function createDrizzleIdempotencyRepository(db: GuessDb): IdempotencyRepository {
  function toRecord(row: typeof idempotencyKey.$inferSelect): IdempotencyRecord {
    return {
      requestHash: row.requestHash,
      responseStatus: row.responseStatus === PENDING_SENTINEL ? null : row.responseStatus,
      responseBody: row.responseStatus === PENDING_SENTINEL ? null : row.responseBody,
    };
  }

  return {
    async reserveOrGet(key, endpoint, requestHash, now, expiresAt) {
      const [inserted] = await db
        .insert(idempotencyKey)
        .values({
          key,
          endpoint,
          requestHash,
          responseStatus: PENDING_SENTINEL,
          responseBody: PENDING_BODY_PLACEHOLDER,
          createdAt: now,
          expiresAt,
        })
        .onConflictDoNothing({ target: [idempotencyKey.key, idempotencyKey.endpoint] })
        .returning();
      if (inserted) {
        return { created: true, record: toRecord(inserted) };
      }
      const [existing] = await db
        .select()
        .from(idempotencyKey)
        .where(and(eq(idempotencyKey.key, key), eq(idempotencyKey.endpoint, endpoint)));
      if (!existing) throw new Error("reserveOrGet: no row after conflict");
      return { created: false, record: toRecord(existing) };
    },

    async completeResponse(key, endpoint, status, body) {
      await db
        .update(idempotencyKey)
        .set({ responseStatus: status, responseBody: body })
        .where(and(eq(idempotencyKey.key, key), eq(idempotencyKey.endpoint, endpoint)));
    },
  };
}
