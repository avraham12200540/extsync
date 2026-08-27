import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Fixed-window rate limiting without depending on a shared/dedicated Redis
// (the isolated stack is deliberately just guess-web + guess-db). Not a
// scoring/game-tuning config table - this only throttles endpoints such as
// session creation, hint reveal and guess submission.
export const rateLimitBucket = pgTable(
  "rate_limit_bucket",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ipHash: text("ip_hash").notNull(),
    endpoint: text("endpoint").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("uq_rate_limit_bucket_window").on(table.ipHash, table.endpoint, table.windowStart),
    check("chk_rate_limit_bucket_count_nonneg", sql`${table.count} >= 0`),
  ],
);
