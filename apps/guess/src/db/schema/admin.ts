import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Real admin auth for the isolated app - not a reuse of ExtSync's
// platform_admin RBAC, which lives in a different service/database this
// app must not depend on.
export const adminUser = pgTable(
  "admin_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    // Argon2id hash string (includes algorithm/params/salt) - never a raw
    // password, and this column is the only credential material stored.
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_admin_user_email").on(table.email),
    check("chk_admin_user_failed_login_count_nonneg", sql`${table.failedLoginCount} >= 0`),
  ],
);

// Server-revocable admin sessions. The cookie carries the raw session
// token; only its SHA-256 hash is ever stored, mirroring the platform's
// own "store hash, not raw secret" discipline for its refresh tokens.
//
// Cookie-scope correction: an earlier draft of this design scoped the
// admin cookie to `/guess/admin` only. That would NOT be sent on requests
// to `/guess/api/admin/...` (a sibling path, not a child of
// `/guess/admin`), breaking every admin API call from the browser. Future
// auth code (Stage 5) must set the cookie `Path` to something that covers
// both admin pages and admin API routes - e.g. `/guess` - not
// `/guess/admin`.
export const adminSession = pgTable(
  "admin_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUser.id, { onDelete: "cascade" }),
    sessionTokenHash: text("session_token_hash").notNull(),
    // Hash-only, exactly like sessionTokenHash: a high-entropy raw CSRF
    // token is generated and sent to the legitimate client once (e.g.
    // embedded in the page on session creation); only its hash is ever
    // stored here. Validating a submitted token means hashing it and
    // comparing (constant-time) against this column - never reading back
    // or storing the raw value server-side. An earlier draft of this
    // schema stored the secret in plaintext on the theory that comparison
    // "requires" the literal value; that was wrong - hash-then-compare
    // works the same way it does for the session token itself.
    csrfTokenHash: text("csrf_token_hash").notNull(),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("uq_admin_session_token_hash").on(table.sessionTokenHash)],
);
