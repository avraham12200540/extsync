import { SiteHeader } from "@/components/site-header";
import { Card, Button } from "@/components/ui";

export default function DownloadPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-3xl font-bold text-ink">הורדת ExtSync Agent</h1>
        <p className="mt-3 text-ink-muted">
          ExtSync Agent היא תוכנת Windows קטנה שמתקינה ומעדכנת את התוספים המנוהלים שלך.
          ההתקנה היא ברמת המשתמש (ללא הרשאות מנהל).
        </p>

        <Card className="mt-6">
          <h2 className="font-semibold text-ink">Windows 10/11</h2>
          <p className="mt-1 text-sm text-ink-muted">קובץ התקנה: ExtSyncAgentSetup.exe</p>
          <a
            href="https://github.com/avraham12200540/extsync/releases/latest/download/ExtSyncAgentSetup.exe"
            className="mt-3 inline-block"
          >
            <Button>הורדה ל-Windows</Button>
          </a>
          <p className="mt-3 text-xs text-ink-muted">
            כל הגרסאות:{" "}
            <a
              href="https://github.com/avraham12200540/extsync/releases"
              className="text-brand hover:underline"
            >
              דף ה-Releases
            </a>
            . בהפעלה הראשונה Windows עשוי להציג אזהרת SmartScreen (התוכנה עדיין לא חתומה
            ברישיון Code Signing) — לחצו "מידע נוסף" → "הפעל בכל זאת".
          </p>
        </Card>

        <Card className="mt-4 bg-surface-2">
          <h2 className="font-semibold text-ink">למה צריך את ה-Agent?</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Chrome אינו מאפשר התקנה שקטה של תוסף לא-ארוז ללא חנות או ניהול ארגוני. ה-Agent
            מכין את התוסף, פותח עבורך את דף ההרחבות ומדריך אותך לטעינה חד-פעמית. לאחר מכן כל
            העדכונים אוטומטיים, חתומים, עם Rollback.
          </p>
        </Card>
      </main>
    </div>
  );
}
