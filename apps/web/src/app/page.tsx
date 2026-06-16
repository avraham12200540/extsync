"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type CatalogItem } from "@/lib/api";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ExtensionCard, SkeletonCard, CatalogError } from "@/components/extension-card";
import { SectionHeading, HeroArt } from "@/components/marketing";
import { Wordmark } from "@/components/logo";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui";
import { FileSignature, FlaskConical, Ban, Undo2, Download, Puzzle, RefreshCw } from "lucide-react";

const DOWNLOAD_URL =
  "https://github.com/avraham12200540/extsync/releases/latest/download/ExtSyncAgentSetup.exe";

export default function HomePage() {
  const { t } = useLocale();
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    api.get<CatalogItem[]>("/catalog").then(setItems)
      .catch(() => { setLoadError(true); setItems([]); });
  }, []);

  // Home shows only the 3 top-rated extensions; the full list lives in /store.
  const topItems = useMemo(
    () => [...(items ?? [])]
      .sort((a, b) =>
        (b.avgRating ?? 0) - (a.avgRating ?? 0) ||
        (b.ratingsCount ?? 0) - (a.ratingsCount ?? 0))
      .slice(0, 3),
    [items],
  );

  const securityItems = [
    { Icon: FileSignature, t: t("home.sec1.t"), d: t("home.sec1.d") },
    { Icon: FlaskConical, t: t("home.sec2.t"), d: t("home.sec2.d") },
    { Icon: Ban, t: t("home.sec3.t"), d: t("home.sec3.d") },
    { Icon: Undo2, t: t("home.sec4.t"), d: t("home.sec4.d") },
  ];
  const howItems = [
    { Icon: Download, t: t("home.how1.t"), d: t("home.how1.d") },
    { Icon: Puzzle, t: t("home.how2.t"), d: t("home.how2.d") },
    { Icon: RefreshCw, t: t("home.how3.t"), d: t("home.how3.d") },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* ============ Hero ============ */}
        <section className="relative isolate overflow-hidden">
          {/* background art: the radar/shield image, softened and dimmed so it
              reads as atmosphere rather than a photo, then faded into the page */}
          <HeroArt />

          {/* floating decorative blobs */}
          <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 animate-float rounded-full bg-brand-teal/15 blur-3xl" />
          <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 animate-float rounded-full bg-brand-sky/15 blur-3xl [animation-delay:1.5s]" />

          <div className="mx-auto max-w-6xl px-4 py-24 text-center sm:px-6 sm:py-32">
            <h1 className="fade-up" style={{ ["--d" as never]: "80ms" }}>
              <Wordmark onDark className="text-6xl sm:text-8xl" />
            </h1>
            <p
              className="fade-up mx-auto mt-6 max-w-3xl text-xl leading-relaxed text-slate-200 sm:text-2xl"
              style={{ ["--d" as never]: "160ms" }}
            >
              {t("home.tagline")}
            </p>
            <div
              className="fade-up mt-10 flex flex-wrap items-center justify-center gap-4"
              style={{ ["--d" as never]: "240ms" }}
            >
              <a href="#extensions">
                <Button size="md" variant="glass" className="px-8 py-3.5 text-lg">
                  {t("home.cta.browse")}
                </Button>
              </a>
              <Link href="/register">
                <Button
                  size="md"
                  className="border border-white/30 bg-white/10 px-8 py-3.5 text-lg text-white backdrop-blur hover:bg-white/20"
                >
                  {t("home.cta.dev")}
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* ============ Agent download strip ============ */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="fade-up relative -mt-2 overflow-hidden rounded-2xl bg-brand-navy p-6 text-white shadow-lift sm:p-8">
            <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-brand-teal/20 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 -right-10 h-56 w-56 rounded-full bg-brand-sky/20 blur-2xl" />
            <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:justify-between sm:text-start">
              <div>
                <h2 className="text-xl font-bold sm:text-2xl">{t("home.agent.title")}</h2>
                <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-slate-300">
                  {t("home.agent.body")}
                </p>
              </div>
              <a href={DOWNLOAD_URL} className="shrink-0">
                <Button size="md" variant="glass" className="px-6 py-3 text-base">
                  <Download className="h-4 w-4" /> {t("home.agent.cta")}
                </Button>
              </a>
            </div>
          </div>
        </section>

        {/* ============ Extensions grid ============ */}
        <section id="extensions" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6">
          <div className="mb-8 flex flex-col items-center text-center">
            <h2 className="text-3xl font-bold text-ink">{t("home.gallery.title")}</h2>
            <p className="mt-2 max-w-xl text-ink-muted">
              {t("home.gallery.sub")}
            </p>
            <span className="mt-4 h-1 w-16 rounded-full bg-brand-gradient" />
          </div>

          {items === null ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => <SkeletonCard key={i} delay={i * 90} />)}
            </div>
          ) : loadError ? (
            <CatalogError />
          ) : items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-surface p-10 text-center text-ink-muted">
              {t("home.gallery.empty")}
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {topItems.map((item, idx) => (
                <ExtensionCard key={item.slug} item={item} delay={idx * 90} />
              ))}
            </div>
          )}

          <div className="mt-10 text-center">
            <Link href="/store">
              <Button variant="secondary" size="md">{t("home.gallery.all")}</Button>
            </Link>
          </div>
        </section>

        {/* ============ Security strip ============ */}
        <section className="border-t border-line bg-surface py-14">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading title={t("home.security.title")} subtitle={t("home.security.sub")} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {securityItems.map((s, i) => (
                <div key={s.t} className="fade-up glass-tile rounded-xl p-5 text-center"
                     style={{ ["--d" as never]: `${i * 90}ms` }}>
                  <s.Icon className="mx-auto mb-2 h-8 w-8 text-brand" strokeWidth={1.75} />
                  <h3 className="font-semibold text-ink">{s.t}</h3>
                  <p className="mt-1 text-xs text-ink-muted">{s.d}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 text-center">
              <Link href="/security" className="text-sm font-medium text-brand hover:underline">{t("home.security.more")}</Link>
            </div>
          </div>
        </section>

        {/* ============ How it works ============ */}
        <section className="border-t border-line bg-surface-2/40 py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="mb-10 text-center text-3xl font-bold text-ink">{t("home.how.title")}</h2>
            <div className="grid gap-6 sm:grid-cols-3">
              {howItems.map((s, i) => (
                <div
                  key={s.t}
                  className="fade-up glass-tile rounded-xl p-6 text-center"
                  style={{ ["--d" as never]: `${i * 120}ms` }}
                >
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
                    <s.Icon className="h-7 w-7 text-white" strokeWidth={1.75} />
                  </div>
                  <h3 className="font-semibold text-ink">{s.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ Developer CTA ============ */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="relative overflow-hidden rounded-2xl bg-brand-gradient p-8 text-center text-white shadow-lift sm:p-12">
            <div className="pointer-events-none absolute -left-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-12 -right-8 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
            <div className="relative">
              <h2 className="text-2xl font-extrabold sm:text-3xl">{t("home.devcta.title")}</h2>
              <p className="mx-auto mt-3 max-w-xl text-white/90">
                {t("home.devcta.body")}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link href="/register">
                  <Button size="md" variant="glass" className="border-white/40 px-6 py-2.5 text-base">{t("home.devcta.register")}</Button>
                </Link>
                <Link href="/docs">
                  <Button size="md" className="border border-white/40 bg-white/10 px-6 py-2.5 text-base text-white hover:bg-white/20">
                    {t("home.devcta.docs")}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
