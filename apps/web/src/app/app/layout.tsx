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

  const navLinks = nav.map((item) => {
    const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ${
          active ? "bg-brand-muted font-medium text-brand" : "text-ink-muted hover:bg-surface-2"
        }`}
      >
        {item.label}
      </Link>
    );
  });

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Sidebar (desktop) / top bar (mobile) */}
      <aside className="shrink-0 border-b border-line bg-surface p-3 md:w-60 md:border-b-0 md:border-l md:p-4">
        <div className="flex items-center justify-between md:mb-6 md:block">
          <Link href="/app" className="flex items-center gap-2">
            <span className="inline-block h-7 w-7 rounded-md bg-brand" />
            <span className="font-semibold text-ink">ExtSync</span>
          </Link>
          <Button variant="ghost" size="sm" className="md:hidden" onClick={() => logout().then(() => router.push("/"))}>
            התנתקות
          </Button>
        </div>

        {/* horizontal scroll on mobile, vertical on desktop */}
        <nav className="mt-2 flex gap-1 overflow-x-auto md:mt-0 md:flex-col md:overflow-visible">
          {navLinks}
        </nav>

        <div className="mt-8 hidden border-t border-line pt-4 md:block">
          <p className="truncate text-xs text-ink-muted">{user.email}</p>
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => logout().then(() => router.push("/"))}>
            התנתקות
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-4 sm:p-6 md:p-8">{children}</main>
    </div>
  );
}
