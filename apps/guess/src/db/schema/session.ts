import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Anonymous player identity. Like admin_session, only a hash of the raw
// cookie token is ever stored. `ip_hash` is a coarse, day-scale signal
// used only to soft-rate-limit new session creation per IP (see
// rate_limit_bucket) - not fingerprinting, and not used to identify a
// player across sessions.
export const playerSession = pgTable(
  "player_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionTokenHash: text("session_token_hash").notNull(),
    // Hash-only, exactly like sessionTokenHash (see admin_session.csrf_token_hash
    // for the full rationale): the raw high-entropy CSRF token is sent to
    // the client once and never stored server-side, only its hash is.
    csrfTokenHash: text("csrf_token_hash").notNull(),
    // Self-reference via a lazy callback (rather than a direct `playerSession.id`)
    // because `playerSession` is still being assigned at this point.
    rotatedFromId: uuid("rotated_from_id").references((): AnyPgColumn => playerSession.id, {
      onDelete: "set null",
    }),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("uq_player_session_token_hash").on(table.sessionTokenHash)],
);
