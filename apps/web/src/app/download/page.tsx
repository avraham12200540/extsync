import Link from "next/link";
import { MarketingShell, PageHero } from "@/components/marketing";
import { LogoIcon } from "@/components/logo";
import { Button } from "@/components/ui";
import { getLocale } from "@/lib/locale-server";
import { t as tr } from "@/lib/i18n";

const DOWNLOAD_URL =
  "https://github.com/avraham12200540/extsync/releases/latest/download/ExtSyncAgentSetup.exe";

export default function DownloadPage() {
  const locale = getLocale();
  const t = (k: string) => tr(k, locale);

  const features = [
    { i: "🔄", t: t("dl.f1.t"), d: t("dl.f1.d") },
    { i: "🔏", t: t("dl.f2.t"), d: t("dl.f2.d") },
    { i: "↩️", t: t("dl.f3.t"), d: t("dl.f3.d") },
  ];

  return (
    <MarketingShell>
      <PageHero
        eyebrow={t("dl.eyebrow")}
        title={t("dl.title")}
        subtitle={t("dl.sub")}
      />

      <section className="mx-auto max-w-4xl px-6 py-14">
        <div className="relative overflow-hidden rounded-2xl bg-brand-navy p-8 text-center text-white shadow-lift sm:p-12">
          <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-brand-teal/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-10 h-56 w-56 rounded-full bg-brand-sky/20 blur-3xl" />
          <div className="relative">
            <div className="mx-auto mb-5 w-fit animate-float rounded-3xl bg-white/10 p-4 backdrop-blur">
              <LogoIcon size={64} />
            </div>
            <h2 className="text-2xl font-bold">{t("dl.card.title")}</h2>
            <p className="mt-2 text-slate-300">{t("dl.card.sub")}</p>
            <a href={DOWNLOAD_URL} className="mt-6 inline-block">
              <Button variant="glass" className="px-8 py-3 text-base">{t("dl.cta")}</Button>
            </a>
            <p className="mt-4 text-xs text-slate-400">
              {t("dl.releases.1")}
              <a href="https://github.com/avraham12200540/extsync/releases" className="underline hover:text-white">
                {t("dl.releases.2")}
              </a>
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-300 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-400/10 p-4 text-sm text-amber-900 dark:text-amber-200">
          <span className="text-lg">⚠️</span>
          <p>{t("dl.smartscreen")}</p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {features.map((b) => (
            <div key={b.t} className="lift rounded-xl border border-line bg-surface p-5 text-center shadow-card">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-gradient text-xl shadow-glow">
                {b.i}
              </div>
              <h3 className="font-semibold text-ink">{b.t}</h3>
              <p className="mt-1 text-sm text-ink-muted">{b.d}</p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-ink-muted">
          {t("dl.guide.1")}{" "}
          <Link href="/docs" className="font-medium text-brand hover:underline">{t("dl.guide.2")}</Link>.
        </p>
      </section>
    </MarketingShell>
  );
}
