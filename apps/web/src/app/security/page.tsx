import { MarketingShell, PageHero } from "@/components/marketing";

const items = [
  { icon: "🔏", t: "חתימה דיגיטלית", d: "כל גרסה נחתמת ב-Ed25519 בשירות חתימה מבודד. ה-Agent מאמת חתימה ו-SHA-256 לפני כל התקנה, ומסרב אם משהו לא תואם." },
  { icon: "🧪", t: "ניתוח מבודד", d: "כל העלאה נבדקת ב-Worker נפרד: ZIP bomb, path traversal, קוד מרוחק, eval, קבצים בינאריים, והתאמת manifest." },
  { icon: "🔎", t: "שקיפות הרשאות", d: "שינויי הרשאות בין גרסאות מזוהים ומוצגים. הרשאות רגישות או גישה לכל האתרים דורשות אישור מפורש." },
  { icon: "🚫", t: "ללא קוד מרוחק", d: "כל קוד התוסף כלול בחבילה החתומה. אין הורדה או הרצה של JavaScript מהשרת." },
  { icon: "🔒", t: "פרטיות", d: "איסוף מינימלי: מזהה מכשיר אקראי, גרסה וסטטוס עדכון. ללא היסטוריית גלישה, תוכן דפים או סיסמאות. Telemetry הוא opt-in." },
  { icon: "↩️", t: "Rollback אוטומטי", d: "עדכון שנכשל מתגלגל אוטומטית לגרסה הקודמת — שנשמרת תמיד." },
];

export default function SecurityPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="אבטחה"
        title="אבטחה כברירת מחדל — לכל אורך השרשרת"
        subtitle="כיצד ExtSync מגנה על המשתמשים והמפתחים מרגע ההעלאה ועד כל עדכון."
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
          <h2 className="text-xl font-bold text-ink">קוד פתוח — אפשר לבדוק בעצמכם</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            ExtSync היא כלי אבטחה, ולכן הקוד שלה גלוי לבדיקה. אתם לא צריכים לסמוך עלינו על המילה —
            אפשר לקרוא בדיוק מה הסוכן עושה במחשב שלכם.
          </p>
          <a
            href="https://github.com/avraham12200540/extsync"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block text-sm font-medium text-brand hover:underline"
          >
            לצפייה בקוד ב-GitHub ←
          </a>
        </div>
      </section>
    </MarketingShell>
  );
}
