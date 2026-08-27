import { and, desc, eq } from "drizzle-orm";
import type { GuessDb } from "../db/client";
import { adminAuditEvent } from "../db/schema";
import type { AdminAuditEventRecord, AdminAuditRepository } from "./audit";

/** Real Postgres-backed AdminAuditRepository. Not integration-tested (no PostgreSQL in this environment) - a thin, direct mapping onto the already-generated schema/migration. */
export function createDrizzleAdminAuditRepository(db: GuessDb): AdminAuditRepository {
  function toRecord(row: typeof adminAuditEvent.$inferSelect): AdminAuditEventRecord {
    return {
      id: row.id,
      actorAdminId: row.actorAdminId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      requestCorrelationId: row.requestCorrelationId,
      metadata: row.metadata as Record<string, unknown>,
      createdAt: row.createdAt,
    };
  }

  return {
    async record(input) {
      const [row] = await db
        .insert(adminAuditEvent)
        .values({
          actorAdminId: input.actorAdminId,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          requestCorrelationId: input.requestCorrelationId,
          metadata: input.metadata,
          createdAt: input.now,
        })
        .returning();
      if (!row) throw new Error("record: insert returned no row");
      return toRecord(row);
    },
    async listForTarget(targetType, targetId, limit) {
      const rows = await db
        .select()
        .from(adminAuditEvent)
        .where(and(eq(adminAuditEvent.targetType, targetType), eq(adminAuditEvent.targetId, targetId)))
        .orderBy(desc(adminAuditEvent.createdAt))
        .limit(limit);
      return rows.map(toRecord);
    },
  };
}
