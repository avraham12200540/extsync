import type { Metadata } from "next";
import { headers } from "next/headers";
import { Assistant } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { LocaleProvider } from "@/components/locale-context";
import { getLocale } from "@/lib/locale-server";
import { isRtl } from "@/lib/i18n";
import { safeJsonLd } from "@/lib/utils";

// Hebrew-first UI font. Self-hosted by next/font (downloaded at build, served
// same-origin) so it works under the strict `font-src 'self'` CSP. Variable font
// -> full weight range; exposed as --font-sans (consumed by tailwind fontFamily.sans).
const assistant = Assistant({ subsets: ["hebrew", "latin"], variable: "--font-sans", display: "swap" });

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
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang={locale}
      className={assistant.variable}
      dir={isRtl(locale) ? "rtl" : "ltr"}
      // Next 16 no longer suppresses CSS smooth-scrolling during navigations;
      // this attribute restores instant scroll-to-top on route changes.
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body>
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: safeJsonLd(SITE_JSONLD) }}
        />
        <LocaleProvider initial={locale}>
          <Providers nonce={nonce}>{children}</Providers>
        </LocaleProvider>
      </body>
    </html>
  );
}
