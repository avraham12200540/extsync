"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AdminAuthProvider, useAdminAuth } from "@/lib/admin-auth-context";
import { useTranslation } from "@/lib/use-translation";
import { AdminShell } from "@/components/admin/admin-shell";

// usePathname() never includes basePath (verified live: it returns the
// same unprefixed shape router.push()/<Link href> expect - only a plain
// fetch() URL ever needs the /guess prefix written out manually).
const LOGIN_PATH = "/admin/login";

function AdminGate({ children }: { children: React.ReactNode }) {
  const t = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useAdminAuth();
  const isLoginRoute = pathname === LOGIN_PATH;

  useEffect(() => {
    if (!isLoginRoute && status === "unauthenticated") {
      router.replace("/admin/login");
    }
  }, [isLoginRoute, status, router]);

  // The login page renders unshelled and ungated - it is the one route an
  // unauthenticated visitor is meant to reach.
  if (isLoginRoute) return <>{children}</>;

  // Never render protected content until the admin-session endpoint has
  // confirmed authentication - "checking" and "unauthenticated" both show
  // only this quiet placeholder, never the page underneath.
  if (status !== "authenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p className="text-sm text-ink-muted">{status === "checking" ? t("admin.state.checkingSession") : t("admin.state.unauthorized")}</p>
      </main>
    );
  }

  return <AdminShell>{children}</AdminShell>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthProvider>
      <AdminGate>{children}</AdminGate>
    </AdminAuthProvider>
  );
}
