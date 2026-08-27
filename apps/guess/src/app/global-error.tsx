"use client";

import type { CSSProperties } from "react";

// Only rendered if the root layout itself throws, so it cannot depend on
// PreferencesProvider/i18n/Tailwind (global-error renders its own <html>/
// <body> outside the normal layout tree and does not receive globals.css -
// see Next.js's global-error docs). Plain inline styles only, static
// Hebrew-default copy matching the rest of the app's default locale.
const pageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "1rem",
  padding: "1.5rem",
  textAlign: "center",
  backgroundColor: "rgb(15 15 16)",
  color: "rgb(237 237 239)",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Hebrew', 'Arial Hebrew', Arial, sans-serif",
};

const buttonStyle: CSSProperties = {
  borderRadius: "4px",
  border: "1px solid rgb(237 237 239)",
  backgroundColor: "rgb(237 237 239)",
  color: "rgb(15 15 16)",
  padding: "0.625rem 1.5rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  cursor: "pointer",
};

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="he" dir="rtl">
      <body style={{ margin: 0 }}>
        <main style={pageStyle}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>קרתה תקלה</h1>
          <p style={{ fontSize: "0.875rem", color: "rgb(158 158 164)", margin: 0 }}>אפשר לנסות לרענן את הדף</p>
          <button type="button" onClick={reset} style={buttonStyle}>
            נסו שוב
          </button>
        </main>
      </body>
    </html>
  );
}
