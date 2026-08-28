"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminForumUserDetailView } from "@/admin/view-models";
import { AdminApiError, getForumUserDetail, setForumUserOverride } from "@/lib/admin-client";
import type { EligibilityOverride } from "@/lib/admin-client";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { useTranslation } from "@/lib/use-translation";

const OVERRIDES: EligibilityOverride[] = ["none", "force_eligible", "force_ineligible"];

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

export default function AdminUserDetailPage() {
  const t = useTranslation();
  const params = useParams<{ forumUserId: string }>();
  const forumUserId = params.forumUserId;
  const { withReauth } = useAdminAuth();

  const [user, setUser] = useState<AdminForumUserDetailView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pendingOverride, setPendingOverride] = useState<EligibilityOverride | null>(null);
  const [applying, setApplying] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await getForumUserDetail(forumUserId);
      setUser(detail);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 404) setNotFound(true);
    }
  }, [forumUserId]);

  // The ref indirection (rather than calling load directly) keeps the fetch
  // effect's own body free of a direct setState call, matching
  // react-hooks/set-state-in-effect while still re-running exactly when
  // load's own dependency (forumUserId) changes - the same behavior [load]
  // gave.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    void loadRef.current();
  }, [forumUserId]);

  async function applyOverride() {
    if (!pendingOverride) return;
    setApplying(true);
    try {
      const updated = await withReauth(() => setForumUserOverride(forumUserId, pendingOverride));
      setUser(updated);
      setSuccessMessage(t("admin.users.overrideSuccess"));
      setPendingOverride(null);
    } finally {
      setApplying(false);
    }
  }

  if (notFound) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">{t("admin.users.notFound")}</p>
        <Link href="/admin/users" className="text-sm text-ink underline decoration-line underline-offset-4 hover:text-accent">
          {t("admin.users.backToList")}
        </Link>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link href="/admin/users" className="text-sm text-ink-muted underline decoration-line underline-offset-4 hover:text-ink">
          {t("admin.users.backToList")}
        </Link>
        <h1 dir="auto" className="mt-2 text-xl font-semibold text-ink">
          {user.forumUsername}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t("admin.users.postsSummary", { approved: user.approvedPostCount, total: user.totalPostCount })}</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4 text-sm">
        <dt className="text-ink-muted">{t("admin.users.columnStatus")}</dt>
        <dd className="text-ink">{t(statusKey(user.accountStatus))}</dd>
        <dt className="text-ink-muted">{t("admin.users.columnEligible")}</dt>
        <dd className="text-ink">{user.effectiveEligible ? t("admin.users.eligibleYes") : t("admin.users.eligibleNo")}</dd>
        <dt className="text-ink-muted">{t("admin.users.columnOverride")}</dt>
        <dd className="text-ink">{t(overrideKey(user.adminOverride))}</dd>
      </dl>

      <section className="border-t border-line pt-4">
        <h2 className="text-sm font-medium text-ink">{t("admin.users.effectiveReasons")}</h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-muted">
          {user.effectiveReasons.map((reason) => (
            <li key={reason.code}>{reason.reason}</li>
          ))}
        </ul>
      </section>

      <section className="border-t border-line pt-4">
        <h2 className="text-sm font-medium text-ink">{t("admin.users.computedReasons")}</h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-muted">
          {user.computedReasons.map((reason) => (
            <li key={reason.code}>{reason.reason}</li>
          ))}
        </ul>
      </section>

      <section className="border-t border-line pt-4">
        <h2 className="text-sm font-medium text-ink">{t("admin.users.overrideSectionTitle")}</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {OVERRIDES.map((override) => (
            <button
              key={override}
              type="button"
              disabled={override === user.adminOverride}
              onClick={() => setPendingOverride(override)}
              className={`rounded border px-3 py-1.5 text-sm transition-colors disabled:cursor-default disabled:opacity-50 ${
                override === user.adminOverride ? "border-line bg-line/40 text-ink" : "border-line text-ink-muted hover:text-ink"
              }`}
            >
              {t(overrideKey(override))}
            </button>
          ))}
        </div>
        <p role="status" className="mt-2 min-h-[1em] text-sm text-ink-muted">
          {successMessage}
        </p>
      </section>

      <ConfirmDialog
        open={pendingOverride !== null}
        title={t("admin.users.overrideConfirmTitle")}
        body={pendingOverride ? t("admin.users.overrideConfirmBody", { username: user.forumUsername, value: t(overrideKey(pendingOverride)) }) : ""}
        confirmLabel={t("admin.confirm.confirm")}
        pending={applying}
        tone={pendingOverride === "force_ineligible" ? "danger" : "neutral"}
        onConfirm={() => void applyOverride()}
        onCancel={() => setPendingOverride(null)}
      />
    </div>
  );
}
