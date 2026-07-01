"use client";

import { use, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone, CircleCheck, CircleX, Loader2, Lightbulb, X } from "lucide-react";
import { api, ApiError, type InstallLink, type Project, type Release } from "@/lib/api";
import { useLocale } from "@/components/locale-context";
import { useAuth } from "@/components/providers";
import { Badge, Button, Card, Field, Input, Spinner } from "@/components/ui";
import { StatCard, TrendChart, type TrendDay } from "@/components/dashboard";
import { Markdown } from "@/components/markdown";
import { formatDate } from "@/lib/utils";

type Tab = "overview" | "versions" | "links" | "analytics";

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useLocale();
  const { id } = use(params);
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
      {tab === "links" && <LinksTab projectId={id} slug={project.slug} />}
      {tab === "analytics" && <AnalyticsTab projectId={id} />}
    </div>
  );
}

function OverviewTab({ project }: { project: Project }) {
  const { t } = useLocale();
  // Platform admins may upload any file type (no picker filter); see the API side.
  const isAdmin = useAuth().user?.role === "platform_admin";
  const qc = useQueryClient();
  const router = useRouter();
  const [iconErr, setIconErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const deleteProject = async () => {
    if (!confirm(`${t("dash.pd.del.c1")} "${project.name}" ${t("dash.pd.del.c2")}`)) return;
    if (!confirm(t("dash.pd.del.c3"))) return;
    setDeleting(true);
    try {
      await api.del(`/projects/${project.id}`);
      router.push("/app/projects");
    } catch (e) {
      setDeleting(false);
      alert(e instanceof ApiError ? e.message : t("dash.pd.delfailed"));
    }
  };
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
  const fullDescRef = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);
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

  // Lightweight Markdown editing helpers for the full-description textarea.
  function mdSurround(before: string, after: string, placeholder: string) {
    const ta = fullDescRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = fullDesc.slice(s, e) || placeholder;
    setFullDesc(fullDesc.slice(0, s) + before + sel + after + fullDesc.slice(e));
    const from = s + before.length;
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(from, from + sel.length); });
  }
  function mdPrefixLine(prefix: string) {
    const ta = fullDescRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const ls = fullDesc.lastIndexOf("\n", s - 1) + 1;
    setFullDesc(fullDesc.slice(0, ls) + prefix + fullDesc.slice(ls));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + prefix.length, s + prefix.length); });
  }

  const [shotErr, setShotErr] = useState<string | null>(null);
  const screenshots = project.screenshots ?? [];
  const uploadShot = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.upload<Project>(`/projects/${project.id}/screenshots`, fd);
    },
    onSuccess: () => { setShotErr(null); qc.invalidateQueries({ queryKey: ["project", project.id] }); },
    onError: (e) => setShotErr(e instanceof ApiError ? e.message : t("dash.pd.upfailed")),
  });
  const deleteShot = useMutation({
    mutationFn: (sid: string) => api.del<Project>(`/projects/${project.id}/screenshots/${sid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", project.id] }),
    onError: (e) => setShotErr(e instanceof ApiError ? e.message : t("dash.pd.upfailed")),
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
          <div className="mb-1.5 flex flex-wrap items-center gap-1">
            <button type="button" onClick={() => mdSurround("**", "**", t("dash.pd.md.boldph"))} title={t("dash.pd.md.bold")} className="rounded border border-line px-2 py-0.5 text-xs font-semibold text-ink hover:bg-surface-2">B</button>
            <button type="button" onClick={() => mdPrefixLine("## ")} className="rounded border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface-2">{t("dash.pd.md.heading")}</button>
            <button type="button" onClick={() => mdSurround("[", "](https://)", t("dash.pd.md.linkph"))} className="rounded border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface-2">{t("dash.pd.md.link")}</button>
            <button type="button" onClick={() => mdPrefixLine("- ")} className="rounded border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface-2">{t("dash.pd.md.list")}</button>
            <button type="button" onClick={() => setShowPreview((v) => !v)} className="ms-auto rounded border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface-2">{t("dash.pd.md.preview")}</button>
          </div>
          <textarea
            ref={fullDescRef}
            value={fullDesc}
            onChange={(e) => setFullDesc(e.target.value)}
            rows={6}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand outline-none"
            placeholder={t("dash.pd.desc.full.ph")}
          />
          <p className="mt-1 text-xs text-ink-muted">{t("dash.pd.md.hint")}</p>
          {showPreview && fullDesc.trim() && (
            <div className="md-body mt-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink">
              <Markdown>{fullDesc}</Markdown>
            </div>
          )}
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
              accept={isAdmin ? undefined : "image/png,image/jpeg,image/webp,image/svg+xml"}
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

      {/* screenshots / promo images */}
      <Card className="sm:col-span-2">
        <h3 className="mb-1 font-semibold text-ink">{t("dash.pd.shots.title")}</h3>
        <p className="mb-3 text-xs text-ink-muted">{t("dash.pd.shots.help")} ({screenshots.length}/10)</p>
        {screenshots.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {screenshots.map((s) => (
              <div key={s.id} className="group relative overflow-hidden rounded-lg border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt="" className="h-28 w-full object-cover" />
                <button
                  onClick={() => deleteShot.mutate(s.id)}
                  disabled={deleteShot.isPending}
                  aria-label={t("dash.pd.shots.remove")}
                  className="absolute end-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity hover:bg-danger group-hover:opacity-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        {screenshots.length < 10 ? (
          <input
            type="file"
            accept={isAdmin ? undefined : "image/png,image/jpeg,image/webp"}
            disabled={uploadShot.isPending}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadShot.mutate(f); e.target.value = ""; }}
            className="block text-sm text-ink-muted"
          />
        ) : (
          <p className="text-xs text-ink-muted">{t("dash.pd.shots.max")}</p>
        )}
        {uploadShot.isPending && <p className="mt-1 text-xs text-ink-muted">{t("dash.pd.icon.uploading")}</p>}
        {shotErr && <p className="mt-1 text-xs text-danger">{shotErr}</p>}
      </Card>

      {/* danger zone */}
      <Card className="sm:col-span-2 border-danger/40">
        <h3 className="mb-1 font-semibold text-danger">{t("dash.pd.danger")}</h3>
        <p className="mb-3 text-xs text-ink-muted">{t("dash.pd.del.note")}</p>
        <Button variant="danger" size="sm" disabled={deleting} onClick={deleteProject}>
          {t("dash.pd.del.btn")}
        </Button>
      </Card>
    </div>
  );
}

const SCANNING = new Set(["uploaded", "validating"]);

// Maps a validator finding code (apps/worker/.../validation/validator.py) to a
// friendly fix-hint i18n key. Unmapped codes fall back to dash.pd.fix.generic.
const FIX_HINT: Record<string, string> = {
  SERVICE_WORKER_MISSING: "dash.pd.fix.fileMissing",
  CONTENT_SCRIPT_MISSING: "dash.pd.fix.fileMissing",
  ICON_MISSING: "dash.pd.fix.fileMissing",
  MANIFEST_VERSION: "dash.pd.fix.manifest",
  MANIFEST_NAME: "dash.pd.fix.manifest",
  MANIFEST_VERSION_FIELD: "dash.pd.fix.manifest",
  INVALID_MANIFEST: "dash.pd.fix.manifest",
  REMOTE_CODE: "dash.pd.fix.remote",
  OBFUSCATED_EVAL: "dash.pd.fix.code",
  CRYPTO_MINER: "dash.pd.fix.code",
  DISALLOWED_BINARY: "dash.pd.fix.binary",
  INVALID_ARCHIVE: "dash.pd.fix.zip",
  ZIP_BOMB: "dash.pd.fix.zip",
  TOO_MANY_FILES: "dash.pd.fix.zip",
  DIR_TOO_DEEP: "dash.pd.fix.zip",
  PATH_TRAVERSAL: "dash.pd.fix.zip",
  SYMLINK: "dash.pd.fix.zip",
};

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
      if (file.size > 200 * 1024 * 1024) throw new ApiError(413, t("dash.pd.up.toobig"));
      const fd = new FormData();
      fd.append("file", file);
      fd.append("version", version);
      fd.append("channel", channel);
      if (notes.trim()) fd.append("release_notes", notes.trim());
      return api.upload(`/projects/${project.id}/releases`, fd);
    },
    onSuccess: () => { setFile(null); setVersion(""); setNotes(""); qc.invalidateQueries({ queryKey: ["releases", project.id] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("dash.pd.upnetwork")),
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
        <details className="mb-4 rounded-md border border-line bg-surface-2 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink">{t("dash.pd.up.req.title")}</summary>
          <p className="mt-2 font-medium text-ink-muted">{t("dash.pd.up.req.must")}</p>
          <ul className="mt-1 list-inside list-disc space-y-1 text-ink-muted">
            <li>{t("dash.pd.up.req.1")}</li>
            <li>{t("dash.pd.up.req.2")}</li>
            <li>{t("dash.pd.up.req.3")}</li>
            <li>{t("dash.pd.up.req.4")}</li>
          </ul>
          <p className="mt-2 text-ink-muted">{t("dash.pd.up.req.rec")}</p>
        </details>
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
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {r.status === "uploaded" ? t("dash.pd.scanq") : t("dash.pd.scanning")}
                  </p>
                  <div className="scan-track" />
                </div>
              )}

              {/* failure reason: each error + a friendly fix hint */}
              {r.status === "validation_failed" && (() => {
                const report = r.validationReport as
                  | { errors?: { code: string; message: string; file?: string | null }[] }
                  | null | undefined;
                const errs = report?.errors?.length
                  ? report.errors
                  : r.validationError ? [{ code: "", message: r.validationError }] : [];
                if (errs.length === 0) return null;
                return (
                  <div className="mt-3 space-y-2">
                    {errs.map((err, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-danger dark:text-red-400">
                        <CircleX className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0">
                          <p>{err.message}</p>
                          <p className="mt-1 flex items-start gap-1 text-xs opacity-90"><Lightbulb className="mt-0.5 h-3 w-3 shrink-0" /><span>{t(FIX_HINT[err.code] ?? "dash.pd.fix.generic")}</span></p>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function LinksTab({ projectId, slug }: { projectId: string; slug: string }) {
  const { t, locale } = useLocale();
  const qc = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["links", projectId],
    queryFn: () => api.get<InstallLink[]>(`/projects/${projectId}/install-links`),
  });
  const create = useMutation({
    mutationFn: () => api.post<InstallLink>(`/projects/${projectId}/install-links`, { channel: "stable", linkType: "public" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["links", projectId] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/projects/${projectId}/install-links/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["links", projectId] }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      api.patch(`/projects/${projectId}/install-links/${id}`, { disabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["links", projectId] }),
  });

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  // The embeddable "Install with ExtSync" snippet: brand badge wrapped in the
  // developer's install link. Origin is taken from the install URL so it works
  // in any environment; ?lang=he gives the Hebrew badge to match the dashboard.
  const embedCode = (l: InstallLink) => {
    const origin = (() => { try { return new URL(l.url).origin; } catch { return "https://extsync.com"; } })();
    const badge = `${origin}/badge/${slug}.svg${locale === "he" ? "?lang=he" : ""}`;
    return `<a href="${l.url}"><img src="${badge}" alt="${t("dash.pd.link.embed.alt")}"></a>`;
  };

  return (
    <div className="space-y-4">
      <Button onClick={() => create.mutate()} disabled={create.isPending}>{t("dash.pd.link.create")}</Button>
      <p className="text-xs text-ink-muted">{t("dash.pd.link.embed.hint")}</p>
      <div className="space-y-2">
        {(data ?? []).map((l) => (
          <Card key={l.id} className={`flex flex-wrap items-center justify-between gap-3 ${l.disabled ? "opacity-60" : ""}`}>
            <div className="min-w-0">
              <code className="break-all text-sm text-ink">{l.url}</code>
              <p className="mt-1 text-xs text-ink-muted">
                {l.linkType} • {l.channel} • {t("dash.pd.link.uses")} {l.usedCount}{l.maxUses ? `/${l.maxUses}` : ""}
                {l.disabled && <span className="font-medium text-amber-600 dark:text-amber-400"> • {t("dash.pd.link.disabled")}</span>}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="secondary" onClick={() => copy(`url:${l.id}`, l.url)}>
                {copied === `url:${l.id}` ? t("dash.pd.link.copied") : t("dash.pd.link.copy")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => copy(`embed:${l.id}`, embedCode(l))}>
                {copied === `embed:${l.id}` ? t("dash.pd.link.copied") : t("dash.pd.link.embed")}
              </Button>
              <Button
                size="sm"
                variant={l.disabled ? "secondary" : "warning"}
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ id: l.id, disabled: !l.disabled })}
              >
                {l.disabled ? t("dash.pd.link.enable") : t("dash.pd.link.disable")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={remove.isPending}
                onClick={() => { if (confirm(t("dash.pd.link.delconfirm"))) remove.mutate(l.id); }}
              >
                {t("dash.pd.link.delete")}
              </Button>
            </div>
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
    queryFn: () =>
      api.get<{ activeInstallations: number; updates24h: { success: number; failed: number } }>(
        `/projects/${projectId}/analytics`,
      ),
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
