import { DEFAULT_LOCALE, t } from "@/lib/i18n";

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6">
      <p className="text-sm text-ink-muted">{t("state.loading", DEFAULT_LOCALE)}</p>
    </main>
  );
}
