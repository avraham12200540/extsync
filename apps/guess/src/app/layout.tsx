import type { Metadata } from "next";
import "./globals.css";
import { DEFAULT_LOCALE, isRtl, t } from "@/lib/i18n";
import { PreferencesProvider } from "@/lib/preferences-context";

export const metadata: Metadata = {
  title: t("guess.title", DEFAULT_LOCALE),
  description: t("home.subhead", DEFAULT_LOCALE),
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = DEFAULT_LOCALE;
  return (
    <html lang={locale} dir={isRtl(locale) ? "rtl" : "ltr"} className="dark">
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <PreferencesProvider>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
