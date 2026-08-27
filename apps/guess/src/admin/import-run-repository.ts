import { ADMIN_PAGE_SIZE_MAX } from "./config";

export class ImportRunNotFoundError extends Error {}

/** Admin-facing read access to import_run - the importer's own writes (src/importer/repository.ts) stay separate; this is purely for the admin list/detail views. */

export type ImportRunStatus = "running" | "success" | "partial_failure" | "failed";
export type ImportTriggerKind = "admin" | "cron";

export interface ImportRunSummaryView {
  id: string;
  status: ImportRunStatus;
  triggerKind: ImportTriggerKind;
  triggeredByAdminId: string | null;
  sourceEndpoint: string;
  cursorUsed: string | null;
  postsFetched: number;
  postsNew: number;
  postsUpdated: number;
  usersTouched: number;
  rateLimitEvents: number;
  errorSummary: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface ListImportRunsInput {
  page: number;
  pageSize: number;
}

export interface ListImportRunsResult {
  items: ImportRunSummaryView[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface AdminImportRunRepository {
  list(input: ListImportRunsInput): Promise<ListImportRunsResult>;
  getDetail(importRunId: string): Promise<ImportRunSummaryView | null>;
  /** Observability signal only - NOT the concurrency guard itself (see triggerImportRun's Postgres advisory lock). A row status check alone has a read-then-write race; this exists so admins/tests can directly see "is anything running" without relying on lock internals. */
  hasRunningImport(): Promise<boolean>;
}

export function createInMemoryAdminImportRunRepository(seed: ImportRunSummaryView[] = []): AdminImportRunRepository & { rows: Map<string, ImportRunSummaryView> } {
  const rows = new Map<string, ImportRunSummaryView>();
  for (const row of seed) rows.set(row.id, { ...row });

  return {
    rows,
    async list(input) {
      const pageSize = Math.min(input.pageSize, ADMIN_PAGE_SIZE_MAX);
      const items = [...rows.values()].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      const start = (input.page - 1) * pageSize;
      return { items: items.slice(start, start + pageSize), totalCount: items.length, page: input.page, pageSize };
    },
    async getDetail(importRunId) {
      const row = rows.get(importRunId);
      return row ? { ...row } : null;
    },
    async hasRunningImport() {
      return [...rows.values()].some((r) => r.status === "running");
    },
  };
}
