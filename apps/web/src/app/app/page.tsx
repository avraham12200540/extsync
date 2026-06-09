"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, Spinner } from "@/components/ui";

interface Dashboard {
  projectCount: number;
  activeInstallations: number;
  updates24h: { success: number; failed: number; rolledBack: number };
  projects: { id: string; name: string; status: string; extensionId?: string | null }[];
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${tone ?? "text-ink"}`}>{value}</p>
    </Card>
  );
}

export default function OverviewPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<Dashboard>("/dashboard"),
  });

  if (isLoading || !data) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-ink">סקירה</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="תוספים" value={data.projectCount} />
        <Stat label="התקנות פעילות" value={data.activeInstallations} />
        <Stat label="עדכונים שהצליחו (24ש')" value={data.updates24h.success} tone="text-success" />
        <Stat label="עדכונים שנכשלו (24ש')" value={data.updates24h.failed} tone="text-danger" />
      </div>

      <h2 className="mb-3 mt-10 text-lg font-semibold text-ink">התוספים שלי</h2>
      {data.projects.length === 0 ? (
        <Card className="text-center text-ink-muted">
          עדיין אין תוספים. <Link href="/app/projects" className="text-brand hover:underline">צור את הראשון</Link>.
        </Card>
      ) : (
        <div className="space-y-2">
          {data.projects.map((p) => (
            <Link key={p.id} href={`/app/projects/${p.id}`}>
              <Card className="flex items-center justify-between hover:border-brand">
                <div>
                  <p className="font-medium text-ink">{p.name}</p>
                  <p className="text-xs text-ink-muted">{p.extensionId ?? "—"}</p>
                </div>
                <span className="text-sm text-ink-muted">{p.status}</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
