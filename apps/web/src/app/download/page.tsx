import Link from "next/link";
import { MarketingShell, PageHero } from "@/components/marketing";
import { LogoIcon } from "@/components/logo";
import { Button } from "@/components/ui";

const DOWNLOAD_URL =
  "https://github.com/avraham12200540/extsync/releases/latest/download/ExtSyncAgentSetup.exe";

export default function DownloadPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="ExtSync Agent"
        title="התוכנה שמעדכנת את התוספים לבד"
        subtitle="אפליקציית Windows קטנה שמתקינה תוספים מהגלרייה ושומרת אותם מעודכנים אוטומטית - בלי הרשאות מנהל."
      />

      <section className="mx-auto max-w-4xl px-6 py-14">
        <div className="relative overflow-hidden rounded-2xl bg-brand-navy p-8 text-center text-white shadow-lift sm:p-12">
          <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-brand-teal/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-10 h-56 w-56 rounded-full bg-brand-sky/20 blur-3xl" />
          <div className="relative">
            <div className="mx-auto mb-5 w-fit animate-float rounded-3xl bg-white/10 p-4 backdrop-blur">
              <LogoIcon size={64} />
            </div>
            <h2 className="text-2xl font-bold">ExtSync Agent ל-Windows 10/11</h2>
            <p className="mt-2 text-slate-300">קובץ התקנה: ExtSyncAgentSetup.exe · התקנה ברמת המשתמש</p>
            <a href={DOWNLOAD_URL} className="mt-6 inline-block">
              <Button variant="glass" className="px-8 py-3 text-base">⬇️ הורדה חינם</Button>
            </a>
            <p className="mt-4 text-xs text-slate-400">
              כל הגרסאות ב-
              <a href="https://github.com/avraham12200540/extsync/releases" className="underline hover:text-white">
                דף ה-Releases
              </a>
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <span className="text-lg">⚠️</span>
          <p>
            בהפעלה הראשונה Windows עשוי להציג אזהרת <b>SmartScreen</b> (התוכנה עדיין לא חתומה ברישיון
            Code Signing). לחצו <b>&quot;מידע נוסף&quot; → &quot;הפעל בכל זאת&quot;</b>. זה תקין ובטוח.
          </p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {[
            { i: "🔄", t: "עדכון אוטומטי", d: "כל גרסה חדשה מותקנת לבד, בלי שתורידו שוב." },
            { i: "🔏", t: "מאובטח", d: "חתימה דיגיטלית ובדיקת SHA-256 לפני כל התקנה." },
            { i: "↩️", t: "Rollback", d: "עדכון שנכשל חוזר אוטומטית לגרסה הקודמת." },
          ].map((b) => (
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
          לא בטוחים איך מתחילים? יש לנו{" "}
          <Link href="/docs" className="font-medium text-brand hover:underline">מדריך ויזואלי פשוט</Link>.
        </p>
      </section>
    </MarketingShell>
  );
}
