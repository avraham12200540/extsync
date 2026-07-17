"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, LibraryBig, Puzzle, Users, KeyRound, Inbox, Settings as SettingsIcon, LogOut } from "lucide-react";
import { useAuth } from "@/components/providers";
import { useLocale } from "@/components/locale-context";
import { LocaleToggle } from "@/components/locale-toggle";
import { api, ApiError } from "@/lib/api";
import { FeedbackBadge } from "@/components/feedback-badge";
import { Logo } from "@/components/logo";
import { Button, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

function VerifyEmailBanner({ email }: { email: string }) {
  const { t } = useLocale();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const resend = async () => {
    setState("sending");
    try {
      await api.post("/auth/resend-verification");
      setState("sent");
    } catch (e) {
      setState(e instanceof ApiError && e.status === 429 ? "sent" : "error");
    }
  };
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-300 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-400/10 p-3 text-sm text-amber-900 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
      <span>
        {t("dash.verify.pre")} <b>{email}</b> {t("dash.verify.post")}
        {state === "sent" && ` ${t("dash.verify.sent")}`}
        {state === "error" && ` ${t("dash.verify.failed")}`}
      </span>
      {state !== "sent" && (
        <Button size="sm" variant="warning" disabled={state === "sending"} onClick={resend}>
          {state === "sending" ? t("dash.verify.sending") : t("dash.verify.send")}
        </Button>
      )}
    </div>
  );
}

// devOnly items are hidden for a personal (end_user) account.
const nav = [
  { href: "/app", key: "dash.nav.overview", icon: LayoutDashboard, devOnly: true },
  { href: "/app/library", key: "dash.nav.library", icon: LibraryBig },
  { href: "/app/projects", key: "dash.nav.extensions", icon: Puzzle, devOnly: true },
  { href: "/app/feedback", key: "dash.nav.feedback", icon: Inbox, devOnly: true },
  { href: "/app/team", key: "dash.nav.team", icon: Users, devOnly: true },
  { href: "/app/api", key: "dash.nav.api", icon: KeyRound, devOnly: true },
  { href: "/app/settings", key: "dash.nav.settings", icon: SettingsIcon },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  // Team/admin roles have developer access too; only a plain end_user is limited.
  const isDeveloper = !!user && user.role !== "end_user" && user.role !== "guest";
  // Overview + projects/team/api are developer-only.
  const onDevPath =
    pathname === "/app" ||
    pathname.startsWith("/app/projects") ||
    pathname.startsWith("/app/feedback") ||
    pathname.startsWith("/app/team") ||
    pathname.startsWith("/app/api");
  const blockedForPersonal = !!user && !isDeveloper && onDevPath;

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    // A personal account has no developer pages - send it to its library.
    if (blockedForPersonal) router.replace("/app/library");
  }, [loading, user, blockedForPersonal, router]);

  // Show a spinner (not the dev page) while unauthenticated OR while a personal
  // account is being redirected off a dev path - so the developer page never
  // mounts and fires its developer-only API calls for an end_user.
  if (loading || !user || blockedForPersonal) {
    return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  }

  const navLinks = nav.filter((item) => !item.devOnly || isDeveloper).map((item) => {
    const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors",
          active
            ? "bg-brand-gradient font-medium text-white shadow-glow"
            : "text-ink-muted hover:bg-surface-2 hover:text-ink",
        )}
      >
        <Icon size={17} className="shrink-0" />
        {t(item.key)}
        {item.href === "/app/feedback" && <FeedbackBadge className="ms-auto" />}
      </Link>
    );
  });

  const avatarLetter = (user.displayName || user.email).charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Sidebar (desktop) / top bar (mobile) */}
      <aside className="shrink-0 border-b border-line bg-surface p-3 md:w-60 md:border-b-0 md:border-l md:p-4">
        <div className="flex items-center justify-between gap-2 md:mb-6 md:block">
          <Link href="/" className="flex items-center"><Logo size={28} /></Link>
          <div className="flex items-center gap-2 md:hidden">
            <LocaleToggle />
            <Button variant="ghost" size="sm" onClick={() => logout().then(() => router.push("/"))}>
              {t("dash.logout")}
            </Button>
          </div>
        </div>

        {/* horizontal scroll on mobile, vertical on desktop */}
        <nav className="mt-2 flex gap-1 overflow-x-auto md:mt-0 md:flex-col md:overflow-visible">
          {navLinks}
        </nav>

        <div className="mt-8 hidden border-t border-line pt-4 md:block">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">
              {avatarLetter}
            </span>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="ghost" size="sm" className="flex-1 justify-start gap-2" onClick={() => logout().then(() => router.push("/"))}>
              <LogOut size={15} /> {t("dash.logout")}
            </Button>
            <LocaleToggle />
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-4 sm:p-6 md:p-8">
        {!user.emailVerified && <VerifyEmailBanner email={user.email} />}
        {children}
      </main>
    </div>
  );
}
