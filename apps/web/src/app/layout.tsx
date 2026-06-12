import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { LocaleProvider } from "@/components/locale-context";
import { getLocale } from "@/lib/locale-server";
import { isRtl } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title = locale === "en"
    ? "ExtSync - Private Chrome Extension Management"
    : "ExtSync - ניהול תוספי Chrome פרטיים";
  const description = locale === "en"
    ? "A platform to distribute, install, manage and update private Chrome extensions outside the Chrome Web Store."
    : "פלטפורמה להפצה, התקנה, ניהול ועדכון של תוספי Chrome פרטיים מחוץ ל-Chrome Web Store.";
  return {
    metadataBase: new URL("https://extsync.com"),
    title: { default: title, template: "%s | ExtSync" },
    description,
    openGraph: {
      type: "website",
      siteName: "ExtSync",
      title,
      description,
      url: "https://extsync.com",
      locale: locale === "en" ? "en_US" : "he_IL",
      images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "ExtSync" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.jpg"],
    },
    // Google Search Console HTML-tag verification: set GOOGLE_SITE_VERIFICATION
    // in Vercel env vars (no code change needed).
    ...(process.env.GOOGLE_SITE_VERIFICATION
      ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } }
      : {}),
  };
}

const SITE_JSONLD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "ExtSync",
      url: "https://extsync.com",
      logo: "https://extsync.com/logo.png",
    },
    {
      "@type": "WebSite",
      name: "ExtSync",
      url: "https://extsync.com",
      inLanguage: ["he", "en"],
    },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      dir={isRtl(locale) ? "rtl" : "ltr"}
      // Next 16 no longer suppresses CSS smooth-scrolling during navigations;
      // this attribute restores instant scroll-to-top on route changes.
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body style={{ "--font-sans": "'Segoe UI', system-ui, sans-serif" } as React.CSSProperties}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSONLD) }}
        />
        <LocaleProvider initial={locale}>
          <Providers>{children}</Providers>
        </LocaleProvider>
      </body>
    </html>
  );
}
