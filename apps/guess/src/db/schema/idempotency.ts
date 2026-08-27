import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Client-supplied idempotency keys for mutations where a network retry
 * must never repeat an effect (free-play game creation, advance) or apply
 * a second penalty (hint/guess - though those are already idempotent by
 * construction via the game domain's own unique constraints; this table
 * gives every mutating endpoint the SAME mechanism uniformly, rather than
 * a special case per route).
 *
 * `request_hash` lets a resubmission with the SAME key but a DIFFERENT
 * payload be rejected as a conflict, rather than silently replaying a
 * response that doesn't match what was actually asked for this time.
 * Bounded retention: rows are meant to be pruned once past `expires_at`
 * (a scheduled cleanup job is future, approval-gated infra work - see
 * README - this table only defines the shape, not the job).
 */
export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    endpoint: text("endpoint").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("uq_idempotency_key_endpoint").on(table.key, table.endpoint)],
);
