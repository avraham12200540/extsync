"use client";

import Link from "next/link";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { useTranslation } from "@/lib/use-translation";

const QUICK_LINKS = [
  { href: "/admin/users", labelKey: "admin.nav.users" },
  { href: "/admin/moderation", labelKey: "admin.nav.moderation" },
  { href: "/admin/imports", labelKey: "admin.nav.imports" },
] as const;

export default function AdminOverviewPage() {
  const t = useTranslation();
  const { email } = useAdminAuth();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-ink">{t("admin.overview.title")}</h1>
        {email && (
          <p dir="auto" className="mt-1 text-sm text-ink-muted">
            {t("admin.overview.signedInAs", { email })}
          </p>
        )}
      </div>

      <section className="border-t border-line pt-4">
        <h2 className="text-sm font-medium text-ink">{t("admin.overview.dailyChallengeTitle")}</h2>
        <p className="mt-2 text-sm text-ink-muted">{t("admin.overview.dailyChallengeBody")}</p>
      </section>

      <section className="border-t border-line pt-4">
        <h2 className="text-sm font-medium text-ink">{t("admin.overview.quickLinksTitle")}</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {QUICK_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="text-sm text-ink underline decoration-line underline-offset-4 transition-colors hover:text-accent">
                {t(link.labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
