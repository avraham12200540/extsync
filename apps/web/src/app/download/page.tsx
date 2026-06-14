import Link from "next/link";
import { MarketingShell, PageHero } from "@/components/marketing";
import { DownloadCta } from "@/components/download-cta";
import { getLocale } from "@/lib/locale-server";
import { t as tr } from "@/lib/i18n";

export default async function DownloadPage() {
  const locale = await getLocale();
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
        <DownloadCta />

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
