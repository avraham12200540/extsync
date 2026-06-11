"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isRtl, LOCALE_COOKIE, t as translate, type Locale } from "@/lib/i18n";

interface LocaleState {
  locale: Locale;
  t: (key: string) => string;
  setLocale: (l: Locale) => void;
}

const LocaleContext = createContext<LocaleState>({
  locale: "he",
  t: (k) => translate(k, "he"),
  setLocale: () => {},
});

export const useLocale = () => useContext(LocaleContext);

/** Locale lives in a cookie so SERVER components render the right language too;
 *  switching updates the cookie + <html lang/dir> and refreshes the RSC tree. */
export function LocaleProvider({ initial, children }: { initial: Locale; children: React.ReactNode }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initial);

  const value = useMemo<LocaleState>(() => ({
    locale,
    t: (key: string) => translate(key, locale),
    setLocale: (l: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = l;
      document.documentElement.dir = isRtl(l) ? "rtl" : "ltr";
      setLocaleState(l);
      router.refresh();
    },
  }), [locale, router]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
