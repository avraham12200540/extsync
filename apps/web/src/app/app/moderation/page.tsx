"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert, AlertTriangle, Radio, Power } from "lucide-react";
import { DashHeader } from "@/components/dashboard";
import { useLocale } from "@/components/locale-context";
import { useAuth } from "@/components/providers";
import {
  api,
  type ListingQueueItem,
  type ModerationCounts,
  type ModerationAuditEntry,
  type ModerationQueueItem,
  type SafeModeStatus,
} from "@/lib/api";
import { Badge, Button, Card, Spinner } from "@/components/ui";

/**
 * Store moderation queue - platform administrators only.
 *
 * The server enforces that (every endpoint requires platform_admin); this page
 * only avoids rendering a broken screen for anyone else.
 *
 * The tabs exist because the queues are genuinely different jobs. A brand new
 * extension needs a full read. An update to something already in the store needs
 * a diff-shaped look. And "legacy" is the one-off backlog of extensions that were
 * already live when moderation was introduced - scoped, deliberately, to the ones
 * actually serving users right now rather than every historical row.
 */

type TabKey =
  | "new" | "update" | "legacy" | "listings"
  | "changes" | "rejected" | "approved" | "audit";

const TABS: { key: TabKey; label: string; state: string; liveOnly?: boolean }[] = [
  { key: "new", label: "mod.tab.new", state: "pending" },
  { key: "update", label: "mod.tab.update", state: "pending" },
  { key: "legacy", label: "mod.tab.legacy", state: "legacy_pending", liveOnly: true },
  { key: "listings", label: "mod.tab.listings", state: "" },
  { key: "changes", label: "mod.tab.changes", state: "changes_requested" },
  { key: "rejected", label: "mod.tab.rejected", state: "rejected" },
  { key: "approved", label: "mod.tab.approved", state: "approved" },
  { key: "audit", label: "mod.tab.audit", state: "" },
];

function countFor(counts: ModerationCounts | undefined, key: TabKey): number {
  if (!counts) return 0;
  switch (key) {
    case "new": return counts.pendingNew;
    case "update": return counts.pendingUpdate;
    case "legacy": return counts.legacyLive;
    case "listings": return counts.listingPending;
    case "changes": return counts.changesRequested;
    case "rejected": return counts.rejected;
    case "approved": return counts.approved;
    case "audit": return 0;
  }
}

export default function ModerationPage() {
  const { t, locale } = useLocale();
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>("new");
  // The legacy queue defaults to what is actually serving users. The rest of the
  // backfilled rows - superseded versions, validation failures, never-published
  // uploads - are real data and stay reachable, just not as the default workload.
  const [legacyAll, setLegacyAll] = useState(false);
  const active = TABS.find((x) => x.key === tab)!;
  const liveOnly = (active.liveOnly ?? false) && !legacyAll;

  const { data: counts } = useQuery({
    queryKey: ["moderation-counts"],
    queryFn: () => api.get<ModerationCounts>("/admin/moderation/counts"),
    enabled: user?.role === "platform_admin",
  });

  const qc = useQueryClient();
  const [safeReason, setSafeReason] = useState("");

  const { data: safeMode } = useQuery({
    queryKey: ["moderation-safe-mode"],
    queryFn: () => api.get<SafeModeStatus>("/admin/moderation/safe-mode"),
    enabled: user?.role === "platform_admin",
  });

  const toggleSafeMode = useMutation({
    mutationFn: (enabled: boolean) =>
      api.post("/admin/moderation/safe-mode", {
        enabled,
        reason: safeReason.trim() || undefined,
      }),
    onSuccess: () => {
      setSafeReason("");
      qc.invalidateQueries({ queryKey: ["moderation-safe-mode"] });
    },
  });

  const { data: audit, isLoading: auditLoading } = useQuery({
    queryKey: ["moderation-audit"],
    queryFn: () => api.get<ModerationAuditEntry[]>("/admin/moderation/audit?limit=200"),
    enabled: user?.role === "platform_admin" && tab === "audit",
  });

  const { data: listings, isLoading: listingsLoading } = useQuery({
    queryKey: ["moderation-listings"],
    queryFn: () => api.get<ListingQueueItem[]>("/admin/moderation/listings"),
    enabled: user?.role === "platform_admin" && tab === "listings",
  });

  const { data: items, isLoading } = useQuery({
    queryKey: ["moderation-queue", active.state, liveOnly],
    queryFn: () =>
      api.get<ModerationQueueItem[]>(
        `/admin/moderation/queue?state=${active.state}&liveOnly=${liveOnly ? "true" : "false"}&limit=500`,
      ),
    enabled: user?.role === "platform_admin" && tab !== "listings" && tab !== "audit",
  });

  const fmt = useMemo(() => {
    const df = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", {
      dateStyle: "medium", timeStyle: "short",
    });
    return (iso?: string | null) => {
      if (!iso) return "";
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? "" : df.format(d);
    };
  }, [locale]);

  // "pending" is one server state covering two very different review jobs, so
  // the split happens here rather than adding a second server-side filter.
  const shown = useMemo(() => {
    const list = items ?? [];
    if (tab === "new") return list.filter((i) => i.isNewExtension);
    if (tab === "update") return list.filter((i) => !i.isNewExtension);
    return list;
  }, [items, tab]);

  if (user && user.role !== "platform_admin") {
    return <p className="text-sm text-ink-muted">{t("mod.denied")}</p>;
  }

  return (
    <>
      <DashHeader
        icon={<ShieldCheck className="h-5 w-5" />}
        title={t("mod.title")}
        subtitle={t("mod.subtitle")}
      />

      {/* Emergency control. Prominent when ON, because someone arriving at
          this screen mid-incident must not have to wonder whether it is set. */}
      <Card className={`mb-5 ${safeMode?.enabled ? "border-danger/50 bg-danger/5" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Power className={`h-4 w-4 ${safeMode?.enabled ? "text-danger" : "text-ink-muted"}`} />
              {t("mod.safe.title")}
              {safeMode?.enabled && <Badge status="rejected">{t("mod.safe.on")}</Badge>}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {safeMode?.enabled ? t("mod.safe.on.body") : t("mod.safe.off.body")}
            </p>
            {/* Never let anyone believe this removed the files. */}
            <p className="mt-1 text-xs text-ink-muted">{t("mod.safe.caveat")}</p>
            {safeMode?.enabled && safeMode.reason && (
              <p className="mt-1 text-xs text-ink">
                {t("mod.safe.reason")} {safeMode.reason}
              </p>
            )}
            {safeMode?.updatedByEmail && (
              <p className="mt-1 text-xs text-ink-muted" dir="ltr">
                {safeMode.updatedByEmail} {fmt(safeMode.updatedAt)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <input
              value={safeReason}
              onChange={(e) => setSafeReason(e.target.value)}
              maxLength={1000}
              placeholder={t("mod.safe.reason.ph")}
              className="w-56 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:border-brand outline-none"
            />
            <Button
              variant={safeMode?.enabled ? "secondary" : "danger"}
              size="sm"
              disabled={toggleSafeMode.isPending}
              onClick={() => {
                const next = !safeMode?.enabled;
                if (!confirm(t(next ? "mod.safe.confirm.on" : "mod.safe.confirm.off"))) return;
                toggleSafeMode.mutate(next);
              }}
            >
              {safeMode?.enabled ? t("mod.safe.reopen") : t("mod.safe.close")}
            </Button>
          </div>
        </div>
      </Card>

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((x) => {
          const n = countFor(counts, x.key);
          const on = x.key === tab;
          return (
            <button
              key={x.key}
              onClick={() => setTab(x.key)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                on
                  ? "bg-brand-gradient text-white shadow-glow"
                  : "border border-line bg-surface text-ink-muted hover:text-ink"
              }`}
            >
              {t(x.label)}
              {n > 0 && (
                <span
                  dir="ltr"
                  className={`ms-2 rounded-full px-1.5 py-0.5 text-xs ${
                    on ? "bg-white/20" : "bg-surface-2 text-ink"
                  }`}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "legacy" && (
        <label className="mb-4 flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={legacyAll}
            onChange={(e) => setLegacyAll(e.target.checked)}
            className="h-4 w-4 rounded border-line"
          />
          {t("mod.legacy.showall")}
        </label>
      )}

      {tab === "audit" && (
        <>
          {auditLoading && <Spinner />}
          {!auditLoading && (audit ?? []).length === 0 && (
            <Card><p className="text-sm text-ink-muted">{t("mod.empty")}</p></Card>
          )}
          <div className="space-y-2">
            {(audit ?? []).map((e) => (
              <Card key={e.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      <span className="font-medium">{t(`mod.audit.${e.action}`)}</span>
                      {e.projectName && <span className="text-ink-muted"> - {e.projectName}</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {e.adminEmail && <span dir="ltr">{e.adminEmail}</span>}
                      {e.adminEmail && " \u00b7 "}
                      {fmt(e.at)}
                      {typeof e.extra?.version === "string" && (
                        <span dir="ltr"> \u00b7 v{e.extra.version}</span>
                      )}
                    </p>
                    {typeof e.extra?.reason === "string" && e.extra.reason && (
                      <p className="mt-1 text-xs text-ink">{e.extra.reason}</p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {tab !== "audit" && (tab === "listings" ? listingsLoading : isLoading) && <Spinner />}

      {tab === "listings" && !listingsLoading && (listings ?? []).length === 0 && (
        <Card><p className="text-sm text-ink-muted">{t("mod.empty")}</p></Card>
      )}

      {tab === "listings" && (
        <div className="space-y-3">
          {(listings ?? []).map((l) => (
            <Link key={l.projectId} href={`/app/moderation/listing/${l.projectId}`} className="block">
              <Card className="lift">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{l.projectName}</span>
                      <Badge status={l.listingReviewStatus}>
                        {t(`dash.pd.rv.${l.listingReviewStatus}`)}
                      </Badge>
                      {l.changedFields.map((f) => (
                        <Badge key={f} status="pending">{t(`mod.lf.${f}`)}</Badge>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {l.developerEmail && <span dir="ltr">{l.developerEmail}</span>}
                      {l.developerEmail && " \u00b7 "}
                      {fmt(l.updatedAt)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-brand">{t("mod.review")}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {tab !== "listings" && tab !== "audit" && !isLoading && shown.length === 0 && (
        <Card><p className="text-sm text-ink-muted">{t("mod.empty")}</p></Card>
      )}

      <div className="space-y-3">
        {(tab === "listings" || tab === "audit" ? [] : shown).map((i) => (
          <Link key={i.releaseId} href={`/app/moderation/${i.releaseId}`} className="block">
            <Card className="lift">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{i.projectName}</span>
                    <span className="text-sm text-ink-muted" dir="ltr">v{i.version}</span>
                    <Badge>{i.channel}</Badge>
                    <Badge status={i.reviewStatus}>{t(`dash.pd.rv.${i.reviewStatus}`)}</Badge>
                    {i.isLive && (
                      <Badge status="published">
                        <Radio className="me-1 h-3 w-3" />
                        {t("mod.live")}
                      </Badge>
                    )}
                    {i.permissionsChanged && (
                      <Badge status="paused">{t("dash.pd.permschanged")}</Badge>
                    )}
                    {/* The bypass scan is the signal that matters most here, so
                        it is visible before opening the release. */}
                    {i.riskLevel !== "none" && i.riskLevel !== "info" && (
                      <Badge status={i.riskLevel === "critical" ? "rejected"
                        : i.riskLevel === "high" ? "changes_requested" : "pending"}>
                        <ShieldAlert className="me-1 h-3 w-3" />
                        {t(`mod.risk.${i.riskLevel}`)}
                      </Badge>
                    )}
                    {i.riskScore >= 30 && (
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                        i.riskScore >= 60 ? "text-danger" : "text-warning"
                      }`}>
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {t("dash.pd.risk")} <span dir="ltr">{i.riskScore}</span>
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {i.developerEmail && <span dir="ltr">{i.developerEmail}</span>}
                    {i.developerEmail && " · "}
                    {fmt(i.createdAt)}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium text-brand">{t("mod.review")}</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
