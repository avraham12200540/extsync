import * as React from "react";
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
    <div className="lift rounded-xl border border-line bg-surface p-5 shadow-card">
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

/** Friendly empty state: soft brand chip + message + optional action. */
export function EmptyState({
  icon, title, description, action,
}: { icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-2/40 px-6 py-14 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-muted text-brand">
        {icon}
      </div>
      <h3 className="font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
