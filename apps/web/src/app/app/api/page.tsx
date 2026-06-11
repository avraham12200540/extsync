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
