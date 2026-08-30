"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { DashHeader } from "@/components/dashboard";
import { useLocale } from "@/components/locale-context";
import { useAuth } from "@/components/providers";
import { api, ApiError, type ListingDetail, type ListingSnapshot } from "@/lib/api";
import { Badge, Button, Card, Spinner } from "@/components/ui";

/**
 * Review a store listing: what the public currently sees, beside what the
 * developer wants it to say.
 *
 * The left column is live content. The right column has never been public and
 * does not become public until approved here - which is the whole point of
 * snapshotting the listing rather than rendering the developer's fields.
 */

const FIELDS: (keyof ListingSnapshot)[] = [
  "name",
  "short_description",
  "full_description",
  "category",
  "website",
  "repo_url",
  "support_url",
  "privacy_policy_url",
];

function text(v: unknown): string {
  return v == null || v === "" ? "" : String(v);
}

export default function ListingReviewPage(
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = use(params);
  const { t } = useLocale();
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["moderation-listing", projectId],
    queryFn: () => api.get<ListingDetail>(`/admin/moderation/listings/${projectId}`),
    enabled: user?.role === "platform_admin",
  });

  const act = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      api.post(`/admin/moderation/listings/${projectId}/${action}`, {
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moderation-counts"] });
      qc.invalidateQueries({ queryKey: ["moderation-listings"] });
      router.push("/app/moderation");
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("mod.act.failed")),
  });

  const run = (action: "approve" | "reject") => {
    setError(null);
    if (action === "reject" && !reason.trim()) {
      setError(t("mod.needreason"));
      return;
    }
    if (!confirm(t(`mod.listing.confirm.${action}`))) return;
    act.mutate(action);
  };

  if (user && user.role !== "platform_admin") {
    return <p className="text-sm text-ink-muted">{t("mod.denied")}</p>;
  }
  if (isLoading || !data) return <Spinner />;

  const { approved, proposed } = data;
  const changed = (f: keyof ListingSnapshot) =>
    !!approved && text(approved[f]) !== text(proposed[f]);
  const shotsChanged =
    !!approved &&
    JSON.stringify(approved.screenshots ?? []) !== JSON.stringify(proposed.screenshots ?? []);
  const busy = act.isPending;

  return (
    <>
      <DashHeader
        icon={<ShieldCheck className="h-5 w-5" />}
        title={text(proposed.name) || data.projectSlug}
        subtitle={t("mod.listing.subtitle")}
      />

      <Link href="/app/moderation" className="mb-4 inline-block text-sm text-ink-muted hover:text-brand">
        {t("mod.back")}
      </Link>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge status={data.listingReviewStatus}>
            {t(`dash.pd.rv.${data.listingReviewStatus}`)}
          </Badge>
          {data.developerEmail && (
            <span className="text-xs text-ink-muted" dir="ltr">{data.developerEmail}</span>
          )}
          <Link href={`/store/${data.projectSlug}`} target="_blank"
                className="text-xs text-brand hover:underline" dir="ltr">
            /store/{data.projectSlug}
          </Link>
        </div>
        {!approved && (
          <p className="mt-2 text-xs text-warning">{t("mod.listing.nosnapshot")}</p>
        )}
      </Card>

      {/* field-by-field diff */}
      <Card className="mb-4">
        <div className="mb-3 grid grid-cols-2 gap-4 text-xs font-semibold text-ink-muted">
          <span>{t("mod.listing.approved")}</span>
          <span>{t("mod.listing.proposed")}</span>
        </div>
        <div className="space-y-3">
          {FIELDS.map((f) => {
            const diff = changed(f);
            if (!text(approved?.[f]) && !text(proposed[f])) return null;
            return (
              <div key={String(f)}>
                <p className="mb-1 text-xs font-medium text-ink">
                  {t(`mod.lf.${String(f)}`)}
                  {diff && <span className="ms-2 text-warning">{t("mod.listing.changed")}</span>}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <p className="whitespace-pre-line break-words rounded-md bg-surface-2/50 p-2 text-xs text-ink-muted">
                    {text(approved?.[f]) || "-"}
                  </p>
                  <p className={`whitespace-pre-line break-words rounded-md p-2 text-xs ${
                    diff ? "bg-warning/10 text-ink" : "bg-surface-2/50 text-ink-muted"
                  }`}>
                    {text(proposed[f]) || "-"}
                  </p>
                </div>
              </div>
            );
          })}

          {/* images */}
          <div>
            <p className="mb-1 text-xs font-medium text-ink">
              {t("mod.lf.icon_url")}
              {changed("icon_url") && (
                <span className="ms-2 text-warning">{t("mod.listing.changed")}</span>
              )}
            </p>
            <div className="grid grid-cols-2 gap-4">
              {[approved?.icon_url, proposed.icon_url].map((src, i) => (
                <div key={i} className="rounded-md bg-surface-2/50 p-2">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" className="h-16 w-16 rounded-lg" />
                  ) : (
                    <span className="text-xs text-ink-muted">-</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-ink">
              {t("mod.lf.screenshots")}
              {shotsChanged && (
                <span className="ms-2 text-warning">{t("mod.listing.changed")}</span>
              )}
            </p>
            <div className="grid grid-cols-2 gap-4">
              {[approved?.screenshots ?? [], proposed.screenshots ?? []].map((list, i) => (
                <div key={i} className="flex flex-wrap gap-2 rounded-md bg-surface-2/50 p-2">
                  {list.length === 0 && <span className="text-xs text-ink-muted">-</span>}
                  {list.map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={src} src={src} alt="" className="h-16 rounded border border-line" />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">{t("mod.sec.decide")}</h2>
        <label className="mb-1 block text-sm font-medium text-ink">{t("mod.f.reason")}</label>
        <p className="mb-1 text-xs text-ink-muted">{t("mod.listing.reason.help")}</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={2000}
          className="mb-4 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand outline-none"
          placeholder={t("mod.f.reason.ph")}
        />
        {error && (
          <p className="mb-3 rounded-md bg-red-50 p-2 text-sm text-danger dark:bg-red-500/10 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => run("approve")}>
            {t("mod.listing.approve")}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => run("reject")}>
            {t("mod.listing.reject")}
          </Button>
        </div>
        <p className="mt-3 text-xs text-ink-muted">{t("mod.listing.help")}</p>
      </Card>
    </>
  );
}
