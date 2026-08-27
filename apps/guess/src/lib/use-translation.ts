"use client";

import { t } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences-context";

export function useTranslation() {
  const { locale } = usePreferences();
  return (key: string, params?: Record<string, string | number>) => t(key, locale, params);
}
