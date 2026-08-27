"use client";

import Link from "next/link";
import { useTranslation } from "@/lib/use-translation";

// error/error.digest are deliberately never rendered - no stack traces or internal identifiers reach the user.
export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslation();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold text-ink">{t("state.crashTitle")}</h1>
      <p className="text-sm text-ink-muted">{t("state.crashBody")}</p>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="rounded border border-ink bg-ink px-6 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
        >
          {t("state.retry")}
        </button>
        <Link href="/" className="text-sm text-ink-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink">
          {t("state.backHome")}
        </Link>
      </div>
    </main>
  );
}
