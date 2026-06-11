"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone, CircleCheck, CircleX } from "lucide-react";
import { api, ApiError, type InstallLink, type Project, type Release } from "@/lib/api";
import { useLocale } from "@/components/locale-context";
import { Badge, Button, Card, Field, Input, Spinner } from "@/components/ui";
import { StatCard, TrendChart, type TrendDay } from "@/components/dashboard";
import { formatDate } from "@/lib/utils";

type Tab = "overview" | "versions" | "links" | "analytics";

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const { t } = useLocale();
  const id = params.id;
  const [tab, setTab] = useState<Tab>("overview");
  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.get<Project>(`/projects/${id}`),
  });

  if (isLoading || !project) return <div className="flex justify-center py-20"><Spinner /></div>;

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: t("dash.pd.tab.overview") },
    { id: "versions", label: t("dash.pd.tab.versions") },
    { id: "links", label: t("dash.pd.tab.links") },
    { id: "analytics", label: t("dash.pd.tab.analytics") },
  ];

  return (
    <div>
      <Link href="/app/projects" className="mb-3 inline-block text-sm text-ink-muted hover:text-brand">{t("dash.pd.back")}</Link>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-ink">{project.name}</h1>
        <Badge status={project.status}>{project.status}</Badge>
      </div>
      <p className="mb-6 text-sm text-ink-muted" dir="ltr">Extension ID: {project.extensionId ?? "-"}</p>

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`whitespace-nowrap px-4 py-2 text-sm ${tab === tb.id ? "border-b-2 border-brand font-medium text-brand" : "text-ink-muted"}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab project={project} />}
      {tab === "versions" && <VersionsTab project={project} />}
      {tab === "links" && <LinksTab projectId={id} />}
      {tab === "analytics" && <AnalyticsTab projectId={id} />}
    </div>
  );
}

function OverviewTab({ project }: { project: Project }) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [iconErr, setIconErr] = useState<string | null>(null);
  const uploadIcon = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.upload<Project>(`/projects/${project.id}/icon`, fd);
    },
    onSuccess: () => { setIconErr(null); qc.invalidateQueries({ queryKey: ["project", project.id] }); },
    onError: (e) => setIconErr(e instanceof ApiError ? e.message : t("dash.pd.upfailed")),
  });

  const setVisibility = useMutation({
    mutationFn: (visibility: "public" | "private") =>
      api.patch<Project>(`/projects/${project.id}`, { visibility }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", project.id] }),
  });

  const [shortDesc, setShortDesc] = useState(project.shortDescription ?? "");
  const [fullDesc, setFullDesc] = useState(project.fullDescription ?? "");
  const [descSaved, setDescSaved] = useState(false);
  const saveDesc = useMutation({
    mutationFn: () =>
      api.patch<Project>(`/projects/${project.id}`, { shortDescription: shortDesc, fullDescription: fullDesc }),
    onSuccess: () => {
      setDescSaved(true);
      setTimeout(() => setDescSaved(false), 2500);
      qc.invalidateQueries({ queryKey: ["project", project.id] });
    },
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <h3 className="mb-3 font-semibold text-ink">{t("dash.pd.details")}</h3>
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-ink-muted">Slug</dt><dd className="text-ink">{project.slug}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-ink-muted">{t("dash.pd.visibility")}</dt>
            <select
              value={project.visibility}
              disabled={setVisibility.isPending}
              onChange={(e) => setVisibility.mutate(e.target.value as "public" | "private")}
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
            >
              <option value="private">{t("dash.pd.vis.private")}</option>
              <option value="public">{t("dash.pd.vis.public")}</option>
            </select>
          </div>
          <div className="flex items-center justify-between"><dt className="text-ink-muted">{t("dash.pd.bridge")}</dt><dd className="text-ink">{project.bridgeMode}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-ink-muted">
          {project.visibility === "public" ? t("dash.pd.note.public") : t("dash.pd.note.private")}
        </p>
      </Card>
      <Card>
        <h3 className="mb-3 font-semibold text-ink">{t("dash.pd.desc.title")}</h3>
        <Field label={t("dash.pd.desc.short")}>
          <Input
            value={shortDesc}
            maxLength={280}
            onChange={(e) => setShortDesc(e.target.value)}
            placeholder={t("dash.pd.desc.short.ph")}
          />
        </Field>
        <Field label={t("dash.pd.desc.full")}>
          <textarea
            value={fullDesc}
            onChange={(e) => setFullDesc(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand outline-none"
            placeholder={t("dash.pd.desc.full.ph")}
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={saveDesc.isPending || (shortDesc === (project.shortDescription ?? "") && fullDesc === (project.fullDescription ?? ""))}
            onClick={() => saveDesc.mutate()}
          >
            {saveDesc.isPending ? t("dash.pd.desc.saving") : t("dash.pd.desc.save")}
          </Button>
          {descSaved && <span className="text-xs text-success">{t("dash.pd.desc.saved")}</span>}
        </div>
      </Card>
      <Card className="sm:col-span-2">
        <h3 className="mb-2 font-semibold text-ink">{t("dash.pd.icon.title")}</h3>
        <div className="flex flex-wrap items-center gap-4">
          {project.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={project.iconUrl} alt="" className="h-20 w-28 rounded-lg border border-line object-cover" />
          ) : (
            <div className="flex h-20 w-28 items-center justify-center rounded-lg border border-dashed border-line text-xs text-ink-muted">
              {t("dash.pd.icon.none")}
            </div>
          )}
          <div>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadIcon.mutate(f); }}
              className="block text-sm text-ink-muted"
            />
            <p className="mt-1 text-xs text-ink-muted">
              {t("dash.pd.icon.help")}
              {uploadIcon.isPending && ` ${t("dash.pd.icon.uploading")}`}
            </p>
            {iconErr && <p className="mt-1 text-xs text-danger">{iconErr}</p>}
          </div>
        </div>
      </Card>
    </div>
  );
}

const SCANNING = new Set(["uploaded", "validating"]);

function VersionsTab({ project }: { project: Project }) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const { data: releases } = useQuery({
    queryKey: ["releases", project.id],
    queryFn: () => api.get<Release[]>(`/projects/${project.id}/releases`),
    // Poll fast while a release is being scanned, then back off.
    refetchInterval: (q) =>
      (q.state.data as Release[] | undefined)?.some((r) => SCANNING.has(r.status)) ? 1500 : false,
  });

  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [channel, setChannel] = useState("stable");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new ApiError(400, t("dash.pd.up.choose"));
      const fd = new FormData();
      fd.append("file", file);
      fd.append("version", version);
      fd.append("channel", channel);
      if (notes.trim()) fd.append("release_notes", notes.trim());
      return api.upload(`/projects/${project.id}/releases`, fd);
    },
    onSuccess: () => { setFile(null); setVersion(""); setNotes(""); qc.invalidateQueries({ queryKey: ["releases", project.id] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("dash.pd.upfailed")),
  });

  const publish = useMutation({
    mutationFn: (releaseId: string) =>
      api.post(`/projects/${project.id}/releases/${releaseId}/publish`, { rolloutPercentage: 100 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["releases", project.id] }),
  });

  const rollback = useMutation({
    mutationFn: (releaseId: string) =>
      api.post(`/projects/${project.id}/releases/${releaseId}/rollback`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["releases", project.id] }),
  });

  const remove = useMutation({
    mutationFn: (releaseId: string) => api.del(`/projects/${project.id}/releases/${releaseId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["releases", project.id] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : t("dash.pd.delfailed")),
  });

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="mb-4 font-semibold text-ink">{t("dash.pd.up.title")}</h3>
        {error && <p className="mb-3 rounded-md bg-red-50 dark:bg-red-500/10 p-2 text-sm text-danger dark:text-red-400">{error}</p>}
        <Field label={t("dash.pd.up.zip")}>
          <input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                 className="block w-full text-sm text-ink-muted" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dash.pd.up.version")}><Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" /></Field>
          <Field label={t("dash.pd.up.channel")}>
            <select value={channel} onChange={(e) => setChannel(e.target.value)}
                    className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
              <option value="stable">Stable</option>
              <option value="beta">Beta</option>
              <option value="nightly">Nightly</option>
            </select>
          </Field>
        </div>
        <Field label={t("dash.pd.up.notes")}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={1000}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand outline-none"
            placeholder={t("dash.pd.up.notes.ph")}
          />
        </Field>
        <Button onClick={() => upload.mutate()} disabled={!file || !version || upload.isPending}>
          {upload.isPending ? t("dash.pd.up.busy") : t("dash.pd.up.btn")}
        </Button>
      </Card>

      <div className="space-y-3">
        {(releases ?? []).map((r) => {
          const scanning = SCANNING.has(r.status);
          const riskColor = r.riskScore >= 60 ? "text-danger" : r.riskScore >= 30 ? "text-warning" : "text-success";
          return (
            <Card key={r.id} className="lift">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink" dir="ltr">v{r.version}</span>
                    <Badge>{r.channel}</Badge>
                    <Badge status={r.status}>{r.status}</Badge>
                    {r.permissionsChanged && <Badge>{t("dash.pd.permschanged")}</Badge>}
                    {!scanning && (
                      <span className={`text-xs font-medium ${riskColor}`}>{t("dash.pd.risk")} {r.riskScore}</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {formatDate(r.createdAt)} · seq {r.sequence ?? "-"}
                    {!!r.warningsCount && r.status !== "validation_failed" && (
                      <span className="text-warning"> · {r.warningsCount} {t("dash.pd.warnings")}</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {r.status === "ready" && (
                    <Button size="sm" onClick={() => publish.mutate(r.id)} disabled={publish.isPending}>{t("dash.pd.publish")}</Button>
                  )}
                  {(r.status === "superseded" || r.status === "published") && (
                    <Button size="sm" variant="warning" onClick={() => rollback.mutate(r.id)}>{t("dash.pd.rollback")}</Button>
                  )}
                  {r.status !== "published" && !scanning && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (confirm(`${t("dash.pd.delconfirm.1")} ${r.version}${t("dash.pd.delconfirm.2")}`)) remove.mutate(r.id);
                      }}
                    >
                      {t("dash.pd.delete")}
                    </Button>
                  )}
                </div>
              </div>

              {/* live scan progress */}
              {scanning && (
                <div className="mt-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-brand">
                    <span className="animate-spin">🔍</span>
                    {r.status === "uploaded" ? t("dash.pd.scanq") : t("dash.pd.scanning")}
                  </p>
                  <div className="scan-track" />
                </div>
              )}

              {/* failure reason */}
              {r.status === "validation_failed" && r.validationError && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-danger dark:text-red-400">
                  <span>⛔</span><p>{r.validationError}</p>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function LinksTab({ projectId }: { projectId: string }) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["links", projectId],
    queryFn: () => api.get<InstallLink[]>(`/projects/${projectId}/install-links`),
  });
  const create = useMutation({
    mutationFn: () => api.post<InstallLink>(`/projects/${projectId}/install-links`, { channel: "stable", linkType: "public" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["links", projectId] }),
  });

  return (
    <div className="space-y-4">
      <Button onClick={() => create.mutate()} disabled={create.isPending}>{t("dash.pd.link.create")}</Button>
      <div className="space-y-2">
        {(data ?? []).map((l) => (
          <Card key={l.id} className="flex items-center justify-between">
            <div>
              <code className="text-sm text-ink">{l.url}</code>
              <p className="mt-1 text-xs text-ink-muted">
                {l.linkType} • {l.channel} • {t("dash.pd.link.uses")} {l.usedCount}{l.maxUses ? `/${l.maxUses}` : ""}
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(l.url)}>{t("dash.pd.link.copy")}</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AnalyticsTab({ projectId }: { projectId: string }) {
  const { t } = useLocale();
  const { data } = useQuery({
    queryKey: ["analytics", projectId],
    queryFn: () => api.get<any>(`/projects/${projectId}/analytics`),
  });
  const { data: series } = useQuery({
    queryKey: ["analytics-timeseries", projectId],
    queryFn: () => api.get<{ days: TrendDay[] }>(`/projects/${projectId}/analytics/timeseries`),
  });
  if (!data) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={<MonitorSmartphone size={18} />} label={t("dash.pd.an.active")} value={data.activeInstallations} />
        <StatCard icon={<CircleCheck size={18} />} label={t("dash.pd.an.ok")} value={data.updates24h.success} tone="text-success" iconClass="bg-success" />
        <StatCard icon={<CircleX size={18} />} label={t("dash.pd.an.fail")} value={data.updates24h.failed} tone="text-danger" iconClass="bg-danger" />
      </div>
      {series && (
        <Card>
          <h3 className="mb-3 font-semibold text-ink">{t("dash.ov.trend")}</h3>
          <TrendChart days={series.days} />
        </Card>
      )}
    </div>
  );
}
