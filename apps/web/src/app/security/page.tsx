import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui";

const items = [
  ["חתימה דיגיטלית", "כל גרסה נחתמת ב-Ed25519 בשירות חתימה מבודד. ה-Agent מאמת את החתימה ואת ה-SHA-256 לפני כל התקנה ומסרב להתקין אם משהו לא תואם."],
  ["ניתוח מבודד", "כל העלאה נבדקת ב-Worker נפרד: ZIP bomb, path traversal, קוד מרוחק, eval, קבצים בינאריים, התאמת manifest והרשאות."],
  ["שקיפות הרשאות", "שינויים בהרשאות בין גרסאות מזוהים ומוצגים. הרשאות רגישות או גישה לכל האתרים דורשות אישור משתמש מפורש לפני התקנה."],
  ["ללא קוד מרוחק", "כל קוד התוסף כלול בחבילה החתומה. אין הורדה או הרצה של JavaScript מהשרת."],
  ["פרטיות", "איסוף מינימלי: מזהה מכשיר אקראי, גרסה, וסטטוס עדכון. ללא היסטוריית גלישה, תוכן דפים או סיסמאות. Telemetry הוא opt-in."],
  ["Rollback", "עדכון שנכשל מגלגל אוטומטית לגרסה הקודמת — שנשמרת תמיד."],
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold text-ink">אבטחה</h1>
        <p className="mt-3 text-ink-muted">כיצד ExtSync מגנה על המשתמשים והמפתחים לאורך שרשרת ההפצה.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {items.map(([t, d]) => (
            <Card key={t}><h2 className="font-semibold text-ink">{t}</h2><p className="mt-1 text-sm text-ink-muted">{d}</p></Card>
          ))}
        </div>
      </main>
    </div>
  );
}
