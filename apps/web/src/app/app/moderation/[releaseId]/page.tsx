"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ShieldCheck, AlertTriangle, Radio, Lock, Globe } from "lucide-react";
import { DashHeader } from "@/components/dashboard";
import { useLocale } from "@/components/locale-context";
import { useAuth } from "@/components/providers";
import { api, ApiError, type ModerationDetail } from "@/lib/api";
import { Badge, Button, Card, Spinner } from "@/components/ui";

/**
 * One release, everything needed to decide about it, and the four decisions.
 *
 * Two text fields, and the difference between them is the point:
 *   reason - goes to the developer. Written as a message to them.
 *   note   - internal. Read back only here, never sent to a developer.
 *
 * Refusing anything requires a reason, so a developer is never left with a
 * rejection and no explanation.
 */

type ActionKey = "approve" | "reject" | "request-changes" | "unpublish";

interface ValidationReport {
  errors?: { code?: string; message: string; file?: string | null }[];
  warnings?: { code?: string; message: string; file?: string | null }[];
  manifest?: { permissions?: string[]; host_permissions?: string[] };
  fileCount?: number;
}

export default function ModerationDetailPage(
  { params }: { params: Promise<{ releaseId: string }> },
) {
  const { releaseId } = use(params);
  const { t } = useLocale();
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["moderation-detail", releaseId],
    queryFn: () => api.get<ModerationDetail>(`/admin/moderation/releases/${releaseId}`),
    enabled: user?.role === "platform_admin",
  });

  const act = useMutation({
    mutationFn: (action: ActionKey) =>
      api.post(`/admin/moderation/releases/${releaseId}/${action}`, {
        reason: reason.trim() || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moderation-counts"] });
      qc.invalidateQueries({ queryKey: ["moderation-queue"] });
      router.push("/app/moderation");
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : t("mod.act.failed")),
  });

  const run = (action: ActionKey) => {
    setError(null);
    // Every refusal has to carry an explanation - the server requires it too.
    if (action !== "approve" && !reason.trim()) {
      setError(t("mod.needreason"));
      return;
    }
    if (!confirm(t(`mod.confirm.${action}`))) return;
    act.mutate(action);
  };

  if (user && user.role !== "platform_admin") {
    return <p className="text-sm text-ink-muted">{t("mod.denied")}</p>;
  }
  if (isLoading || !data) return <Spinner />;

  const { release, review, project, developer, artifact } = data;
  const report = (release.validationReport ?? null) as ValidationReport | null;
  const perms = report?.manifest?.permissions ?? [];
  const hosts = report?.manifest?.host_permissions ?? [];
  const busy = act.isPending;

  return (
    <>
      <DashHeader
        icon={<ShieldCheck className="h-5 w-5" />}
        title={project.name}
        subtitle={`v${release.version} · ${release.channel}`}
      />

      <Link href="/app/moderation" className="mb-4 inline-block text-sm text-ink-muted hover:text-brand">
        {t("mod.back")}
      </Link>

      {/* state at a glance */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge status={release.reviewStatus}>{t(`dash.pd.rv.${release.reviewStatus}`)}</Badge>
          <Badge status={release.status}>{release.status}</Badge>
          {release.isLive && (
            <Badge status="published"><Radio className="me-1 h-3 w-3" />{t("mod.live")}</Badge>
          )}
          {release.permissionsChanged && (
            <Badge status="paused">{t("dash.pd.permschanged")}</Badge>
          )}
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${
            release.riskScore >= 60 ? "text-danger"
              : release.riskScore >= 30 ? "text-warning" : "text-success"
          }`}>
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("dash.pd.risk")} <span dir="ltr">{release.riskScore}</span>
          </span>
        </div>

        {/* Where the bytes are is itself a reviewable fact: "staged" means the
            file genuinely is not downloadable by anyone yet. */}
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          {artifact.public ? (
            <span className="inline-flex items-center gap-1 text-warning">
              <Globe className="h-3.5 w-3.5" />{t("mod.art.public")}
            </span>
          ) : artifact.staged ? (
            <span className="inline-flex items-center gap-1 text-success">
              <Lock className="h-3.5 w-3.5" />{t("mod.art.staged")}
            </span>
          ) : (
            <span className="text-danger">{t("mod.art.none")}</span>
          )}
          {artifact.size != null && (
            <span dir="ltr">· {(artifact.size / 1024).toFixed(0)} KB</span>
          )}
          {artifact.fileCount != null && <span dir="ltr">· {artifact.fileCount} files</span>}
        </p>
        {artifact.sha256 && (
          <p className="mt-1 break-all font-mono text-[11px] text-ink-muted" dir="ltr">
            {artifact.sha256}
          </p>
        )}
      </Card>

      {/* who and what */}
      <Card className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">{t("mod.sec.listing")}</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-ink-muted">{t("mod.developer")}</dt>
            <dd className="text-ink" dir="ltr">{developer.email ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">{t("mod.slug")}</dt>
            <dd className="text-ink" dir="ltr">
              <Link href={`/store/${project.slug}`} target="_blank" className="text-brand hover:underline">
                /store/{project.slug}
              </Link>
            </dd>
          </div>
          {project.extensionId && (
            <div>
              <dt className="text-xs text-ink-muted">{t("mod.extid")}</dt>
              <dd className="break-all font-mono text-xs text-ink" dir="ltr">{project.extensionId}</dd>
            </div>
          )}
          {project.website && (
            <div>
              <dt className="text-xs text-ink-muted">{t("mod.website")}</dt>
              <dd className="break-all text-ink" dir="ltr">{project.website}</dd>
            </div>
          )}
        </dl>
        {project.shortDescription && (
          <p className="mt-3 whitespace-pre-line text-sm text-ink">{project.shortDescription}</p>
        )}
        {project.fullDescription && (
          <p className="mt-2 whitespace-pre-line text-xs text-ink-muted">{project.fullDescription}</p>
        )}
        {release.releaseNotes && (
          <div className="mt-3 rounded-lg border border-line bg-surface-2/50 p-3">
            <p className="text-xs font-semibold text-ink">{t("mod.notes")}</p>
            <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{release.releaseNotes}</p>
          </div>
        )}
      </Card>

      {/* what it can do */}
      <Card className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">{t("mod.sec.perms")}</h2>
        {perms.length === 0 && hosts.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("detail.noperms")}</p>
        ) : (
          <ul className="space-y-1 text-sm text-ink-muted" dir="ltr">
            {perms.map((p) => <li key={p}>• {p}</li>)}
            {hosts.map((h) => <li key={h} className="text-warning">• {h}</li>)}
          </ul>
        )}
        {!!report?.warnings?.length && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-warning">
              {report.warnings.length} {t("dash.pd.warnings")}
            </p>
            <ul className="mt-1 space-y-1 text-xs text-ink-muted">
              {report.warnings.slice(0, 20).map((w, i) => (
                <li key={i}>• {w.message}{w.file ? ` (${w.file})` : ""}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* prior decision, if any */}
      {(review.reason || review.note || review.reviewedAt) && (
        <Card className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t("mod.sec.prior")}</h2>
          {review.reviewedByEmail && (
            <p className="text-xs text-ink-muted" dir="ltr">
              {review.reviewedByEmail} · {review.reviewedAt}
            </p>
          )}
          {review.reason && (
            <p className="mt-2 text-sm text-ink">
              <span className="font-medium">{t("mod.f.reason")}:</span> {review.reason}
            </p>
          )}
          {review.note && (
            <p className="mt-2 rounded-md border border-line bg-surface-2/50 p-2 text-sm text-ink-muted">
              <span className="font-medium">{t("mod.f.note")}:</span> {review.note}
            </p>
          )}
        </Card>
      )}

      {/* the decision */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">{t("mod.sec.decide")}</h2>

        <label className="mb-1 block text-sm font-medium text-ink">{t("mod.f.reason")}</label>
        <p className="mb-1 text-xs text-ink-muted">{t("mod.f.reason.help")}</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={2000}
          className="mb-4 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand outline-none"
          placeholder={t("mod.f.reason.ph")}
        />

        <label className="mb-1 block text-sm font-medium text-ink">{t("mod.f.note")}</label>
        <p className="mb-1 text-xs text-ink-muted">{t("mod.f.note.help")}</p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={4000}
          className="mb-4 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand outline-none"
          placeholder={t("mod.f.note.ph")}
        />

        {error && (
          <p className="mb-3 rounded-md bg-red-50 p-2 text-sm text-danger dark:bg-red-500/10 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => run("approve")}>{t("mod.act.approve")}</Button>
          <Button variant="warning" disabled={busy} onClick={() => run("request-changes")}>
            {t("mod.act.changes")}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => run("reject")}>
            {t("mod.act.reject")}
          </Button>
          {release.isLive && (
            <Button variant="danger" disabled={busy} onClick={() => run("unpublish")}>
              {t("mod.act.unpublish")}
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-ink-muted">{t("mod.act.help")}</p>
      </Card>
    </>
  );
}
