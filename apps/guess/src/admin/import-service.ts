import type { NodebbClient } from "../importer/nodebb-client";
import type { ForumRepository } from "../importer/repository";
import { DEFAULT_IMPORT_BUDGETS, DEFAULT_PACING_MS, defaultImportRunDeps, runImport } from "../importer/run-import";
import type { ImportRunSummary } from "../importer/run-import";
import type { AdminAuditRepository } from "./audit";
import { recordAuditEvent } from "./audit";
import type { ImportLock } from "./import-lock";

export class ImportAlreadyRunningError extends Error {}

export interface TriggerImportRunDeps {
  forumRepository: ForumRepository;
  nodebbClient: Pick<NodebbClient, "getRecentTopics" | "getTopicDetail">;
  auditRepo: AdminAuditRepository;
  importLock: ImportLock;
}

export interface TriggerImportRunInput {
  adminUserId: string;
  now: Date;
  requestCorrelationId: string;
  /** Test-only overrides - production never supplies these, so runImport uses its real Date.now/setTimeout-based pacing. */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Bounded, admin-triggered import. Budgets/pacing are always the
 * importer's own fixed defaults (DEFAULT_IMPORT_BUDGETS/DEFAULT_PACING_MS)
 * - this function accepts no caller-supplied override for either, so an
 * admin request body can never escalate them (see the Zod schema on the
 * HTTP handler, which only accepts an empty body). Concurrency is guarded
 * by a real lock (see TriggerImportRunDeps.importLock -
 * createDrizzleImportLock in production, an in-memory mutex in tests) -
 * a second trigger while one is already running throws
 * ImportAlreadyRunningError rather than starting a second overlapping run.
 */
export async function triggerImportRun(deps: TriggerImportRunDeps, input: TriggerImportRunInput): Promise<ImportRunSummary> {
  const outcome = await deps.importLock.withLock(() =>
    runImport(
      defaultImportRunDeps({
        client: deps.nodebbClient,
        repository: deps.forumRepository,
        triggerKind: "admin",
        triggeredByAdminId: input.adminUserId,
        budgets: DEFAULT_IMPORT_BUDGETS,
        pacingMs: DEFAULT_PACING_MS,
        ...(input.clock ? { clock: input.clock } : {}),
        ...(input.sleep ? { sleep: input.sleep } : {}),
      }),
    ),
  );

  if (!outcome.acquired) {
    throw new ImportAlreadyRunningError("an import run is already in progress");
  }

  const summary = outcome.result;
  await recordAuditEvent(deps.auditRepo, {
    actorAdminId: input.adminUserId,
    action: "import.trigger",
    targetType: "import_run",
    targetId: summary.importRunId,
    requestCorrelationId: input.requestCorrelationId,
    metadata: {
      status: summary.status,
      stoppedReason: summary.stoppedReason,
      postsFetched: summary.postsFetched,
      postsNew: summary.postsNew,
      errorCount: summary.errors.length,
    },
    now: input.now,
  });

  return summary;
}
