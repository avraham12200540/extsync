"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, ShieldAlert } from "lucide-react";
import { DashHeader } from "@/components/dashboard";
import { useLocale } from "@/components/locale-context";
import { useAuth } from "@/components/providers";
import { api, type ApplyPreparedResult, type PreparedDecision, type PreparedVerdict } from "@/lib/api";
import { Badge, Button, Card, Spinner } from "@/components/ui";

/**
 * Apply reviewed-but-not-executed moderation decisions, as yourself.
 *
 * The review and the authority are deliberately separate. A prepared decision
 * changes nothing the public can see; this page is where an administrator reads
 * what was prepared and decides to make it real, under their own session, with
 * their own name on every resulting audit row.
 *
 * Two things this screen is responsible for showing honestly:
 *
 *   - The checksum comparison. A decision made about a build that has since
 *     changed is a judgement about code nobody reviewed, so those rows are
 *     blocked rather than merely flagged.
 *   - What is EXCLUDED. Unchecking a row is the only control the client has;
 *     the action itself comes from the server's stored row, so the request
 *     cannot ask for anything stronger than what was reviewed.
 */

const VERDICT_ORDER: PreparedVerdict[] = [
  "unpublish", "request_changes", "needs_human_review",
  "approve_with_note", "approve",
];

const VERDICT_TONE: Record<PreparedVerdict, { badge: string; label: string }> = {
  unpublish: { badge: "rejected", label: "mod.prep.v.unpublish" },
  request_changes: { badge: "changes_requested", label: "mod.prep.v.changes" },
  needs_human_review: { badge: "legacy_pending", label: "mod.prep.v.human" },
  approve_with_note: { badge: "approved", label: "mod.prep.v.approveNote" },
  approve: { badge: "approved", label: "mod.prep.v.approve" },
};

function shortSha(sha?: string | null): string {
  return sha ? `${sha.slice(0, 12)}...` : "-";
}

export default function PreparedDecisionsPage() {
  const { t } = useLocale();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ApplyPreparedResult | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["moderation", "prepared"],
    queryFn: () => api.get<PreparedDecision[]>("/admin/moderation/prepared"),
    enabled: user?.role === "platform_admin",
  });

  const rows = data ?? [];
  const pending = rows.filter((r) => r.state === "prepared");
  const runnable = pending.filter((r) => !r.blockedReason);
  const blocked = pending.filter((r) => r.blockedReason);
  const done = rows.filter((r) => r.state !== "prepared");

  const selected = useMemo(
    () => runnable.filter((r) => !excluded.has(r.id)),
    [runnable, excluded],
  );

  const apply = useMutation({
    mutationFn: () =>
      api.post<ApplyPreparedResult>("/admin/moderation/prepared/apply", {
        ids: selected.map((r) => r.id),
      }),
    onSuccess: (res) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ["moderation"] });
    },
  });

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (user && user.role !== "platform_admin") {
    return <p className="text-ink-muted">{t("mod.forbidden")}</p>;
  }

  return (
    <div>
      <DashHeader
        icon={<ClipboardCheck className="h-5 w-5" />}
        title={t("mod.prep.title")}
        subtitle={t("mod.prep.subtitle")}
        action={
          <Link href="/app/moderation">
            <Button variant="secondary" size="sm">{t("mod.prep.backToQueue")}</Button>
          </Link>
        }
      />

      {isLoading && <div className="flex justify-center py-16"><Spinner /></div>}

      {!isLoading && rows.length === 0 && (
        <Card><p className="text-ink-muted">{t("mod.prep.empty")}</p></Card>
      )}

      {!isLoading && rows.length > 0 && (
        <div className="space-y-6">
          {/* What is about to happen, before anything happens. */}
          <Card className="border-brand/40">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-ink">{t("mod.prep.aboutToApply")}</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  {t("mod.prep.willRecord")} <strong className="text-ink">{user?.email}</strong>
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {VERDICT_ORDER.map((v) => {
                    const n = selected.filter((r) => r.decision === v).length;
                    if (!n) return null;
                    return (
                      <Badge key={v} status={VERDICT_TONE[v].badge}>
                        {t(VERDICT_TONE[v].label)}: {n}
                      </Badge>
                    );
                  })}
                  {selected.length === 0 && (
                    <span className="text-ink-muted">{t("mod.prep.noneSelected")}</span>
                  )}
                </div>
              </div>
              <div className="text-end">
                <Button
                  disabled={selected.length === 0 || apply.isPending}
                  onClick={() => apply.mutate()}
                >
                  {apply.isPending
                    ? t("mod.prep.applying")
                    : `${t("mod.prep.apply")} (${selected.length})`}
                </Button>
                {excluded.size > 0 && (
                  <p className="mt-2 text-xs text-ink-muted">
                    {t("mod.prep.excludedCount")}: {excluded.size}
                  </p>
                )}
              </div>
            </div>
            {apply.isError && (
              <p className="mt-3 text-sm text-danger">{(apply.error as Error).message}</p>
            )}
          </Card>

          {result && (
            <Card className="border-brand/40">
              <h2 className="text-lg font-semibold text-ink">{t("mod.prep.result")}</h2>
              <p className="mt-1 text-sm text-ink-muted">
                {t("mod.prep.resApplied")}: {result.applied} ·{" "}
                {t("mod.prep.resSkipped")}: {result.skipped} ·{" "}
                {t("mod.prep.resFailed")}: {result.failed} ·{" "}
                {t("mod.prep.resBy")}: {result.appliedBy}
              </p>
              <ul className="mt-3 space-y-1 text-sm">
                {result.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2">
                    {i.state === "applied"
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                      : <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />}
                    <span className="font-mono text-xs text-ink-muted">{i.slug || i.releaseId}</span>
                    <span className="text-ink">{i.decision}</span>
                    <span className="text-ink-muted">{i.message}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {blocked.length > 0 && (
            <Card className="border-warning/50">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
                <ShieldAlert className="h-5 w-5 text-warning" />
                {t("mod.prep.blocked")} ({blocked.length})
              </h2>
              <p className="mt-1 text-sm text-ink-muted">{t("mod.prep.blockedWhy")}</p>
              <div className="mt-4 space-y-3">
                {blocked.map((r) => <Row key={r.id} row={r} t={t} />)}
              </div>
            </Card>
          )}

          {VERDICT_ORDER.map((verdict) => {
            const group = runnable.filter((r) => r.decision === verdict);
            if (group.length === 0) return null;
            return (
              <Card key={verdict}>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
                  <Badge status={VERDICT_TONE[verdict].badge}>
                    {t(VERDICT_TONE[verdict].label)}
                  </Badge>
                  <span className="text-ink-muted text-sm font-normal">
                    {group.length}
                  </span>
                </h2>
                <div className="mt-4 space-y-3">
                  {group.map((r) => (
                    <Row
                      key={r.id}
                      row={r}
                      t={t}
                      checked={!excluded.has(r.id)}
                      onToggle={() => toggle(r.id)}
                    />
                  ))}
                </div>
              </Card>
            );
          })}

          {done.length > 0 && (
            <Card>
              <h2 className="text-lg font-semibold text-ink">
                {t("mod.prep.alreadyDone")} ({done.length})
              </h2>
              <div className="mt-4 space-y-3">
                {done.map((r) => <Row key={r.id} row={r} t={t} />)}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  row, t, checked, onToggle,
}: {
  row: PreparedDecision;
  t: (k: string) => string;
  checked?: boolean;
  onToggle?: () => void;
}) {
  const selectable = typeof checked === "boolean";
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--brand)]"
            aria-label={t("mod.prep.include")}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/app/moderation/${row.releaseId}`}
              className="font-medium text-ink hover:text-brand"
            >
              {row.extension ?? row.releaseId}
            </Link>
            {row.version && <span className="text-sm text-ink-muted">v{row.version}</span>}
            {row.channel && <Badge>{row.channel}</Badge>}
            {row.currentReviewStatus && (
              <Badge status={row.currentReviewStatus}>{row.currentReviewStatus}</Badge>
            )}
            {row.state !== "prepared" && <Badge status={row.state}>{row.state}</Badge>}
          </div>

          {/* The checksum pair is the single most important thing on this row:
              it says whether the decision is about the code that ships now. */}
          <p className="mt-2 font-mono text-xs text-ink-muted">
            {t("mod.prep.reviewed")}: {shortSha(row.reviewedSha256)}
            <ArrowRight className="mx-1 inline h-3 w-3" />
            {t("mod.prep.current")}: {shortSha(row.currentSha256)}{" "}
            {row.checksum === "changed" && (
              <span className="font-sans font-semibold text-danger">
                {t("mod.prep.checksumChanged")}
              </span>
            )}
            {row.checksum === "unknown" && (
              <span className="font-sans text-warning">{t("mod.prep.checksumUnknown")}</span>
            )}
          </p>

          {row.developerReason && (
            <p className="mt-2 text-sm text-ink">
              <span className="text-ink-muted">{t("mod.prep.devReason")}: </span>
              {row.developerReason}
            </p>
          )}
          {row.internalNote && (
            <p className="mt-1 text-sm text-ink-muted">
              <span className="font-medium">{t("mod.prep.internalNote")}: </span>
              {row.internalNote}
            </p>
          )}
          {row.blockedReason && (
            <p className="mt-2 text-sm font-medium text-warning">{row.blockedReason}</p>
          )}
          {row.state !== "prepared" && row.appliedByEmail && (
            <p className="mt-2 text-xs text-ink-muted">
              {t("mod.prep.appliedBy")}: {row.appliedByEmail}
              {row.appliedAt ? ` · ${row.appliedAt}` : ""}
            </p>
          )}
          {row.resultMessage && (
            <p className="mt-1 text-xs text-danger">{row.resultMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}
