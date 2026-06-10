"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Puzzle, Plus } from "lucide-react";
import { api, ApiError, type Project } from "@/lib/api";
import { Badge, Button, Card, Field, Input, Spinner } from "@/components/ui";
import { DashHeader, EmptyState } from "@/components/dashboard";

export default function ProjectsPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<Project[]>("/projects"),
  });

  return (
    <div>
      <DashHeader
        icon={<Puzzle size={20} />}
        title="התוספים שלי"
        subtitle="ניהול התוספים, הגרסאות והפרסום."
        action={<Button onClick={() => setShowNew(true)} className="gap-1.5"><Plus size={16} /> תוסף חדש</Button>}
      />

      {showNew && <NewProjectForm onClose={() => setShowNew(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["projects"] })} />}

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={<Puzzle size={30} />}
          title="אין תוספים עדיין"
          description="צור תוסף חדש כדי להתחיל - תוכל להעלות ZIP, לחתום ולפרסם בלחיצה."
          action={<Button onClick={() => setShowNew(true)} className="gap-1.5"><Plus size={16} /> תוסף חדש</Button>}
        />
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
      {error && <p className="mb-3 rounded-md bg-red-50 dark:bg-red-500/10 p-2 text-sm text-danger dark:text-red-400">{error}</p>}
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
