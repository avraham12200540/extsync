"use client";

import { useState } from "react";
import Link from "next/link";
import { MarketingShell, PageHero } from "@/components/marketing";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui";

const DOWNLOAD_URL =
  "https://github.com/avraham12200540/extsync/releases/latest/download/ExtSyncAgentSetup.exe";

type Step = { icon: string; title: string; body: string; tip?: string };

function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative mx-auto max-w-2xl">
      <span className="absolute bottom-6 top-6 w-0.5 bg-gradient-to-b from-brand via-brand-sky to-brand-teal/40 ltr:left-[27px] rtl:right-[27px]" />
      {steps.map((s, i) => (
        <li
          key={s.title}
          className="fade-up relative flex gap-5 pb-8 last:pb-0"
          style={{ ["--d" as never]: `${i * 110}ms` }}
        >
          <div className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-2xl shadow-glow">
            {s.icon}
          </div>
          <div className="lift rounded-xl border border-line bg-surface p-5 shadow-card">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-muted dark:bg-brand/20 text-xs font-bold text-brand">
                {i + 1}
              </span>
              <h3 className="font-semibold text-ink">{s.title}</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.body}</p>
            {s.tip && (
              <p className="mt-2 rounded-lg bg-brand-muted/60 dark:bg-brand/15 px-3 py-1.5 text-xs text-brand dark:text-brand-sky">💡 {s.tip}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function DocsPage() {
  const { t } = useLocale();
  const [tab, setTab] = useState<"user" | "dev">("user");

  const userSteps: Step[] = [
    { icon: "⬇️", title: t("docs.u1.t"), body: t("docs.u1.b") },
    { icon: "🧩", title: t("docs.u2.t"), body: t("docs.u2.b") },
    { icon: "🖱️", title: t("docs.u3.t"), body: t("docs.u3.b") },
    { icon: "🔄", title: t("docs.u4.t"), body: t("docs.u4.b") },
  ];
  const devSteps: Step[] = [
    { icon: "📝", title: t("docs.d1.t"), body: t("docs.d1.b"), tip: t("docs.d1.tip") },
    { icon: "📦", title: t("docs.d2.t"), body: t("docs.d2.b") },
    { icon: "⬆️", title: t("docs.d3.t"), body: t("docs.d3.b") },
    { icon: "🚀", title: t("docs.d4.t"), body: t("docs.d4.b") },
    { icon: "🔗", title: t("docs.d5.t"), body: t("docs.d5.b") },
  ];
  const faq = [1, 2, 3, 4].map((n) => [t(`docs.q${n}`), t(`docs.a${n}`)] as const);

  return (
    <MarketingShell>
      <PageHero
        eyebrow={t("docs.eyebrow")}
        title={t("docs.title")}
        subtitle={t("docs.sub")}
      />

      <section className="mx-auto max-w-4xl px-6 py-14">
        <div className="mx-auto mb-12 grid max-w-md grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-1 shadow-card">
          {([["user", t("docs.tab.user")], ["dev", t("docs.tab.dev")]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                tab === id ? "bg-brand-gradient text-white shadow-glow" : "text-ink-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "user" ? (
          <>
            <Timeline steps={userSteps} />
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <a href={DOWNLOAD_URL}><Button variant="glass" className="px-6 py-2.5 text-base">{t("docs.cta.download")}</Button></a>
              <Link href="/store"><Button variant="secondary" className="px-6 py-2.5 text-base">{t("docs.cta.store")}</Button></Link>
            </div>
          </>
        ) : (
          <>
            <Timeline steps={devSteps} />
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link href="/register"><Button variant="glass" className="px-6 py-2.5 text-base">{t("docs.cta.register")}</Button></Link>
              <Link href="/security"><Button variant="secondary" className="px-6 py-2.5 text-base">{t("docs.cta.security")}</Button></Link>
            </div>
          </>
        )}
      </section>

      <section className="border-t border-line bg-surface py-14">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="mb-8 text-center text-2xl font-bold text-ink">{t("docs.faq.title")}</h2>
          <div className="space-y-3">
            {faq.map(([q, a]) => (
              <details key={q} className="group rounded-xl border border-line bg-surface-2/40 p-4 transition-colors hover:border-brand/40">
                <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-ink">
                  {q}<span className="text-brand transition-transform group-open:rotate-180">⌄</span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
