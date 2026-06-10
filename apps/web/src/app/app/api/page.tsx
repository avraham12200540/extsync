"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { DashHeader } from "@/components/dashboard";
import { formatDate } from "@/lib/utils";

interface TokenInfo { id: string; name: string; tokenPrefix: string; lastUsedAt?: string | null; createdAt?: string | null; }

export default function ApiTokensPage() {
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
      <DashHeader icon={<KeyRound size={20} />} title="API Tokens" subtitle="טוקנים לפרסום אוטומטי מ-CLI או CI." />
      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-ink">יצירת טוקן חדש (ל-CLI / CI)</h2>
        <Field label="שם הטוקן"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CI publish" /></Field>
        <Button onClick={() => create.mutate()} disabled={!name || create.isPending}>יצירה</Button>
        {created && (
          <div className="mt-4 rounded-md bg-amber-50 dark:bg-amber-400/10 p-3 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">העתק עכשיו - הטוקן יוצג פעם אחת בלבד:</p>
            <code className="mt-1 block break-all text-amber-900 dark:text-amber-200">{created}</code>
          </div>
        )}
      </Card>

      {isLoading ? <Spinner /> : (
        <div className="space-y-2">
          {(data ?? []).map((t) => (
            <Card key={t.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium text-ink">{t.name}</p>
                <p className="text-xs text-ink-muted">exsk_{t.tokenPrefix}… • נוצר {formatDate(t.createdAt)} • שימוש אחרון {formatDate(t.lastUsedAt)}</p>
              </div>
              <Button size="sm" variant="danger" onClick={() => revoke.mutate(t.id)}>ביטול</Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
