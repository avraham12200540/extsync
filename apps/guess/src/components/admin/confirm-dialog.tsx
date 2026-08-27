"use client";

import { useTranslation } from "@/lib/use-translation";
import { Dialog } from "./dialog";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  pending?: boolean;
  /** Impact-proportional styling - "danger" (reject/force-ineligible/import trigger) gets a visually distinct confirm action from "neutral" (approve/force-eligible), without relying on color alone (the label itself always states the action). */
  tone?: "neutral" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

/** Generic confirmation dialog reused by every admin mutation that needs a deliberate extra step before acting - approve/reject, eligibility override, import trigger, revoke-other-sessions. */
export function ConfirmDialog({ open, title, body, confirmLabel, pending = false, tone = "neutral", onConfirm, onCancel }: ConfirmDialogProps) {
  const t = useTranslation();

  return (
    <Dialog open={open} titleId="admin-confirm-dialog-title" title={title} onDismiss={onCancel}>
      <p className="mt-2 text-sm text-ink-muted">{body}</p>
      <div className="mt-5 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="text-sm text-ink-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
        >
          {t("admin.confirm.cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={`rounded border px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50 ${
            tone === "danger" ? "border-ink bg-ink text-bg" : "border-accent bg-accent text-accent-ink"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
