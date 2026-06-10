"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/providers";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui";

const links = [
  { href: "/", label: "בית" },
  { href: "/store", label: "גלריית תוספים" },
  { href: "/download", label: "הורדת התוכנה" },
  { href: "/docs", label: "תיעוד" },
  { href: "/security", label: "אבטחה" },
];

export function SiteHeader() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const authButtons = (
    <>
      {!loading && (user ? (
        <Link href="/app" onClick={() => setOpen(false)}><Button size="sm">לוח הבקרה</Button></Link>
      ) : (
        <>
          <Link href="/login" onClick={() => setOpen(false)}><Button size="sm" variant="ghost">התחברות</Button></Link>
          <Link href="/register" onClick={() => setOpen(false)}>
            <Button size="sm" className="bg-brand-gradient border-0 shadow-glow">הרשמת מפתחים</Button>
          </Link>
        </>
      ))}
    </>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-surface/80 backdrop-blur-lg">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex items-center justify-between py-3">
          <Link href="/" aria-label="ExtSync - דף הבית">
            <Logo size={34} />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`relative px-3 py-2 text-sm transition-colors ${
                    active ? "font-semibold text-brand" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {l.label}
                  {active && (
                    <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-brand-gradient" />
                  )}
                </Link>
              );
            })}
            <span className="mx-2 h-5 w-px bg-line" />
            {authButtons}
          </nav>

          {/* Mobile */}
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

        {open && (
          <nav className="flex flex-col gap-1 border-t border-line py-2 md:hidden">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`rounded-md px-3 py-2 text-sm ${
                  pathname === l.href ? "bg-brand-muted font-medium text-brand" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                }`}
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
