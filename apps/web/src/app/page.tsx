"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type CatalogItem } from "@/lib/api";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ExtensionCard } from "@/components/extension-card";
import { SectionHeading } from "@/components/marketing";
import { LogoIcon, Wordmark } from "@/components/logo";
import { Button, Spinner } from "@/components/ui";

const DOWNLOAD_URL =
  "https://github.com/avraham12200540/extsync/releases/latest/download/ExtSyncAgentSetup.exe";

export default function HomePage() {
  const [items, setItems] = useState<CatalogItem[] | null>(null);

  useEffect(() => {
    api.get<CatalogItem[]>("/catalog").then(setItems).catch(() => setItems([]));
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* ============ Hero ============ */}
        <section className="relative overflow-hidden bg-hero-radial">
          {/* floating decorative blobs */}
          <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 animate-float rounded-full bg-brand-teal/10 blur-3xl" />
          <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 animate-float rounded-full bg-brand/10 blur-3xl [animation-delay:1.5s]" />

          <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-24">
            <div className="fade-up mx-auto mb-6 w-fit animate-float">
              <LogoIcon size={88} />
            </div>
            <h1 className="fade-up" style={{ ["--d" as never]: "80ms" }}>
              <Wordmark className="text-5xl sm:text-7xl" />
            </h1>
            <p
              className="fade-up mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted sm:text-xl"
              style={{ ["--d" as never]: "160ms" }}
            >
              חנות לתוספי Chrome פרטיים — הורדה, התקנה ועדכון אוטומטי, בלי Chrome Web Store.
            </p>
            <div
              className="fade-up mt-9 flex flex-wrap items-center justify-center gap-3"
              style={{ ["--d" as never]: "240ms" }}
            >
              <a href="#extensions">
                <Button size="md" variant="glass" className="px-6 py-2.5 text-base">
                  עיון בתוספים
                </Button>
              </a>
              <Link href="/register">
                <Button size="md" variant="secondary" className="px-6 py-2.5 text-base">
                  אני מפתח — פתיחת חשבון
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
            <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:justify-between sm:text-right">
              <div>
                <h2 className="text-xl font-bold sm:text-2xl">ExtSync Agent — תוכנת העדכון האוטומטי</h2>
                <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-slate-300">
                  תוכנה קטנה ל-Windows שמתקינה תוספים מהגלרייה ומעדכנת אותם אוטומטית ברגע
                  שהמפתח מפרסם גרסה חדשה — בלעדיה תצטרכו להוריד ולעדכן כל גרסה ידנית.
                </p>
              </div>
              <a href={DOWNLOAD_URL} className="shrink-0">
                <Button size="md" variant="glass" className="px-6 py-3 text-base">
                  ⬇️ הורדה חינם ל-Windows
                </Button>
              </a>
            </div>
          </div>
        </section>

        {/* ============ Extensions grid ============ */}
        <section id="extensions" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6">
          <div className="mb-8 flex flex-col items-center text-center">
            <h2 className="text-3xl font-bold text-ink">גלריית התוספים</h2>
            <p className="mt-2 max-w-xl text-ink-muted">
              תוספים ציבוריים מדורגים על-ידי הקהילה — מסודרים מהדירוג הגבוה לנמוך.
            </p>
            <span className="mt-4 h-1 w-16 rounded-full bg-brand-gradient" />
          </div>

          {items === null ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-surface p-10 text-center text-ink-muted">
              עדיין אין תוספים ציבוריים — בקרוב 🙂
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item, idx) => (
                <ExtensionCard key={item.slug} item={item} delay={idx * 90} />
              ))}
            </div>
          )}

          <div className="mt-10 text-center">
            <Link href="/store" className="text-sm font-medium text-brand hover:underline">
              לכל התוספים בגלרייה ←
            </Link>
          </div>
        </section>

        {/* ============ Security strip ============ */}
        <section className="border-t border-line bg-surface py-14">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading title="בנוי על אבטחה" subtitle="כל גרסה חתומה, נבדקת ומאומתת לפני שהיא נוגעת ב-Chrome שלך." />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { i: "🔏", t: "חתימת Ed25519", d: "על כל גרסה" },
                { i: "🧪", t: "ניתוח מבודד", d: "ZIP bomb, קוד מרוחק ועוד" },
                { i: "🚫", t: "ללא קוד מרוחק", d: "הכל בחבילה החתומה" },
                { i: "↩️", t: "Rollback", d: "חזרה אוטומטית בכישלון" },
              ].map((s, i) => (
                <div key={s.t} className="fade-up rounded-xl border border-line bg-surface-2/40 p-5 text-center"
                     style={{ ["--d" as never]: `${i * 90}ms` }}>
                  <div className="mb-2 text-3xl">{s.i}</div>
                  <h3 className="font-semibold text-ink">{s.t}</h3>
                  <p className="mt-1 text-xs text-ink-muted">{s.d}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 text-center">
              <Link href="/security" className="text-sm font-medium text-brand hover:underline">עוד על האבטחה ←</Link>
            </div>
          </div>
        </section>

        {/* ============ How it works ============ */}
        <section className="border-t border-line bg-surface-2/40 py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="mb-10 text-center text-3xl font-bold text-ink">איך זה עובד?</h2>
            <div className="grid gap-6 sm:grid-cols-3">
              {[
                { icon: "⬇️", t: "מורידים את התוכנה", d: "מתקינים את ExtSync Agent פעם אחת — הוא ידאג לכל העדכונים." },
                { icon: "🧩", t: "מתקינים תוסף", d: "בוחרים תוסף מהגלרייה ולוחצים התקנה. ההתקנה הראשונה מודרכת צעד-צעד." },
                { icon: "🔄", t: "מתעדכנים אוטומטית", d: "כשהמפתח מפרסם גרסה — היא מותקנת ומופעלת אצלכם לבד, עם חתימה דיגיטלית." },
              ].map((s, i) => (
                <div
                  key={s.t}
                  className="fade-up rounded-xl border border-line bg-surface-2/50 p-6 text-center"
                  style={{ ["--d" as never]: `${i * 120}ms` }}
                >
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-2xl shadow-glow">
                    {s.icon}
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
              <h2 className="text-2xl font-extrabold sm:text-3xl">מפתחים תוסף? פרסמו אותו בדקות.</h2>
              <p className="mx-auto mt-3 max-w-xl text-white/90">
                העלאה, חתימה אוטומטית, ועדכון-בְּמָקוֹם לכל המשתמשים — בלי לכתוב שורת אינטגרציה. חינם.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link href="/register">
                  <Button size="md" variant="glass" className="border-white/40 px-6 py-2.5 text-base">פתיחת חשבון מפתח</Button>
                </Link>
                <Link href="/docs">
                  <Button size="md" className="border border-white/40 bg-white/10 px-6 py-2.5 text-base text-white hover:bg-white/20">
                    למדריך המהיר
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
