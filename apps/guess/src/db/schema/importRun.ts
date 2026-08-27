import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { importRunStatusEnum, importTriggerKindEnum } from "./enums";
import { adminUser } from "./admin";

// Observability for the mitmachim.top importer. Never fetches at gameplay
// time - this table only ever gets written by an admin-triggered or
// cron-triggered import job (Stage 2), independent of any player request.
export const importRun = pgTable(
  "import_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: importRunStatusEnum("status").notNull().default("running"),
    // Trigger-kind enum + nullable admin FK, not one field trying to mean
    // both "who" (a foreign key) and "what kind" (a free-form string) at
    // once. The check constraint keeps the two columns consistent: an
    // admin-triggered run must name the admin; a cron-triggered run must
    // not (there is no admin to name).
    triggerKind: importTriggerKindEnum("trigger_kind").notNull(),
    triggeredByAdminId: uuid("triggered_by_admin_id").references(() => adminUser.id, {
      onDelete: "set null",
    }),
    sourceEndpoint: text("source_endpoint").notNull(),
    cursorUsed: text("cursor_used"),
    postsFetched: integer("posts_fetched").notNull().default(0),
    postsNew: integer("posts_new").notNull().default(0),
    postsUpdated: integer("posts_updated").notNull().default(0),
    usersTouched: integer("users_touched").notNull().default(0),
    rateLimitEvents: integer("rate_limit_events").notNull().default(0),
    errorSummary: text("error_summary"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "chk_import_run_trigger_consistency",
      sql`(${table.triggerKind} = 'admin' AND ${table.triggeredByAdminId} IS NOT NULL)
          OR (${table.triggerKind} = 'cron' AND ${table.triggeredByAdminId} IS NULL)`,
    ),
    check("chk_import_run_counts_nonneg", sql`${table.postsFetched} >= 0
          AND ${table.postsNew} >= 0
          AND ${table.postsUpdated} >= 0
          AND ${table.usersTouched} >= 0
          AND ${table.rateLimitEvents} >= 0`),
  ],
);
