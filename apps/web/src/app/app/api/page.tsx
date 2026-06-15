"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/components/locale-context";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { DashHeader } from "@/components/dashboard";
import { formatDate } from "@/lib/utils";

interface TokenInfo { id: string; name: string; tokenPrefix: string; lastUsedAt?: string | null; createdAt?: string | null; }

// Verified against the API routers (POST /projects/{id}/releases -> validate ->
// POST .../{releaseId}/publish). Base URL is hardcoded to the prod API in lib/api.ts.
const CURL_UPLOAD = `curl -X POST https://api.extsync.com/projects/PROJECT_ID/releases \\
  -H "Authorization: Bearer exsk_..." \\
  -F "file=@extension.zip" \\
  -F "version=1.2.3" \\
  -F "channel=stable" \\
  -F "release_notes=First release"`;

const CURL_PUBLISH = `curl -X POST https://api.extsync.com/projects/PROJECT_ID/releases/RELEASE_ID/publish \\
  -H "Authorization: Bearer exsk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"rolloutPercentage": 100}'`;

function Code({ children }: { children: string }) {
  return (
    <pre dir="ltr" className="mt-1 overflow-x-auto rounded-md border border-line bg-surface-2 p-3 text-left font-mono text-xs leading-relaxed text-ink">
      <code>{children}</code>
    </pre>
  );
}

export default function ApiTokensPage() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["tokens"], queryFn: () => api.get<TokenInfo[]>("/api-tokens") });
  const create = useMutation({
    mutationFn: () => api.post<{ token: string }>("/api-tokens", { name }),
    onSuccess: (res) => { setCreated(res.token); setName(""); qc.invalidateQueries({ queryKey: ["tokens"] }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/api-tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }),
  });

  return (
    <div>
      <DashHeader icon={<KeyRound size={20} />} title={t("dash.tk.title")} subtitle={t("dash.tk.sub")} />

      {/* What an API token is for, what you can do with it, and how to use it. */}
      <Card className="mb-6">
        <h2 className="mb-2 font-semibold text-ink">{t("dash.tk.about.title")}</h2>
        <p className="text-sm text-ink-muted">{t("dash.tk.about.intro")}</p>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-ink-muted">
          <li>{t("dash.tk.about.b1")}</li>
          <li>{t("dash.tk.about.b2")}</li>
          <li>{t("dash.tk.about.b3")}</li>
        </ul>

        <h3 className="mb-2 mt-5 font-semibold text-ink">{t("dash.tk.sec.title")}</h3>
        <ul className="list-inside list-disc space-y-1 text-sm text-ink-muted">
          <li>{t("dash.tk.sec.b1")}</li>
          <li>{t("dash.tk.sec.b2")}</li>
          <li>{t("dash.tk.sec.b3")}</li>
        </ul>

        <details className="mt-4 rounded-md border border-line bg-surface-2 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink">{t("dash.tk.usage.title")}</summary>
          <p className="mt-3 text-ink-muted">{t("dash.tk.usage.header")}</p>
          <Code>{`Authorization: Bearer exsk_...`}</Code>
          <p className="mt-3 text-ink-muted">{t("dash.tk.usage.base")}</p>
          <Code>{`https://api.extsync.com`}</Code>
          <p className="mt-4 font-medium text-ink">{t("dash.tk.usage.example")}</p>
          <p className="mt-2 text-ink-muted">{t("dash.tk.usage.step1")}</p>
          <Code>{CURL_UPLOAD}</Code>
          <p className="mt-3 text-ink-muted">{t("dash.tk.usage.step2")}</p>
          <Code>{CURL_PUBLISH}</Code>
          <p className="mt-2 text-xs text-ink-muted">{t("dash.tk.usage.ids")}</p>
        </details>
      </Card>

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-ink">{t("dash.tk.new")}</h2>
        <Field label={t("dash.tk.name")}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CI publish" /></Field>
        <Button onClick={() => create.mutate()} disabled={!name || create.isPending}>{t("dash.tk.create")}</Button>
        {created && (
          <div className="mt-4 rounded-md bg-amber-50 dark:bg-amber-400/10 p-3 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">{t("dash.tk.copy.warn")}</p>
            <code className="mt-1 block break-all text-amber-900 dark:text-amber-200">{created}</code>
          </div>
        )}
      </Card>

      {isLoading ? <Spinner /> : (
        <div className="space-y-2">
          {(data ?? []).map((tok) => (
            <Card key={tok.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium text-ink">{tok.name}</p>
                <p className="text-xs text-ink-muted">exsk_{tok.tokenPrefix}… • {t("dash.tk.created")} {formatDate(tok.createdAt)} • {t("dash.tk.lastused")} {formatDate(tok.lastUsedAt)}</p>
              </div>
              <Button size="sm" variant="danger" onClick={() => revoke.mutate(tok.id)}>{t("dash.tk.revoke")}</Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
