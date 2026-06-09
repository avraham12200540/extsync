import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { Button, Card } from "@/components/ui";

const steps = [
  { n: "1", t: "העלאה", d: "המפתח מעלה ZIP של התוסף. השרת מנתח, בודק אבטחה וחותם." },
  { n: "2", t: "קישור", d: "נוצר קישור התקנה שאפשר לשלוח למשתמשים." },
  { n: "3", t: "התקנה", d: "המשתמש פותח את הקישור ב-ExtSync Agent וטוען את התוסף פעם אחת." },
  { n: "4", t: "עדכון", d: "מכאן ואילך כל גרסה חדשה מותקנת אוטומטית עם Rollback אם צריך." },
];

const faqs = [
  { q: "למה צריך 'מצב מפתח' ב-Chrome?", a: "Chrome לא מאפשר התקנה שקטה של תוסף לא-ארוז ללא חנות או ניהול ארגוני. ExtSync הופכת את ההתקנה הראשונה הידנית לפשוטה ומנהלת אוטומטית את כל העדכונים שאחריה." },
  { q: "האם זה תחליף ל-Chrome Web Store?", a: "לא. ExtSync מיועדת לתוספים פרטיים, ניסיוניים וצוותיים — לא להחלפת החנות הרשמית." },
  { q: "האם הקוד רץ מהשרת?", a: "לא. כל קוד התוסף כלול בחבילה שהועלתה, נבדקה ונחתמה. אין הורדת קוד מרוחק." },
];

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6">
        <section className="py-20 text-center">
          <h1 className="mx-auto max-w-3xl text-4xl font-bold text-ink sm:text-5xl">
            הפצה ועדכון של תוספי Chrome פרטיים — בלי החנות
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-ink-muted">
            ExtSync מיועדת לתוספים פרטיים, ניסיוניים וצוותיים. העלאה, קישור התקנה, ועדכונים
            אוטומטיים מאובטחים עם חתימה דיגיטלית ו-Rollback.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href="/register"><Button size="md">פתיחת חשבון מפתח</Button></Link>
            <Link href="/download"><Button size="md" variant="secondary">הורדת ExtSync Agent</Button></Link>
          </div>
          <p className="mt-4 text-sm text-ink-muted">
            התקנה ראשונה דורשת הפעלת "מצב מפתח" ב-Chrome — נסביר בדיוק איך.
          </p>
        </section>

        <section className="grid gap-4 pb-16 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <Card key={s.n}>
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-brand-muted font-semibold text-brand">
                {s.n}
              </div>
              <h3 className="font-semibold text-ink">{s.t}</h3>
              <p className="mt-1 text-sm text-ink-muted">{s.d}</p>
            </Card>
          ))}
        </section>

        <section className="pb-16">
          <Card className="bg-surface-2">
            <h2 className="text-xl font-semibold text-ink">אבטחה כברירת מחדל</h2>
            <ul className="mt-3 grid gap-2 text-sm text-ink-muted sm:grid-cols-2">
              <li>• חתימת Ed25519 על כל גרסה; ה-Agent מסרב להתקין ללא חתימה תקינה.</li>
              <li>• אימות SHA-256 לכל קובץ שמורד.</li>
              <li>• ניתוח אבטחה מבודד: ZIP bomb, path traversal, קוד מרוחק, קבצים בינאריים.</li>
              <li>• שינוי הרשאות מזוהה ומוצג; הרשאות רגישות דורשות אישור משתמש.</li>
              <li>• איסוף מידע מינימלי; Telemetry הוא opt-in בלבד.</li>
              <li>• Rollback אוטומטי כשעדכון נכשל — הגרסה הישנה נשמרת.</li>
            </ul>
          </Card>
        </section>

        <section className="pb-24">
          <h2 className="mb-4 text-xl font-semibold text-ink">שאלות נפוצות</h2>
          <div className="space-y-3">
            {faqs.map((f) => (
              <Card key={f.q}>
                <h3 className="font-medium text-ink">{f.q}</h3>
                <p className="mt-1 text-sm text-ink-muted">{f.a}</p>
              </Card>
            ))}
          </div>
        </section>
      </main>
      <footer className="border-t border-line py-8 text-center text-sm text-ink-muted">
        ExtSync — ניהול תוספי Chrome פרטיים. אינה תחליף רשמי ל-Chrome Web Store.
      </footer>
    </div>
  );
}
