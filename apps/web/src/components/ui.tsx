import * as React from "react";
import { cn } from "@/lib/utils";

export function Button({
  className, variant = "primary", size = "md", ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "warning";
  size?: "sm" | "md";
}) {
  const variants: Record<string, string> = {
    primary: "bg-brand text-brand-fg hover:bg-blue-700",
    secondary: "bg-surface-2 text-ink hover:bg-line border border-line",
    ghost: "bg-transparent text-ink hover:bg-surface-2",
    danger: "bg-danger text-white hover:bg-red-700",
    warning: "bg-warning text-white hover:bg-amber-700",
  };
  const sizes: Record<string, string> = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-sm",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant], sizes[size], className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-line bg-surface p-5 shadow-card", className)}
      {...props}
    />
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink",
        "placeholder:text-ink-muted focus:border-brand outline-none",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-sm font-medium text-ink", className)} {...props} />;
}

export function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <Label>{label}</Label>
      {children}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

const statusStyles: Record<string, string> = {
  published: "bg-green-100 text-green-800",
  ready: "bg-blue-100 text-blue-800",
  paused: "bg-amber-100 text-amber-800",
  validation_failed: "bg-red-100 text-red-800",
  revoked: "bg-red-100 text-red-800",
  uploaded: "bg-gray-100 text-gray-700",
  validating: "bg-gray-100 text-gray-700",
  superseded: "bg-gray-100 text-gray-600",
  active: "bg-green-100 text-green-800",
  draft: "bg-gray-100 text-gray-700",
};

export function Badge({ children, status }: { children: React.ReactNode; status?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
      status ? (statusStyles[status] ?? "bg-gray-100 text-gray-700") : "bg-surface-2 text-ink-muted",
    )}>
      {children}
    </span>
  );
}

export function Spinner() {
  return (
    <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" aria-label="טוען" />
  );
}
