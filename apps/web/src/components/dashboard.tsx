"use client";

import * as React from "react";
import { useLocale } from "@/components/locale-context";
import { cn } from "@/lib/utils";

/** Consistent dashboard page header: gradient icon chip + title + optional action. */
export function DashHeader({
  icon, title, subtitle, action,
}: { icon?: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {icon && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-glow">
            {icon}
          </span>
        )}
        <div>
          <h1 className="text-2xl font-bold leading-tight text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Stat tile with a tinted icon chip, used on the overview. */
export function StatCard({
  icon, label, value, tone = "text-ink", iconClass = "bg-brand-gradient",
}: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: string; iconClass?: string }) {
  return (
    <div className="glass-tile rounded-xl p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">{label}</p>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white shadow-glow", iconClass)}>
          {icon}
        </span>
      </div>
      <p className={cn("mt-3 text-3xl font-bold", tone)}>{value}</p>
    </div>
  );
}

export interface TrendDay { date: string; success: number; failed: number; installs: number }

/** Dependency-free SVG chart: stacked update bars (success/failed) + installs line. */
export function TrendChart({ days }: { days: TrendDay[] }) {
  const { t } = useLocale();
  const W = 560, H = 150, PX = 6, PT = 8, PB = 22;
  const plotW = W - PX * 2, plotH = H - PT - PB;
  const max = Math.max(1, ...days.map((d) => Math.max(d.success + d.failed, d.installs)));
  const step = plotW / days.length;
  const barW = Math.max(4, step * 0.55);
  const y = (v: number) => PT + plotH - (v / max) * plotH;
  const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const line = days
    .map((d, i) => `${PX + i * step + step / 2},${y(d.installs)}`)
    .join(" ");

  return (
    <div dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="גרף עדכונים והתקנות">
        {/* baseline */}
        <line x1={PX} y1={PT + plotH} x2={W - PX} y2={PT + plotH}
              stroke="currentColor" strokeOpacity="0.15" />
        {days.map((d, i) => {
          const x = PX + i * step + (step - barW) / 2;
          const hS = (d.success / max) * plotH;
          const hF = (d.failed / max) * plotH;
          return (
            <g key={d.date}>
              {hF > 0 && (
                <rect x={x} y={y(d.success + d.failed)} width={barW} height={hF}
                      rx="2" fill="#dc2626" opacity="0.9" />
              )}
              {hS > 0 && (
                <rect x={x} y={y(d.success)} width={barW} height={hS}
                      rx="2" fill="#16a34a" opacity="0.9" />
              )}
              <title>{`${fmt(d.date)}: ${d.success} הצליחו, ${d.failed} נכשלו, ${d.installs} התקנות`}</title>
            </g>
          );
        })}
        <polyline points={line} fill="none" stroke="#0FB5BA" strokeWidth="2"
                  strokeLinejoin="round" strokeLinecap="round" />
        {days.map((d, i) => (
          d.installs > 0 ? (
            <circle key={d.date} cx={PX + i * step + step / 2} cy={y(d.installs)} r="2.5" fill="#0FB5BA" />
          ) : null
        ))}
        <text x={PX} y={H - 6} fontSize="10" fill="currentColor" opacity="0.55">{fmt(days[0]?.date ?? "")}</text>
        <text x={W - PX} y={H - 6} fontSize="10" fill="currentColor" opacity="0.55" textAnchor="end">
          {fmt(days[days.length - 1]?.date ?? "")}
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-success" /> {t("dash.trend.ok")}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-danger" /> {t("dash.trend.fail")}</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-brand-teal" /> {t("dash.trend.installs")}</span>
      </div>
    </div>
  );
}

/** Friendly empty state: soft brand chip + message + optional action. */
export function EmptyState({
  icon, title, description, action,
}: { icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-2/40 px-6 py-14 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-muted dark:bg-brand/20 text-brand">
        {icon}
      </div>
      <h3 className="font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
