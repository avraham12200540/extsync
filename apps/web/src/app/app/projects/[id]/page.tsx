"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type InstallLink, type Project, type Release } from "@/lib/api";
import { Badge, Button, Card, Field, Input, Spinner } from "@/components/ui";
import { formatDate } from "@/lib/utils";

type Tab = "overview" | "versions" | "links" | "analytics";

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [tab, setTab] = useState<Tab>("overview");
  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.get<Project>(`/projects/${id}`),
  });

  if (isLoading || !project) return <div className="flex justify-center py-20"><Spinner /></div>;

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "סקירה" },
    { id: "versions", label: "גרסאות" },
    { id: "links", label: "קישורי התקנה" },
    { id: "analytics", label: "Analytics" },
  ];

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-ink">{project.name}</h1>
        <Badge status={project.status}>{project.status}</Badge>
      </div>
      <p className="mb-6 text-sm text-ink-muted">Extension ID: {project.extensionId ?? "—"}</p>

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
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <h3 className="mb-2 font-semibold text-ink">פרטים</h3>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-ink-muted">Slug</dt><dd className="text-ink">{project.slug}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">נראות</dt><dd className="text-ink">{project.visibility}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">מצב Bridge</dt><dd className="text-ink">{project.bridgeMode}</dd></div>
        </dl>
      </Card>
      <Card>
        <h3 className="mb-2 font-semibold text-ink">{project.shortDescription || "אין תיאור"}</h3>
        <p className="text-sm text-ink-muted">{project.fullDescription}</p>
      </Card>
    </div>
  );
}

function VersionsTab({ project }: { project: Project }) {
  const qc = useQueryClient();
  const { data: releases } = useQuery({
    queryKey: ["releases", project.id],
    queryFn: () => api.get<Release[]>(`/projects/${project.id}/releases`),
    refetchInterval: 4000, // reflect worker validation progress
  });

  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [channel, setChannel] = useState("stable");
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new ApiError(400, "בחר קובץ ZIP");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("version", version);
      fd.append("channel", channel);
      return api.upload(`/projects/${project.id}/releases`, fd);
    },
    onSuccess: () => { setFile(null); setVersion(""); qc.invalidateQueries({ queryKey: ["releases", project.id] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "ההעלאה נכשלה"),
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

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="mb-4 font-semibold text-ink">העלאת גרסה</h3>
        {error && <p className="mb-3 rounded-md bg-red-50 p-2 text-sm text-danger">{error}</p>}
        <Field label="קובץ ZIP של התוסף">
          <input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                 className="block w-full text-sm text-ink-muted" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="גרסה (כמו ב-manifest)"><Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" /></Field>
          <Field label="ערוץ">
            <select value={channel} onChange={(e) => setChannel(e.target.value)}
                    className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
              <option value="stable">Stable</option>
              <option value="beta">Beta</option>
              <option value="nightly">Nightly</option>
            </select>
          </Field>
        </div>
        <Button onClick={() => upload.mutate()} disabled={!file || !version || upload.isPending}>
          {upload.isPending ? "מעלה…" : "העלאה"}
        </Button>
      </Card>

      <div className="space-y-2">
        {(releases ?? []).map((r) => (
          <Card key={r.id} className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">v{r.version}</span>
                <Badge>{r.channel}</Badge>
                <Badge status={r.status}>{r.status}</Badge>
                {r.permissionsChanged && <Badge>שינוי הרשאות</Badge>}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {formatDate(r.createdAt)} • סיכון {r.riskScore} • seq {r.sequence ?? "—"}
              </p>
            </div>
            <div className="flex gap-2">
              {r.status === "ready" && (
                <Button size="sm" onClick={() => publish.mutate(r.id)} disabled={publish.isPending}>פרסום</Button>
              )}
              {(r.status === "superseded" || r.status === "published") && (
                <Button size="sm" variant="warning" onClick={() => rollback.mutate(r.id)}>Rollback לכאן</Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function LinksTab({ projectId }: { projectId: string }) {
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
      <Button onClick={() => create.mutate()} disabled={create.isPending}>יצירת קישור התקנה</Button>
      <div className="space-y-2">
        {(data ?? []).map((l) => (
          <Card key={l.id} className="flex items-center justify-between">
            <div>
              <code className="text-sm text-ink">{l.url}</code>
              <p className="mt-1 text-xs text-ink-muted">
                {l.linkType} • {l.channel} • שימושים: {l.usedCount}{l.maxUses ? `/${l.maxUses}` : ""}
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(l.url)}>העתק</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AnalyticsTab({ projectId }: { projectId: string }) {
  const { data } = useQuery({
    queryKey: ["analytics", projectId],
    queryFn: () => api.get<any>(`/projects/${projectId}/analytics`),
  });
  if (!data) return <Spinner />;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card><p className="text-sm text-ink-muted">התקנות פעילות</p><p className="text-2xl font-semibold text-ink">{data.activeInstallations}</p></Card>
      <Card><p className="text-sm text-ink-muted">עדכונים שהצליחו (24ש')</p><p className="text-2xl font-semibold text-success">{data.updates24h.success}</p></Card>
      <Card><p className="text-sm text-ink-muted">כשלים (24ש')</p><p className="text-2xl font-semibold text-danger">{data.updates24h.failed}</p></Card>
    </div>
  );
}
