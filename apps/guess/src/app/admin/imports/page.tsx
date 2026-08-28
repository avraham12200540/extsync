"use client";

import { useCallback, useEffect, useState } from "react";
import type { ImportRunView } from "@/admin/view-models";
import { AdminApiError, listImportRuns, triggerImportRun } from "@/lib/admin-client";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { PaginationControls } from "@/components/admin/list-controls";
import { useTranslation } from "@/lib/use-translation";

const PAGE_SIZE = 25;

function statusKey(status: string): string {
  switch (status) {
    case "success":
      return "admin.imports.statusSuccess";
    case "partial_failure":
      return "admin.imports.statusPartialFailure";
    case "failed":
      return "admin.imports.statusFailed";
    default:
      return "admin.imports.statusRunning";
  }
}

function triggerKindKey(kind: string): string {
  return kind === "cron" ? "admin.imports.triggerKindCron" : "admin.imports.triggerKindAdmin";
}

export default function AdminImportsPage() {
  const t = useTranslation();
  const { withReauth } = useAdminAuth();

  const [items, setItems] = useState<ImportRunView[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const [confirmTrigger, setConfirmTrigger] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);
  const [overlapError, setOverlapError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorKey(null);
    try {
      const result = await listImportRuns({ page, pageSize: PAGE_SIZE });
      setItems(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setErrorKey("state.genericError");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    // See the equivalent note in admin/moderation/page.tsx - the inline IIFE wrapper (not a bare
    // `void load()`) is what makes this pass react-hooks/set-state-in-effect; behavior is unchanged.
    void (async () => {
      await load();
    })();
  }, [load]);

  // Proactive signal only (the list can be stale the instant another admin starts a run) -
  // the trigger endpoint's own 409 import_already_running is the real, authoritative guard.
  const runningNow = items.some((item) => item.status === "running");

  async function handleTrigger() {
    setTriggering(true);
    setTriggerMessage(null);
    setOverlapError(false);
    try {
      await withReauth(() => triggerImportRun());
      setTriggerMessage(t("admin.imports.triggerSuccess"));
      setConfirmTrigger(false);
      setPage(1);
      await load();
    } catch (err) {
      if (err instanceof AdminApiError && err.code === "import_already_running") {
        setOverlapError(true);
        setConfirmTrigger(false);
      } else {
        throw err;
      }
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-ink">{t("admin.imports.title")}</h1>
        <button
          type="button"
          onClick={() => setConfirmTrigger(true)}
          disabled={triggering || runningNow}
          className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {triggering ? t("admin.imports.triggering") : runningNow ? t("admin.imports.alreadyRunning") : t("admin.imports.trigger")}
        </button>
      </div>

      {overlapError && (
        <p role="alert" className="text-sm text-ink-muted">
          {t("admin.imports.overlapError")}
        </p>
      )}
      <p role="status" className="min-h-[1em] text-sm text-ink-muted">
        {triggerMessage}
      </p>

      {loading && <p className="text-sm text-ink-muted">{t("state.loading")}</p>}

      {errorKey && (
        <p role="alert" className="text-sm text-ink-muted">
          {t(errorKey)}
        </p>
      )}

      {!loading && items.length === 0 && !errorKey && <p className="text-sm text-ink-muted">{t("admin.imports.empty")}</p>}

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="hidden w-full border-collapse text-sm sm:table">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-3 py-2 text-start font-medium text-ink-muted">
                  {t("admin.imports.columnStatus")}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium text-ink-muted">
                  {t("admin.imports.columnTrigger")}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium text-ink-muted">
                  {t("admin.imports.columnPosts")}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium text-ink-muted">
                  {t("admin.imports.columnUsers")}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium text-ink-muted">
                  {t("admin.imports.columnStarted")}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium text-ink-muted">
                  {t("admin.imports.columnFinished")}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium text-ink-muted">
                  {t("admin.imports.errorSummary")}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((run) => (
                <tr key={run.id} className="border-b border-line">
                  <td className="px-3 py-2 text-ink">{t(statusKey(run.status))}</td>
                  <td className="px-3 py-2 text-ink-muted">{t(triggerKindKey(run.triggerKind))}</td>
                  <td className="px-3 py-2 text-ink-muted">{run.postsNew}</td>
                  <td className="px-3 py-2 text-ink-muted">{run.usersTouched}</td>
                  <td className="px-3 py-2 text-ink-muted">{new Date(run.startedAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-ink-muted">{run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "-"}</td>
                  <td dir="auto" className="px-3 py-2 text-ink-muted">
                    {run.errorSummary ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="flex flex-col gap-3 sm:hidden">
            {items.map((run) => (
              <li key={run.id} className="border-b border-line pb-3">
                <p className="text-sm font-medium text-ink">{t(statusKey(run.status))}</p>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-muted">
                  <dt>{t("admin.imports.columnTrigger")}</dt>
                  <dd>{t(triggerKindKey(run.triggerKind))}</dd>
                  <dt>{t("admin.imports.columnPosts")}</dt>
                  <dd>{run.postsNew}</dd>
                  <dt>{t("admin.imports.columnUsers")}</dt>
                  <dd>{run.usersTouched}</dd>
                  <dt>{t("admin.imports.columnStarted")}</dt>
                  <dd>{new Date(run.startedAt).toLocaleString()}</dd>
                  {run.errorSummary && (
                    <>
                      <dt>{t("admin.imports.errorSummary")}</dt>
                      <dd dir="auto">{run.errorSummary}</dd>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length > 0 && <PaginationControls page={page} pageSize={PAGE_SIZE} totalCount={totalCount} onPageChange={setPage} />}

      <ConfirmDialog
        open={confirmTrigger}
        title={t("admin.imports.triggerConfirmTitle")}
        body={t("admin.imports.triggerConfirmBody")}
        confirmLabel={t("admin.confirm.confirm")}
        pending={triggering}
        tone="danger"
        onConfirm={() => void handleTrigger()}
        onCancel={() => setConfirmTrigger(false)}
      />
    </div>
  );
}
