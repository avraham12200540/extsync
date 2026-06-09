"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/providers";
import { Button } from "@/components/ui";

const links = [
  { href: "/store", label: "גלריית תוספים" },
  { href: "/docs", label: "תיעוד" },
  { href: "/security", label: "אבטחה" },
  { href: "/download", label: "הורדת Agent" },
];

export function SiteHeader() {
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);

  const authButtons = (
    <>
      {!loading && (user ? (
        <Link href="/app" onClick={() => setOpen(false)}><Button size="sm">לוח הבקרה</Button></Link>
      ) : (
        <>
          <Link href="/login" onClick={() => setOpen(false)}><Button size="sm" variant="ghost">התחברות</Button></Link>
          <Link href="/register" onClick={() => setOpen(false)}><Button size="sm">הרשמה</Button></Link>
        </>
      ))}
    </>
  );

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex items-center justify-between py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="inline-block h-7 w-7 rounded-md bg-brand" />
            <span className="text-lg font-semibold text-ink">ExtSync</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">
                {l.label}
              </Link>
            ))}
            {authButtons}
          </nav>

          {/* Mobile: primary auth + hamburger */}
          <div className="flex items-center gap-2 md:hidden">
            {authButtons}
            <button
              onClick={() => setOpen((v) => !v)}
              aria-label="תפריט"
              aria-expanded={open}
              className="rounded-md p-2 text-ink hover:bg-surface-2"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {open && (
          <nav className="flex flex-col gap-1 border-t border-line py-2 md:hidden">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
