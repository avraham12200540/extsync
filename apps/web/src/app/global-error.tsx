"use client";

import { useEffect } from "react";

// Last-resort boundary for errors in the root layout itself. It replaces the
// whole document, so it cannot use the locale context or app styles - keep it
// fully self-contained and bilingual.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="he" dir="rtl">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          padding: "1.5rem",
          background: "#0b1220",
          color: "#e2e8f0",
          textAlign: "center",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>משהו השתבש</h1>
          <p style={{ color: "#94a3b8", margin: "0 0 1.5rem" }}>
            אירעה שגיאה בלתי צפויה. / An unexpected error occurred.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.6rem 1.5rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#2563EB",
              color: "#fff",
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
          >
            נסה שוב / Try again
          </button>
        </div>
      </body>
    </html>
  );
}
