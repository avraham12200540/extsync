"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui";

/**
 * "Report this extension" on a store page.
 *
 * Collapsed to a small link by default: reporting is something a few people do,
 * and a large form on every extension page would read as a warning about the
 * extension itself.
 *
 * Nothing is required - no account, no reason, no email. A bare report is still
 * a useful signal, and every required field is a reason for someone not to
 * bother. The reason and email are there for people who want to say more.
 *
 * The report goes to the site administrators only, never to the developer, and
 * the form says so: someone reporting a malicious extension needs to know the
 * developer will not see it.
 */
export function ReportExtension({ slug }: { slug: string }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setState("sending");
    setError(null);
    try {
      await api.post(`/catalog/${slug}/report`, {
        reason: reason.trim() || null,
        email: email.trim() || null,
      });
      setState("sent");
    } catch (e) {
      setState("error");
      setError(e instanceof ApiError ? e.message : t("report.error"));
    }
  };

  if (state === "sent") {
    return (
      <p
        role="status"
        className="mt-4 rounded-md bg-green-50 dark:bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300"
      >
        {t("report.sent")}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand rounded"
      >
        <Flag size={13} aria-hidden="true" /> {t("report.link")}
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2/40 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Flag size={16} className="text-danger" aria-hidden="true" /> {t("report.title")}
      </h2>
      <p className="mt-1 text-xs text-ink-muted">{t("report.sub")}</p>

      <label htmlFor="report-reason" className="mt-3 block text-xs font-medium text-ink">
        {t("report.reason.label")}
      </label>
      <textarea
        id="report-reason"
        value={reason}
        onChange={(e) => { setReason(e.target.value); if (state === "error") setState("idle"); }}
        maxLength={4000}
        rows={3}
        placeholder={t("report.reason.placeholder")}
        className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted outline-none focus:border-brand"
      />

      <label htmlFor="report-email" className="mt-2 block text-xs font-medium text-ink">
        {t("report.email.label")}
      </label>
      <input
        id="report-email"
        type="email"
        value={email}
        onChange={(e) => { setEmail(e.target.value); if (state === "error") setState("idle"); }}
        maxLength={320}
        autoComplete="email"
        dir="ltr"
        placeholder="name@example.com"
        className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted outline-none focus:border-brand"
      />

      {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="danger" onClick={send} disabled={state === "sending"}>
          {state === "sending" ? t("report.sending") : t("report.send")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setOpen(false); setState("idle"); setError(null); }}
          disabled={state === "sending"}
        >
          {t("report.cancel")}
        </Button>
      </div>
    </div>
  );
}
