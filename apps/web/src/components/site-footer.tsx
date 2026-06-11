"use client";

import Link from "next/link";
import { Logo } from "@/components/logo";
import { useLocale } from "@/components/locale-context";

export function SiteFooter() {
  const { t } = useLocale();
  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-brand-navy text-slate-300">
      {/* subtle brand glow to match the hero */}
      <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-brand-teal/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-brand-sky/10 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <Logo size={30} onDark />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-400">
              {t("footer.tagline")}
            </p>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">{t("footer.nav")}</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li><Link className="transition-colors hover:text-white" href="/store">{t("footer.store")}</Link></li>
              <li><Link className="transition-colors hover:text-white" href="/download">{t("footer.download")}</Link></li>
              <li><Link className="transition-colors hover:text-white" href="/docs">{t("footer.docs")}</Link></li>
              <li><Link className="transition-colors hover:text-white" href="/security">{t("footer.security")}</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">{t("footer.contact")}</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>{t("footer.by")}</li>
              <li>
                <a className="transition-colors hover:text-white" href="mailto:glasser.avraham@gmail.com" dir="ltr">
                  glasser.avraham@gmail.com
                </a>
              </li>
              <li>
                <a className="transition-colors hover:text-white" href="https://github.com/avraham12200540/extsync"
                   target="_blank" rel="noreferrer" dir="ltr">
                  GitHub
                </a>
              </li>
              <li>
                <a className="transition-colors hover:text-white"
                   href="https://mitmachim.top/user/%D7%90%D7%91%D7%A8%D7%94%D7%9D-%D7%92%D7%9C%D7%A1%D7%A8"
                   target="_blank" rel="noreferrer">
                  {t("footer.mitmachim")}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-white/10 pt-6 text-xs text-slate-500 sm:flex-row">
          <span>
            © {new Date().getFullYear()} ExtSync. {t("footer.rights")}
            {" · "}
            <Link href="/terms" className="transition-colors hover:text-slate-300">{t("footer.terms")}</Link>
            {" · "}
            <Link href="/privacy" className="transition-colors hover:text-slate-300">{t("footer.privacy")}</Link>
          </span>
          <span>{t("footer.disclaimer")}</span>
        </div>
      </div>
    </footer>
  );
}
