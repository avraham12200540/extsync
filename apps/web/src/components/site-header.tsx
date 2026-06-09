"use client";

import Link from "next/link";
import { useAuth } from "@/components/providers";
import { Button } from "@/components/ui";

export function SiteHeader() {
  const { user, loading } = useAuth();
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-block h-7 w-7 rounded-md bg-brand" />
          <span className="text-lg font-semibold text-ink">ExtSync</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link href="/store" className="px-3 py-2 text-sm text-ink-muted hover:text-ink">גלריית תוספים</Link>
          <Link href="/docs" className="px-3 py-2 text-sm text-ink-muted hover:text-ink">תיעוד</Link>
          <Link href="/security" className="px-3 py-2 text-sm text-ink-muted hover:text-ink">אבטחה</Link>
          <Link href="/download" className="px-3 py-2 text-sm text-ink-muted hover:text-ink">הורדת Agent</Link>
          {!loading && (user ? (
            <Link href="/app"><Button size="sm">לוח הבקרה</Button></Link>
          ) : (
            <>
              <Link href="/login"><Button size="sm" variant="ghost">התחברות</Button></Link>
              <Link href="/register"><Button size="sm">הרשמה</Button></Link>
            </>
          ))}
        </nav>
      </div>
    </header>
  );
}
