import { MarketingShell, PageHero } from "@/components/marketing";
import { getLocale } from "@/lib/locale-server";
import { t as tr } from "@/lib/i18n";

const ICONS = ["🔏", "🧪", "🔎", "🚫", "🔒", "↩️"];

export default async function SecurityPage() {
  const locale = await getLocale();
  const t = (k: string) => tr(k, locale);
  const items = [1, 2, 3, 4, 5, 6].map((n, i) => ({
    icon: ICONS[i], t: t(`sec.${n}.t`), d: t(`sec.${n}.d`),
  }));

  return (
    <MarketingShell>
      <PageHero
        eyebrow={t("sec.eyebrow")}
        title={t("sec.title")}
        subtitle={t("sec.sub")}
      />

      <section className="mx-auto max-w-5xl px-6 py-14">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it, i) => (
            <div
              key={it.t}
              className="lift fade-up rounded-xl border border-line bg-surface p-6 shadow-card"
              style={{ ["--d" as never]: `${i * 80}ms` }}
            >
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-gradient text-xl shadow-glow">
                {it.icon}
              </div>
              <h3 className="font-semibold text-ink">{it.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{it.d}</p>
            </div>
          ))}
        </div>

        {/* trust statement */}
        <div className="mt-12 rounded-2xl border border-line bg-surface-2/50 p-8 text-center">
          <h2 className="text-xl font-bold text-ink">{t("sec.os.title")}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {t("sec.os.body")}
          </p>
          <a
            href="https://github.com/avraham12200540/extsync"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block text-sm font-medium text-brand hover:underline"
          >
            {t("sec.os.cta")}
          </a>
        </div>
      </section>
    </MarketingShell>
  );
}
