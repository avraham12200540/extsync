"use client";

import { useLocale } from "@/components/locale-context";

/** The he<->en switch. Lives in the public header, the auth shell and the
 *  dashboard sidebar so the language can be changed from anywhere. */
export function LocaleToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const next = locale === "he" ? "en" : "he";
  return (
    <button
      onClick={() => setLocale(next)}
      aria-label={next === "en" ? "Switch to English" : "מעבר לעברית"}
      className={`rounded-md border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:border-brand/50 hover:text-ink ${className}`}
    >
      {next === "en" ? "EN" : "עב"}
    </button>
  );
}
