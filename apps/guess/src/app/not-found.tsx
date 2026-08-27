"use client";

import Link from "next/link";
import { useTranslation } from "@/lib/use-translation";

export default function NotFound() {
  const t = useTranslation();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold text-ink">{t("state.notFoundTitle")}</h1>
      <p className="text-sm text-ink-muted">{t("state.notFoundBody")}</p>
      <Link
        href="/"
        className="rounded border border-ink bg-ink px-6 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
      >
        {t("state.backHome")}
      </Link>
    </main>
  );
}
