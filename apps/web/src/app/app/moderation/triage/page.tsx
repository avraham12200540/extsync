"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, ShieldAlert, Radio, Globe, Terminal, KeyRound,
  ChevronDown, ChevronRight, FileArchive, HelpCircle,
} from "lucide-react";
import { DashHeader } from "@/components/dashboard";
import { useLocale } from "@/components/locale-context";
import { useAuth } from "@/components/providers";
import { api, ApiError, type TriageProgress, type TriageRow } from "@/lib/api";
import { Badge, Button, Card, Spinner } from "@/components/ui";

/**
 * Rapid legacy review.
 *
 * These extensions are LIVE and nobody has ever reviewed them, so the screen is
 * built for deciding quickly without losing the thread: every row carries the two
 * things that actually discriminate - what the extension can reach, and what it
 * talks to - before anything is expanded.
 *
 * Two honesty rules the design turns on:
 *   * "not scanned" is never rendered like "clean". A legacy report predates the
 *     scanner, so a green tick there would be a lie.
 *   * "live, not reviewed" is never rendered like "approved". Approval is a human
 *     act, and this screen must not let the eye blur the two.
 */

type FilterKey =
  | "all" | "high" | "medium" | "clean" | "native" | "broad" | "external" | "listing";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "triage.f.all" },
  { key: "high", label: "triage.f.high" },
  { key: "medium", label: "triage.f.medium" },
  { key: "clean", label: "triage.f.clean" },
  { key: "native", label: "triage.f.native" },
  { key: "broad", label: "triage.f.broad" },
  { key: "external", label: "triage.f.external" },
  { key: "listing", label: "triage.f.listing" },
];

function matches(row: TriageRow, f: FilterKey): boolean {
  switch (f) {
    case "all": return true;
    case "high": return row.riskLevel === "critical" || row.riskLevel === "high";
    case "medium": return row.riskLevel === "medium";
    // Deliberately excludes not_scanned: an unscanned build is not a clean one.
    case "clean": return row.riskLevel === "none" || row.riskLevel === "info";
    case "native": return row.usesNativeMessaging;
    case "broad": return row.broadHostAccess;
    case "external": return row.endpoints.some((e) => !e.benign);
    case "listing":
      return row.listingReviewStatus === "legacy_pending"
          || row.listingReviewStatus === "pending";
  }
}

function riskTone(level: string): { status: string; key: string } {
  switch (level) {
    case "critical": return { status: "rejected", key: "mod.risk.critical" };
    case "high": return { status: "changes_requested", key: "mod.risk.high" };
    case "medium": return { status: "pending", key: "mod.risk.medium" };
    case "info": return { status: "draft", key: "mod.risk.info" };
    case "none": return { status: "approved", key: "triage.risk.clean" };
    default: return { status: "draft", key: "triage.risk.notscanned" };
  }
}

export default function TriagePage() {
  const { t } = useLocale();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const isAdmin = user?.role === "platform_admin";

  const { data: progress } = useQuery({
    queryKey: ["moderation-progress"],
    queryFn: () => api.get<TriageProgress>("/admin/moderation/progress"),
    enabled: isAdmin,
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["moderation-triage"],
    queryFn: () => api.get<TriageRow[]>("/admin/moderation/triage?liveOnly=true&limit=500"),
    enabled: isAdmin,
  });

  const act = useMutation({
    mutationFn: ({ id, action, why }: { id: string; action: string; why?: string }) =>
      api.post(`/admin/moderation/releases/${id}/${action}`, { reason: why || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moderation-triage"] });
      qc.invalidateQueries({ queryKey: ["moderation-progress"] });
      qc.invalidateQueries({ queryKey: ["moderation-counts"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("mod.act.failed")),
  });

  const run = (row: TriageRow, action: string) => {
    setError(null);
    const why = (reason[row.releaseId] || "").trim();
    if (action !== "approve" && !why) { setError(t("mod.needreason")); return; }
    if (!confirm(t(`mod.confirm.${action}`))) return;
    act.mutate({ id: row.releaseId, action, why });
  };

  const counts = useMemo(() => {
    const list = rows ?? [];
    return Object.fromEntries(
      FILTERS.map((f) => [f.key, list.filter((r) => matches(r, f.key)).length]),
    ) as Record<FilterKey, number>;
  }, [rows]);

  const shown = useMemo(
    () => (rows ?? []).filter((r) => matches(r, filter)),
    [rows, filter],
  );

  if (user && !isAdmin) {
    return <p className="text-sm text-ink-muted">{t("mod.denied")}</p>;
  }

  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

  return (
    <>
      <DashHeader
        icon={<ShieldCheck className="h-5 w-5" />}
        title={t("triage.title")}
        subtitle={t("triage.subtitle")}
      />

      <Link href="/app/moderation" className="mb-4 inline-block text-sm text-ink-muted hover:text-brand">
        {t("mod.back")}
      </Link>

      {/* progress - a human acted, or they did not */}
      {progress && (
        <Card className="mb-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-ink-muted">{t("triage.p.extensions")}</p>
              <p className="mt-0.5 text-lg font-semibold text-ink" dir="ltr">
                {progress.extensionsReviewed} / {progress.extensionsTotal}
              </p>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-surface-2">
                <div className="h-1.5 rounded-full bg-brand-gradient"
                     style={{ width: `${pct(progress.extensionsReviewed, progress.extensionsTotal)}%` }} />
              </div>
            </div>
            <div>
              <p className="text-xs text-ink-muted">{t("triage.p.listings")}</p>
              <p className="mt-0.5 text-lg font-semibold text-ink" dir="ltr">
                {progress.listingsReviewed} / {progress.listingsTotal}
              </p>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-surface-2">
                <div className="h-1.5 rounded-full bg-brand-gradient"
                     style={{ width: `${pct(progress.listingsReviewed, progress.listingsTotal)}%` }} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-ink-muted">{t("triage.p.high")}</p>
              <p className={`text-lg font-semibold ${
                progress.highAttentionRemaining > 0 ? "text-danger" : "text-success"
              }`} dir="ltr">{progress.highAttentionRemaining}</p>
              {progress.notScannedRemaining > 0 && (
                <p className="text-xs text-warning">
                  {progress.notScannedRemaining} {t("triage.p.notscanned")}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* filters */}
      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const on = f.key === filter;
          const n = counts[f.key] ?? 0;
          return (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                on ? "bg-brand-gradient text-white shadow-glow"
                   : "border border-line bg-surface text-ink-muted hover:text-ink"}`}>
              {t(f.label)}
              <span dir="ltr" className={`ms-2 rounded-full px-1.5 py-0.5 text-xs ${
                on ? "bg-white/20" : "bg-surface-2 text-ink"}`}>{n}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-red-50 p-2 text-sm text-danger dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}

      {isLoading && <Spinner />}
      {!isLoading && shown.length === 0 && (
        <Card><p className="text-sm text-ink-muted">{t("mod.empty")}</p></Card>
      )}

      <div className="space-y-3">
        {shown.map((r) => {
          const tone = riskTone(r.riskLevel);
          const expanded = !!open[r.releaseId];
          const externals = r.endpoints.filter((e) => !e.benign);
          const foreignHosts = r.nativeHosts.filter((h) => !h.isExtsyncBridge);
          return (
            <Card key={r.releaseId} className={
              r.riskLevel === "critical" || r.riskLevel === "high"
                ? "border-danger/30" : undefined
            }>
              {/* --- summary line: everything that discriminates --- */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {r.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.iconUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg" />
                  ) : <div className="h-10 w-10 shrink-0 rounded-lg bg-surface-2" />}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{r.projectName}</span>
                      <span className="text-sm text-ink-muted" dir="ltr">v{r.version}</span>
                      {r.isLive && (
                        <Badge status="published"><Radio className="me-1 h-3 w-3" />{t("mod.live")}</Badge>
                      )}
                      {/* never let this read as "approved" */}
                      <Badge status="legacy_pending">{t("triage.unreviewed")}</Badge>
                      <Badge status={tone.status}>
                        {r.riskLevel === "not_scanned"
                          ? <HelpCircle className="me-1 h-3 w-3" />
                          : <ShieldAlert className="me-1 h-3 w-3" />}
                        {t(tone.key)}
                      </Badge>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                      {r.ownerEmail && <span dir="ltr">{r.ownerEmail}</span>}
                      {r.broadHostAccess && (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <KeyRound className="h-3 w-3" />{t("triage.badge.broad")}
                        </span>
                      )}
                      {foreignHosts.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-danger">
                          <Terminal className="h-3 w-3" />
                          {t("triage.badge.native")}: <span dir="ltr">{foreignHosts.map((h) => h.host).join(", ")}</span>
                        </span>
                      )}
                      {externals.length > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Globe className="h-3 w-3" />
                          <span dir="ltr">{externals.slice(0, 3).map((e) => e.host).join(", ")}
                            {externals.length > 3 ? ` +${externals.length - 3}` : ""}</span>
                        </span>
                      )}
                      {(r.listingReviewStatus === "legacy_pending"
                        || r.listingReviewStatus === "pending") && (
                        <span className="text-warning">{t("triage.badge.listing")}</span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setOpen((o) => ({ ...o, [r.releaseId]: !o[r.releaseId] }))}
                  className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand">
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {t("triage.details")}
                </button>
              </div>

              {/* --- the evidence --- */}
              {expanded && (
                <div className="mt-4 space-y-4 border-t border-line pt-4">
                  {r.riskLevel === "not_scanned" && (
                    <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-ink-muted">
                      {t("triage.notscanned.body")}
                    </p>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-semibold text-ink">{t("mod.sec.perms")}</p>
                      {r.permissions.length === 0 && r.hostPermissions.length === 0 ? (
                        <p className="text-xs text-ink-muted">{t("detail.noperms")}</p>
                      ) : (
                        <ul className="space-y-0.5 text-xs text-ink-muted" dir="ltr">
                          {r.permissions.map((p) => <li key={p}>• {p}</li>)}
                          {r.hostPermissions.map((h) => (
                            <li key={h} className={r.broadHostAccess ? "text-warning" : ""}>• {h}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold text-ink">{t("triage.sec.reach")}</p>
                      <ul className="space-y-0.5 text-xs text-ink-muted" dir="ltr">
                        {r.nativeHosts.map((h) => (
                          <li key={h.host} className={h.isExtsyncBridge ? "" : "text-danger"}>
                            • {h.host}{h.isExtsyncBridge ? ` (${t("triage.bridge")})` : ""}
                          </li>
                        ))}
                        {r.endpoints.map((e) => (
                          <li key={e.host} className={e.benign ? "opacity-60" : ""}>• {e.host}</li>
                        ))}
                        {r.nativeHosts.length === 0 && r.endpoints.length === 0 && (
                          <li className="opacity-70">{t("triage.reach.none")}</li>
                        )}
                      </ul>
                      {r.scanTruncated && (
                        <p className="mt-1 text-xs text-warning">{t("triage.truncated")}</p>
                      )}
                    </div>
                  </div>

                  {r.findings.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-semibold text-ink">{t("mod.sec.risk")}</p>
                      <div className="space-y-2">
                        {r.findings.map((f, i) => (
                          <div key={`${f.code}-${i}`} className="rounded-md border border-line bg-surface-2/40 p-2">
                            <p className="text-xs font-medium text-ink">
                              {f.title}
                              {f.file && <span className="ms-2 font-mono text-ink-muted" dir="ltr">{f.file}</span>}
                            </p>
                            <p className="mt-0.5 text-xs text-ink-muted">{f.detail}</p>
                            {f.evidence && (
                              <pre className="mt-1 overflow-x-auto rounded bg-surface-2 p-1.5 font-mono text-[11px] text-ink" dir="ltr">
                                {f.evidence}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {r.artifactUrl && (
                      <a href={r.artifactUrl} target="_blank" rel="noopener noreferrer"
                         className="inline-flex items-center gap-1 text-brand hover:underline">
                        <FileArchive className="h-3.5 w-3.5" />{t("triage.zip")}
                      </a>
                    )}
                    <Link href={`/store/${r.projectSlug}`} target="_blank"
                          className="text-brand hover:underline" dir="ltr">/store/{r.projectSlug}</Link>
                    <Link href={`/app/moderation/${r.releaseId}`} className="text-brand hover:underline">
                      {t("triage.full")}
                    </Link>
                    <Link href={`/app/moderation/listing/${r.projectId}`} className="text-brand hover:underline">
                      {t("triage.listing")}
                    </Link>
                    {r.artifactSize != null && (
                      <span className="text-ink-muted" dir="ltr">
                        {(r.artifactSize / 1024).toFixed(0)} KB
                        {r.fileCount != null ? ` · ${r.fileCount} files` : ""}
                      </span>
                    )}
                  </div>

                  {/* --- decide --- */}
                  <div>
                    <input
                      value={reason[r.releaseId] || ""}
                      onChange={(e) => setReason((s) => ({ ...s, [r.releaseId]: e.target.value }))}
                      maxLength={2000}
                      placeholder={t("mod.f.reason.ph")}
                      className="mb-2 w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:border-brand outline-none"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={act.isPending} onClick={() => run(r, "approve")}>
                        {t("mod.act.approve")}
                      </Button>
                      <Button size="sm" variant="warning" disabled={act.isPending}
                              onClick={() => run(r, "request-changes")}>
                        {t("mod.act.changes")}
                      </Button>
                      <Button size="sm" variant="danger" disabled={act.isPending}
                              onClick={() => run(r, "unpublish")}>
                        {t("mod.act.unpublish")}
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-ink-muted">{t("triage.humanonly")}</p>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
