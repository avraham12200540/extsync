"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, AlertTriangle, Radio } from "lucide-react";
import { DashHeader } from "@/components/dashboard";
import { useLocale } from "@/components/locale-context";
import { useAuth } from "@/components/providers";
import { api, type ModerationCounts, type ModerationQueueItem } from "@/lib/api";
import { Badge, Card, Spinner } from "@/components/ui";

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

type TabKey = "new" | "update" | "legacy" | "changes" | "rejected" | "approved";

const TABS: { key: TabKey; label: string; state: string; liveOnly?: boolean }[] = [
  { key: "new", label: "mod.tab.new", state: "pending" },
  { key: "update", label: "mod.tab.update", state: "pending" },
  { key: "legacy", label: "mod.tab.legacy", state: "legacy_pending", liveOnly: true },
  { key: "changes", label: "mod.tab.changes", state: "changes_requested" },
  { key: "rejected", label: "mod.tab.rejected", state: "rejected" },
  { key: "approved", label: "mod.tab.approved", state: "approved" },
];

function countFor(counts: ModerationCounts | undefined, key: TabKey): number {
  if (!counts) return 0;
  switch (key) {
    case "new": return counts.pendingNew;
    case "update": return counts.pendingUpdate;
    case "legacy": return counts.legacyLive;
    case "changes": return counts.changesRequested;
    case "rejected": return counts.rejected;
    case "approved": return counts.approved;
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

  const { data: items, isLoading } = useQuery({
    queryKey: ["moderation-queue", active.state, liveOnly],
    queryFn: () =>
      api.get<ModerationQueueItem[]>(
        `/admin/moderation/queue?state=${active.state}&liveOnly=${liveOnly ? "true" : "false"}&limit=500`,
      ),
    enabled: user?.role === "platform_admin",
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

      {isLoading && <Spinner />}

      {!isLoading && shown.length === 0 && (
        <Card><p className="text-sm text-ink-muted">{t("mod.empty")}</p></Card>
      )}

      <div className="space-y-3">
        {shown.map((i) => (
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
