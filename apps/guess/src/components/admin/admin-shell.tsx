"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { revokeOtherAdminSessions } from "@/lib/admin-client";
import { PreferencesToggle } from "@/components/preferences-toggle";
import { useTranslation } from "@/lib/use-translation";
import { ReauthDialog } from "./reauth-dialog";

const NAV_ITEMS = [
  { href: "/admin", labelKey: "admin.nav.overview" },
  { href: "/admin/users", labelKey: "admin.nav.users" },
  { href: "/admin/moderation", labelKey: "admin.nav.moderation" },
  { href: "/admin/imports", labelKey: "admin.nav.imports" },
] as const;

// usePathname() (see the layout) never includes basePath - matching every
// other client-side Next.js routing API (Link/useRouter), unlike a plain
// fetch() URL, which must always be written out in full.
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The authenticated admin shell: a compact nav rail on desktop, a
 * collapsible header menu on narrow widths. Deliberately dense/quiet -
 * text-only navigation, no icon set, no cards, no color-block active
 * states beyond an underline and the shared restrained accent.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const t = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { email, sessionExpiresAt, logout, withReauth } = useAdminAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeMessage, setRevokeMessage] = useState<string | null>(null);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      router.replace("/admin/login");
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleRevokeOthers() {
    setRevoking(true);
    setRevokeMessage(null);
    try {
      const result = await withReauth(() => revokeOtherAdminSessions());
      setRevokeMessage(t("admin.nav.revokeOthersSuccess", { count: result.revokedCount }));
    } finally {
      setRevoking(false);
    }
  }

  const expiresLabel = sessionExpiresAt
    ? t("admin.nav.sessionExpiresLabel", { time: new Date(sessionExpiresAt).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" }) })
    : "";

  const navLinks = (
    <nav aria-label={t("admin.nav.brand")} className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
            className={`rounded px-3 py-2 text-sm transition-colors ${active ? "bg-line/60 font-medium text-ink" : "text-ink-muted hover:text-ink"}`}
          >
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen md:flex">
      <ReauthDialog />

      <header className="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
        <span className="text-sm font-semibold text-ink">{t("admin.nav.brand")}</span>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="admin-mobile-nav"
          onClick={() => setMenuOpen((v) => !v)}
          className="text-sm text-ink-muted underline decoration-line underline-offset-4 hover:text-ink"
        >
          {t("admin.nav.menuToggle")}
        </button>
      </header>
      {menuOpen && (
        <div id="admin-mobile-nav" className="border-b border-line px-4 py-3 md:hidden">
          {navLinks}
        </div>
      )}

      <aside className="hidden w-56 shrink-0 flex-col border-e border-line px-4 py-6 md:flex">
        <span className="mb-6 text-sm font-semibold text-ink">{t("admin.nav.brand")}</span>
        {navLinks}
        <div className="mt-auto flex flex-col gap-2 border-t border-line pt-4 text-xs text-ink-muted">
          <PreferencesToggle />
          {email && (
            <span dir="auto" className="truncate text-ink">
              {email}
            </span>
          )}
          {expiresLabel && <span>{expiresLabel}</span>}
          <button type="button" onClick={() => void handleRevokeOthers()} disabled={revoking} className="text-start underline decoration-line underline-offset-4 hover:text-ink disabled:opacity-50">
            {revoking ? t("admin.nav.revokingOthers") : t("admin.nav.revokeOthers")}
          </button>
          <button type="button" onClick={() => void handleLogout()} disabled={loggingOut} className="text-start underline decoration-line underline-offset-4 hover:text-ink disabled:opacity-50">
            {loggingOut ? t("admin.nav.loggingOut") : t("admin.nav.logout")}
          </button>
          <p role="status" className="min-h-[1em]">
            {revokeMessage}
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
