"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useLocale } from "@/components/locale-context";

/** Light<->dark switch. Matches LocaleToggle and sits beside it in the public
 *  header. Default theme is dark (set on the ThemeProvider). Shows the TARGET
 *  mode like LocaleToggle shows the target language. The `mounted` guard avoids a
 *  hydration mismatch: before mount we render the dark-default state, matching SSR. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { t } = useLocale();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const isDark = mounted ? resolvedTheme !== "light" : true;
  const target = isDark ? "light" : "dark";
  return (
    <button
      onClick={() => setTheme(target)}
      aria-label={t("theme.toggle")}
      className={`rounded-md border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:border-brand/50 hover:text-ink ${className}`}
    >
      {target === "light" ? t("theme.light") : t("theme.dark")}
    </button>
  );
}
