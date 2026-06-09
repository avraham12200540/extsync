"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Project } from "@/lib/api";
import { Badge, Button, Card, Field, Input, Spinner } from "@/components/ui";

export default function ProjectsPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<Project[]>("/projects"),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">התוספים שלי</h1>
        <Button onClick={() => setShowNew(true)}>תוסף חדש</Button>
      </div>

      {showNew && <NewProjectForm onClose={() => setShowNew(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["projects"] })} />}

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : !data || data.length === 0 ? (
        <Card className="text-center text-ink-muted">אין תוספים עדיין.</Card>
      ) : (
        <div className="space-y-2">
          {data.map((p) => (
            <Link key={p.id} href={`/app/projects/${p.id}`}>
              <Card className="flex items-center justify-between hover:border-brand">
                <div>
                  <p className="font-medium text-ink">{p.name}</p>
                  <p className="text-xs text-ink-muted">{p.extensionId ?? "טרם נוצר Extension ID"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{p.visibility === "public" ? "ציבורי" : "פרטי"}</Badge>
                  <Badge status={p.status}>{p.status}</Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NewProjectForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.post<Project>("/projects", { name, visibility, shortDescription: "" }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "שגיאה"),
  });

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold text-ink">תוסף חדש</h2>
      {error && <p className="mb-3 rounded-md bg-red-50 p-2 text-sm text-danger">{error}</p>}
      <Field label="שם התוסף">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: My Cool Extension" />
      </Field>
      <Field label="נראות">
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as "public" | "private")}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
        >
          <option value="private">פרטי (קישור סודי)</option>
          <option value="public">ציבורי</option>
        </select>
      </Field>
      <div className="flex gap-2">
        <Button onClick={() => mutation.mutate()} disabled={!name || mutation.isPending}>
          {mutation.isPending ? "יוצר…" : "יצירה"}
        </Button>
        <Button variant="ghost" onClick={onClose}>ביטול</Button>
      </div>
    </Card>
  );
}
