"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { Locale } from "@/lib/i18n";
import { DEFAULT_LOCALE, isRtl } from "@/lib/i18n";

export type Theme = "light" | "dark";
const DEFAULT_THEME: Theme = "dark";

const LOCALE_STORAGE_KEY = "guess:locale";
const THEME_STORAGE_KEY = "guess:theme";

interface PreferencesValue {
  locale: Locale;
  theme: Theme;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: Theme) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

/**
 * A minimal `useSyncExternalStore`-compatible store over one localStorage
 * key. `getServerSnapshot` (and the client's first pre-hydration render)
 * always returns `defaultValue`, exactly like the effect-based version this
 * replaced - `getSnapshot` only reads the real stored value once hydration
 * lets it touch `window`, so there is still no SSR/client markup mismatch
 * on first paint, without setting state from inside an effect.
 */
function createStoredPreference<T extends string>(key: string, defaultValue: T, isValid: (value: string) => value is T) {
  let current = defaultValue;
  let hydrated = false;
  const listeners = new Set<() => void>();

  return {
    getSnapshot(): T {
      if (!hydrated) {
        hydrated = true;
        const stored = window.localStorage.getItem(key);
        if (stored !== null && isValid(stored)) current = stored;
      }
      return current;
    },
    getServerSnapshot(): T {
      return defaultValue;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: T): void {
      current = next;
      window.localStorage.setItem(key, next);
      listeners.forEach((listener) => listener());
    },
  };
}

const localeStore = createStoredPreference<Locale>(LOCALE_STORAGE_KEY, DEFAULT_LOCALE, (v): v is Locale => v === "he" || v === "en");
const themeStore = createStoredPreference<Theme>(THEME_STORAGE_KEY, DEFAULT_THEME, (v): v is Theme => v === "light" || v === "dark");

/**
 * Purely a UI preference store (theme/language), never session or CSRF
 * data - localStorage is an appropriate, low-stakes place for this, unlike
 * the tokens guess-client.ts handles.
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(localeStore.subscribe, localeStore.getSnapshot, localeStore.getServerSnapshot);
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, themeStore.getServerSnapshot);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? "rtl" : "ltr";
  }, [locale]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const setLocale = useCallback((next: Locale) => {
    localeStore.set(next);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    themeStore.set(next);
  }, []);

  const value = useMemo(() => ({ locale, theme, setLocale, setTheme }), [locale, theme, setLocale, setTheme]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within a PreferencesProvider");
  return ctx;
}
