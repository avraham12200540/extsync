"use client";

import { usePreferences } from "@/lib/preferences-context";
import { useTranslation } from "@/lib/use-translation";

/** Deliberately quiet: text links, no icon buttons, no pill/badge chrome. */
export function PreferencesToggle() {
  const { locale, theme, setLocale, setTheme } = usePreferences();
  const t = useTranslation();

  return (
    <div className="flex items-center gap-3 text-sm text-ink-muted">
      <button type="button" onClick={() => setLocale(locale === "he" ? "en" : "he")} className="transition-colors hover:text-ink">
        {t("nav.language")}
      </button>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="transition-colors hover:text-ink">
        {theme === "dark" ? t("nav.themeLight") : t("nav.themeDark")}
      </button>
    </div>
  );
}
