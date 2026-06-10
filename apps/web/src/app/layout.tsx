import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

const SITE_DESCRIPTION =
  "פלטפורמה להפצה, התקנה, ניהול ועדכון של תוספי Chrome פרטיים מחוץ ל-Chrome Web Store.";

export const metadata: Metadata = {
  metadataBase: new URL("https://extsync.com"),
  title: {
    default: "ExtSync - ניהול תוספי Chrome פרטיים",
    template: "%s | ExtSync",
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "ExtSync",
    title: "ExtSync - ניהול תוספי Chrome פרטיים",
    description: SITE_DESCRIPTION,
    url: "https://extsync.com",
    locale: "he_IL",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "ExtSync" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ExtSync - ניהול תוספי Chrome פרטיים",
    description: SITE_DESCRIPTION,
    images: ["/og.jpg"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <body style={{ ["--font-sans" as any]: "'Segoe UI', system-ui, sans-serif" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
