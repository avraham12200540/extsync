/**
 * Append-only admin audit trail. Every write goes through recordAuditEvent
 * below - never a direct repository call from a handler/service - so this
 * one function is the single place that could enforce "never a password/
 * token/raw content in metadata" (structurally, metadata's type is a
 * plain JSON-safe record the caller builds explicitly field by field
 * elsewhere; this module does not accept arbitrary passthrough objects
 * like `{...someDomainRecord}` precisely to avoid an accidental leak that
 * way - see the callers in auth-service.ts/moderation-repository.ts/etc.
 * for the discipline this depends on).
 */

export interface AdminAuditEventRecord {
  id: string;
  actorAdminId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  requestCorrelationId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface RecordAuditEventInput {
  actorAdminId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  requestCorrelationId: string;
  metadata: Record<string, unknown>;
  now: Date;
}

export interface AdminAuditRepository {
  record(input: RecordAuditEventInput): Promise<AdminAuditEventRecord>;
  /** Newest first, capped by limit - used by a future audit-log admin view; not required by this stage's endpoint list but kept minimal and ready. */
  listForTarget(targetType: string, targetId: string, limit: number): Promise<AdminAuditEventRecord[]>;
}

export function createInMemoryAdminAuditRepository(deps: { generateId: () => string }): AdminAuditRepository & { events: AdminAuditEventRecord[] } {
  const events: AdminAuditEventRecord[] = [];
  return {
    events,
    async record(input) {
      const record: AdminAuditEventRecord = {
        id: deps.generateId(),
        actorAdminId: input.actorAdminId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        requestCorrelationId: input.requestCorrelationId,
        metadata: input.metadata,
        createdAt: input.now,
      };
      events.push(record);
      return record;
    },
    async listForTarget(targetType, targetId, limit) {
      return events
        .filter((e) => e.targetType === targetType && e.targetId === targetId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },
  };
}

/** Thin, named wrapper over repo.record - exists so every call site reads as an explicit audit action rather than a bare repository call. */
export async function recordAuditEvent(repo: AdminAuditRepository, input: RecordAuditEventInput): Promise<AdminAuditEventRecord> {
  return repo.record(input);
}
