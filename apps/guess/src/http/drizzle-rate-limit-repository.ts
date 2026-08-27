import { sql } from "drizzle-orm";
import type { GuessDb } from "../db/client";
import { rateLimitBucket } from "../db/schema";
import type { RateLimitRepository } from "./rate-limit";

/**
 * Real Postgres-backed RateLimitRepository. Not integration-tested (no
 * PostgreSQL in this environment). Uses a single atomic
 * INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count
 * against the existing rate_limit_bucket table's unique
 * (ip_hash, endpoint, window_start) index - one round trip, no
 * read-then-write race.
 */
export function createDrizzleRateLimitRepository(db: GuessDb): RateLimitRepository {
  return {
    async incrementAndCheck(ipHash, endpoint, windowStart) {
      const [row] = await db
        .insert(rateLimitBucket)
        .values({ ipHash, endpoint, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [rateLimitBucket.ipHash, rateLimitBucket.endpoint, rateLimitBucket.windowStart],
          set: { count: sql`${rateLimitBucket.count} + 1` },
        })
        .returning({ count: rateLimitBucket.count });
      if (!row) throw new Error("incrementAndCheck: upsert returned no row");
      return row.count;
    },
  };
}
