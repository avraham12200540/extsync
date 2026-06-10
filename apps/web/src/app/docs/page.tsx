"use client";

import { useState } from "react";
import Link from "next/link";
import { MarketingShell, PageHero } from "@/components/marketing";
import { Button } from "@/components/ui";

const DOWNLOAD_URL =
  "https://github.com/avraham12200540/extsync/releases/latest/download/ExtSyncAgentSetup.exe";

type Step = { icon: string; title: string; body: string; tip?: string };

const userSteps: Step[] = [
  { icon: "⬇️", title: "מורידים את התוכנה", body: "מתקינים פעם אחת את ExtSync Agent ל-Windows. ההתקנה ברמת המשתמש, בלי הרשאות מנהל." },
  { icon: "🧩", title: "בוחרים תוסף", body: "נכנסים לגלריית התוספים, בוחרים תוסף ולוחצים \"התקנה\"." },
  { icon: "🖱️", title: "טעינה חד-פעמית", body: "התוכנה פותחת את Chrome ומדריכה אתכם לטעון את התוסף - לחיצה אחת על \"טענתי את התוסף\"." },
  { icon: "🔄", title: "וזהו - אוטומטי", body: "מכאן כל גרסה חדשה שהמפתח מפרסם מותקנת ומתעדכנת אצלכם לבד, עם חתימה דיגיטלית." },
];

const devSteps: Step[] = [
  { icon: "📝", title: "פותחים חשבון מפתח", body: "נרשמים ומאמתים את המייל. חינם לחלוטין.", tip: "החשבון שלכם מנהל את כל התוספים שלכם." },
  { icon: "📦", title: "יוצרים תוסף", body: "נותנים שם ובוחרים נראות - \"ציבורי\" כדי שיופיע בגלרייה הציבורית." },
  { icon: "⬆️", title: "מעלים קובץ ZIP", body: "מעלים את התוסף (Manifest V3). השרת בודק אבטחה, חותם, ומזריק עדכון-אוטומטי - בלי שתכתבו שורת קוד." },
  { icon: "🚀", title: "מפרסמים", body: "לוחצים \"פרסום\". מכאן כל מי שהתקין מקבל את העדכון אוטומטית. אפשר גם Rollback בלחיצה." },
];

function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative mx-auto max-w-2xl">
      <span className="absolute bottom-6 right-[27px] top-6 w-0.5 bg-gradient-to-b from-brand via-brand-sky to-brand-teal/40" />
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
              <p className="mt-2 rounded-lg bg-brand-muted/60 dark:bg-brand/15 px-3 py-1.5 text-xs text-brand">💡 {s.tip}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function DocsPage() {
  const [tab, setTab] = useState<"user" | "dev">("user");

  return (
    <MarketingShell>
      <PageHero
        eyebrow="מדריך מהיר"
        title="להתחיל עם ExtSync - בכמה דקות"
        subtitle="פשוט, ויזואלי, בלי כאב ראש. בחרו אם אתם משתמשים שרוצים להתקין תוספים, או מפתחים שרוצים לפרסם."
      />

      <section className="mx-auto max-w-4xl px-6 py-14">
        <div className="mx-auto mb-12 grid max-w-md grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-1 shadow-card">
          {([["user", "👤 אני משתמש"], ["dev", "🧩 אני מפתח"]] as const).map(([id, label]) => (
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
              <a href={DOWNLOAD_URL}><Button variant="glass" className="px-6 py-2.5 text-base">⬇️ הורדת התוכנה</Button></a>
              <Link href="/store"><Button variant="secondary" className="px-6 py-2.5 text-base">לגלריית התוספים</Button></Link>
            </div>
          </>
        ) : (
          <>
            <Timeline steps={devSteps} />
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link href="/register"><Button variant="glass" className="px-6 py-2.5 text-base">פתיחת חשבון מפתח</Button></Link>
              <Link href="/security"><Button variant="secondary" className="px-6 py-2.5 text-base">על האבטחה</Button></Link>
            </div>
          </>
        )}
      </section>

      <section className="border-t border-line bg-surface py-14">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="mb-8 text-center text-2xl font-bold text-ink">שאלות נפוצות</h2>
          <div className="space-y-3">
            {[
              ["למה צריך את התוכנה (Agent)?", "Chrome לא מאפשר התקנה שקטה של תוסף לא-ארוז ללא חנות. התוכנה הופכת את ההתקנה הראשונה לפשוטה, ומנהלת אוטומטית את כל העדכונים שאחריה."],
              ["האם זה בטוח?", "כן. כל גרסה חתומה דיגיטלית (Ed25519) ונבדקת אבטחה. התוכנה מסרבת להתקין משהו שלא תואם את החתימה."],
              ["האם הקוד רץ מהשרת?", "לא. כל קוד התוסף נמצא בחבילה החתומה - אין הורדה או הרצה של קוד מרוחק."],
              ["זה עולה כסף?", "לא. פתיחת חשבון, פרסום והורדת התוכנה - חינם."],
            ].map(([q, a]) => (
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
