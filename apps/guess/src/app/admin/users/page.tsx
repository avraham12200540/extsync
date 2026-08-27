"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AdminForumUserView } from "@/admin/view-models";
import { listForumUsers } from "@/lib/admin-client";
import type { ForumUsersListParams } from "@/lib/admin-client";
import { PaginationControls, SortableColumnHeader } from "@/components/admin/list-controls";
import { useTranslation } from "@/lib/use-translation";

const PAGE_SIZE = 25;

const ACCOUNT_STATUSES = ["unknown", "active", "deleted", "banned"] as const;
const OVERRIDES = ["none", "force_eligible", "force_ineligible"] as const;

type SortField = NonNullable<ForumUsersListParams["sortField"]>;

function statusKey(status: string): string {
  switch (status) {
    case "active":
      return "admin.users.statusActive";
    case "deleted":
      return "admin.users.statusDeleted";
    case "banned":
      return "admin.users.statusBanned";
    default:
      return "admin.users.statusUnknown";
  }
}

function overrideKey(override: string): string {
  switch (override) {
    case "force_eligible":
      return "admin.users.overrideForceEligible";
    case "force_ineligible":
      return "admin.users.overrideForceIneligible";
    default:
      return "admin.users.overrideNone";
  }
}

export default function AdminUsersPage() {
  const t = useTranslation();
  const [items, setItems] = useState<AdminForumUserView[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [accountStatus, setAccountStatus] = useState<string>("");
  const [adminOverride, setAdminOverride] = useState<string>("");
  const [effectiveEligibleOnly, setEffectiveEligibleOnly] = useState(false);
  const [usernameContains, setUsernameContains] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorKey(null);
    try {
      const result = await listForumUsers({
        page,
        pageSize: PAGE_SIZE,
        sortField,
        sortDirection,
        accountStatus: accountStatus ? (accountStatus as ForumUsersListParams["accountStatus"]) : undefined,
        adminOverride: adminOverride ? (adminOverride as ForumUsersListParams["adminOverride"]) : undefined,
        effectiveEligibleOnly: effectiveEligibleOnly || undefined,
        usernameContains: usernameContains || undefined,
      });
      setItems(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setErrorKey("state.genericError");
    } finally {
      setLoading(false);
    }
  }, [page, sortField, sortDirection, accountStatus, adminOverride, effectiveEligibleOnly, usernameContains]);

  useEffect(() => {
    void load();
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
      <h1 className="text-xl font-semibold text-ink">{t("admin.users.title")}</h1>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="users-search" className="text-xs text-ink-muted">
            {t("admin.users.searchPlaceholder")}
          </label>
          <input
            id="users-search"
            type="text"
            dir="auto"
            value={usernameContains}
            onChange={(event) => {
              setUsernameContains(event.target.value);
              setPage(1);
            }}
            className="rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none focus-visible:border-accent"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="users-filter-status" className="text-xs text-ink-muted">
            {t("admin.users.filterAccountStatus")}
          </label>
          <select
            id="users-filter-status"
            value={accountStatus}
            onChange={(event) => {
              setAccountStatus(event.target.value);
              setPage(1);
            }}
            className="rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none focus-visible:border-accent"
          >
            <option value="">{t("admin.users.filterAll")}</option>
            {ACCOUNT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(statusKey(status))}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="users-filter-override" className="text-xs text-ink-muted">
            {t("admin.users.filterOverride")}
          </label>
          <select
            id="users-filter-override"
            value={adminOverride}
            onChange={(event) => {
              setAdminOverride(event.target.value);
              setPage(1);
            }}
            className="rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none focus-visible:border-accent"
          >
            <option value="">{t("admin.users.filterAll")}</option>
            {OVERRIDES.map((override) => (
              <option key={override} value={override}>
                {t(overrideKey(override))}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 pb-1.5 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={effectiveEligibleOnly}
            onChange={(event) => {
              setEffectiveEligibleOnly(event.target.checked);
              setPage(1);
            }}
          />
          {t("admin.users.filterEligibleOnly")}
        </label>
      </div>

      {errorKey && (
        <p role="alert" className="text-sm text-ink-muted">
          {t(errorKey)}
        </p>
      )}

      {!loading && items.length === 0 && !errorKey && <p className="text-sm text-ink-muted">{t("admin.users.empty")}</p>}

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="hidden w-full border-collapse text-sm sm:table">
            <thead>
              <tr className="border-b border-line">
                <SortableColumnHeader label={t("admin.users.columnUsername")} active={sortField === "forumUsername"} direction={sortDirection} onClick={() => toggleSort("forumUsername")} />
                <th scope="col" className="px-3 py-2 text-start font-medium text-ink-muted">
                  {t("admin.users.columnStatus")}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium text-ink-muted">
                  {t("admin.users.columnOverride")}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium text-ink-muted">
                  {t("admin.users.columnEligible")}
                </th>
                <SortableColumnHeader
                  label={t("admin.users.columnPosts")}
                  active={sortField === "approvedPostCount"}
                  direction={sortDirection}
                  onClick={() => toggleSort("approvedPostCount")}
                />
                <SortableColumnHeader label={t("admin.users.columnUpdated")} active={sortField === "updatedAt"} direction={sortDirection} onClick={() => toggleSort("updatedAt")} />
              </tr>
            </thead>
            <tbody>
              {items.map((user) => (
                <tr key={user.id} className="border-b border-line">
                  <td className="px-3 py-2">
                    <Link href={`/admin/users/${encodeURIComponent(user.id)}`} dir="auto" className="text-ink underline decoration-line underline-offset-4 hover:text-accent">
                      {user.forumUsername}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{t(statusKey(user.accountStatus))}</td>
                  <td className="px-3 py-2 text-ink-muted">{t(overrideKey(user.adminOverride))}</td>
                  <td className="px-3 py-2 text-ink-muted">{user.effectiveEligible ? t("admin.users.eligibleYes") : t("admin.users.eligibleNo")}</td>
                  <td className="px-3 py-2 text-ink-muted">{user.approvedPostCount}</td>
                  <td className="px-3 py-2 text-ink-muted">{new Date(user.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="flex flex-col gap-3 sm:hidden">
            {items.map((user) => (
              <li key={user.id} className="border-b border-line pb-3">
                <Link href={`/admin/users/${encodeURIComponent(user.id)}`} dir="auto" className="block text-sm font-medium text-ink underline decoration-line underline-offset-4">
                  {user.forumUsername}
                </Link>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-muted">
                  <dt>{t("admin.users.columnStatus")}</dt>
                  <dd>{t(statusKey(user.accountStatus))}</dd>
                  <dt>{t("admin.users.columnOverride")}</dt>
                  <dd>{t(overrideKey(user.adminOverride))}</dd>
                  <dt>{t("admin.users.columnEligible")}</dt>
                  <dd>{user.effectiveEligible ? t("admin.users.eligibleYes") : t("admin.users.eligibleNo")}</dd>
                  <dt>{t("admin.users.columnPosts")}</dt>
                  <dd>{user.approvedPostCount}</dd>
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
