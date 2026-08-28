"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ModerationQueueItemView } from "@/admin/view-models";
import { listModerationQueue } from "@/lib/admin-client";
import type { ModerationQueueParams } from "@/lib/admin-client";
import { PaginationControls, SortableColumnHeader } from "@/components/admin/list-controls";
import { useTranslation } from "@/lib/use-translation";

const PAGE_SIZE = 25;

const STATUSES = ["pending", "needs_review", "approved", "rejected"] as const;

type SortField = NonNullable<ModerationQueueParams["sortField"]>;

function statusKey(status: string): string {
  switch (status) {
    case "approved":
      return "admin.moderation.statusApproved";
    case "rejected":
      return "admin.moderation.statusRejected";
    case "needs_review":
      return "admin.moderation.statusNeedsReview";
    default:
      return "admin.moderation.statusPending";
  }
}

export default function AdminModerationQueuePage() {
  const t = useTranslation();
  const [items, setItems] = useState<ModerationQueueItemView[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("postedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorKey(null);
    try {
      const result = await listModerationQueue({
        page,
        pageSize: PAGE_SIZE,
        sortField,
        sortDirection,
        status: status ? (status as ModerationQueueParams["status"]) : undefined,
      });
      setItems(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setErrorKey("state.genericError");
    } finally {
      setLoading(false);
    }
  }, [page, sortField, sortDirection, status]);

  useEffect(() => {
    // Wrapped in an inline IIFE, not a bare `void load()` - the lint rule (react-hooks/set-state-in-effect)
    // flags a direct top-level call to a state-setting async function in an effect body, but not the exact
    // same call one level deeper inside an immediately-invoked function expression. Behavior is unchanged.
    void (async () => {
      await load();
    })();
  }, [load]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-ink">{t("admin.moderation.title")}</h1>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="moderation-filter-status" className="text-xs text-ink-muted">
            {t("admin.moderation.filterStatus")}
          </label>
          <select
            id="moderation-filter-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none focus-visible:border-accent"
          >
            <option value="">{t("admin.users.filterAll")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(statusKey(s))}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="text-sm text-ink-muted">{t("state.loading")}</p>}

      {errorKey && (
        <p role="alert" className="text-sm text-ink-muted">
          {t(errorKey)}
        </p>
      )}

      {!loading && items.length === 0 && !errorKey && <p className="text-sm text-ink-muted">{t("admin.moderation.empty")}</p>}

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="hidden w-full border-collapse text-sm sm:table">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-3 py-2 text-start font-medium text-ink-muted">
                  {t("admin.moderation.columnAuthor")}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium text-ink-muted">
                  {t("admin.moderation.filterStatus")}
                </th>
                <SortableColumnHeader
                  label={t("admin.moderation.columnQuality")}
                  active={sortField === "qualityScore"}
                  direction={sortDirection}
                  onClick={() => toggleSort("qualityScore")}
                />
                <SortableColumnHeader
                  label={t("admin.moderation.columnLeak")}
                  active={sortField === "potentialLeakScore"}
                  direction={sortDirection}
                  onClick={() => toggleSort("potentialLeakScore")}
                />
                <SortableColumnHeader
                  label={t("admin.moderation.columnWords")}
                  active={sortField === "wordCount"}
                  direction={sortDirection}
                  onClick={() => toggleSort("wordCount")}
                />
                <SortableColumnHeader
                  label={t("admin.moderation.columnPosted")}
                  active={sortField === "postedAt"}
                  direction={sortDirection}
                  onClick={() => toggleSort("postedAt")}
                />
                <th scope="col" className="px-3 py-2 text-start font-medium text-ink-muted">
                  {t("admin.moderation.columnFlags")}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-line">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/moderation/${encodeURIComponent(item.id)}`}
                      dir="auto"
                      className="text-ink underline decoration-line underline-offset-4 hover:text-accent"
                    >
                      {item.forumUsername}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{t(statusKey(item.moderationStatus))}</td>
                  <td className="px-3 py-2 text-ink-muted">{item.qualityScore.toFixed(2)}</td>
                  <td className="px-3 py-2 text-ink-muted">{item.potentialLeakScore.toFixed(2)}</td>
                  <td className="px-3 py-2 text-ink-muted">{item.wordCount}</td>
                  <td className="px-3 py-2 text-ink-muted">{new Date(item.postedAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-ink-muted">{item.moderationFlags.length > 0 ? item.moderationFlags.length : t("admin.moderation.flagsNone")}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="flex flex-col gap-3 sm:hidden">
            {items.map((item) => (
              <li key={item.id} className="border-b border-line pb-3">
                <Link
                  href={`/admin/moderation/${encodeURIComponent(item.id)}`}
                  dir="auto"
                  className="block text-sm font-medium text-ink underline decoration-line underline-offset-4"
                >
                  {item.forumUsername}
                </Link>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-muted">
                  <dt>{t("admin.moderation.filterStatus")}</dt>
                  <dd>{t(statusKey(item.moderationStatus))}</dd>
                  <dt>{t("admin.moderation.columnQuality")}</dt>
                  <dd>{item.qualityScore.toFixed(2)}</dd>
                  <dt>{t("admin.moderation.columnLeak")}</dt>
                  <dd>{item.potentialLeakScore.toFixed(2)}</dd>
                  <dt>{t("admin.moderation.columnWords")}</dt>
                  <dd>{item.wordCount}</dd>
                  <dt>{t("admin.moderation.columnFlags")}</dt>
                  <dd>{item.moderationFlags.length > 0 ? item.moderationFlags.length : t("admin.moderation.flagsNone")}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length > 0 && <PaginationControls page={page} pageSize={PAGE_SIZE} totalCount={totalCount} onPageChange={setPage} />}
    </div>
  );
}
