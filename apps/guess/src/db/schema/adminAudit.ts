import { jsonb, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { adminUser } from "./admin";

// Append-only audit trail for every admin action (auth events, moderation
// decisions, eligibility overrides, import triggers, session revocation).
// Rows are never updated or deleted by application code. `actorAdminId` is
// nullable because a failed login against an unknown email has no admin
// account to attribute the event to - the event is still recorded, just
// without an actor. `metadata` must only ever hold safe, structured,
// already-non-secret detail (e.g. {previousStatus, newStatus} or
// {reason}) - the write path (src/admin/audit.ts) is the single place that
// enforces this; this table has no way to enforce it at the schema level.
export const adminAuditEvent = pgTable(
  "admin_audit_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorAdminId: uuid("actor_admin_id").references(() => adminUser.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    requestCorrelationId: text("request_correlation_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_admin_audit_event_actor").on(table.actorAdminId),
    index("ix_admin_audit_event_action").on(table.action),
    index("ix_admin_audit_event_target").on(table.targetType, table.targetId),
    index("ix_admin_audit_event_created_at").on(table.createdAt),
  ],
);
