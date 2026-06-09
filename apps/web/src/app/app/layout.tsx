"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/providers";
import { Button, Spinner } from "@/components/ui";

const nav = [
  { href: "/app", label: "סקירה" },
  { href: "/app/projects", label: "תוספים" },
  { href: "/app/team", label: "צוות" },
  { href: "/app/api", label: "API" },
  { href: "/app/settings", label: "הגדרות" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-l border-line bg-surface p-4">
        <Link href="/app" className="mb-6 flex items-center gap-2">
          <span className="inline-block h-7 w-7 rounded-md bg-brand" />
          <span className="font-semibold text-ink">ExtSync</span>
        </Link>
        <nav className="space-y-1">
          {nav.map((item) => {
            const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm ${
                  active ? "bg-brand-muted font-medium text-brand" : "text-ink-muted hover:bg-surface-2"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-8 border-t border-line pt-4">
          <p className="truncate text-xs text-ink-muted">{user.email}</p>
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => logout().then(() => router.push("/"))}>
            התנתקות
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
