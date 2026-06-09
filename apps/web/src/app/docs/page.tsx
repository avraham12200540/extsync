import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui";

const links = [
  ["מדריך למפתח", "התקנה, יצירת פרויקט, העלאה ופרסום.", "/docs/developer-guide/getting-started.md"],
  ["CLI", "extsync init / validate / pack / upload / publish.", "/docs/developer-guide/cli.md"],
  ["שילוב Bridge", "הוספת ExtSync Bridge לתוסף ל-reload אוטומטי.", "/docs/developer-guide/bridge.md"],
  ["API", "תיעוד ה-OpenAPI של ה-Backend.", `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/docs`],
  ["אבטחה וחתימות", "מודל האמון, החתימה ושרשרת העדכון.", "/docs/security/signing.md"],
  ["מגבלות ידועות", "מגבלות Chrome/Windows האמיתיות.", "/docs/architecture/limitations.md"],
];

export default function DocsPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold text-ink">תיעוד</h1>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {links.map(([t, d, href]) => (
            <a key={t} href={href as string} className="block">
              <Card className="hover:border-brand">
                <h2 className="font-semibold text-ink">{t}</h2>
                <p className="mt-1 text-sm text-ink-muted">{d}</p>
              </Card>
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}
