"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { LayoutDashboard, Puzzle, MonitorSmartphone, CircleCheck, CircleX } from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/components/locale-context";
import { Card, Spinner } from "@/components/ui";
import { DashHeader, StatCard, EmptyState, TrendChart, type TrendDay } from "@/components/dashboard";

interface Dashboard {
  projectCount: number;
  activeInstallations: number;
  updates24h: { success: number; failed: number; rolledBack: number };
  projects: { id: string; name: string; status: string; extensionId?: string | null }[];
}

export default function OverviewPage() {
  const { t } = useLocale();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<Dashboard>("/dashboard"),
  });
  const { data: series } = useQuery({
    queryKey: ["dashboard-timeseries"],
    queryFn: () => api.get<{ days: TrendDay[] }>("/dashboard/timeseries"),
  });

  if (isLoading || !data) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div>
      <DashHeader icon={<LayoutDashboard size={20} />} title={t("dash.ov.title")} subtitle={t("dash.ov.sub")} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Puzzle size={18} />} label={t("dash.ov.ext")} value={data.projectCount} />
        <StatCard icon={<MonitorSmartphone size={18} />} label={t("dash.ov.installs")} value={data.activeInstallations} />
        <StatCard icon={<CircleCheck size={18} />} label={t("dash.ov.ok24")} value={data.updates24h.success} tone="text-success" iconClass="bg-success" />
        <StatCard icon={<CircleX size={18} />} label={t("dash.ov.fail24")} value={data.updates24h.failed} tone="text-danger" iconClass="bg-danger" />
      </div>

      {series && series.days.some((d) => d.success || d.failed || d.installs) && (
        <>
          <h2 className="mb-3 mt-10 text-lg font-semibold text-ink">{t("dash.ov.trend")}</h2>
          <Card><TrendChart days={series.days} /></Card>
        </>
      )}

      <h2 className="mb-3 mt-10 text-lg font-semibold text-ink">{t("dash.ov.mine")}</h2>
      {data.projects.length === 0 ? (
        <EmptyState
          icon={<Puzzle size={30} />}
          title={t("dash.ov.empty.t")}
          description={t("dash.ov.empty.d")}
          action={<Link href="/app/projects" className="text-sm font-medium text-brand hover:underline">{t("dash.ov.empty.cta")}</Link>}
        />
      ) : (
        <div className="space-y-2">
          {data.projects.map((p) => (
            <Link key={p.id} href={`/app/projects/${p.id}`}>
              <Card className="flex items-center justify-between hover:border-brand">
                <div>
                  <p className="font-medium text-ink">{p.name}</p>
                  <p className="text-xs text-ink-muted">{p.extensionId ?? "-"}</p>
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
