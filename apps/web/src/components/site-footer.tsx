import Link from "next/link";
import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <Logo size={30} />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-muted">
              הפצה, התקנה ועדכון אוטומטי של תוספי Chrome פרטיים — מחוץ לחנות, עם חתימה
              דיגיטלית ואבטחה מלאה.
            </p>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-ink">ניווט</h3>
            <ul className="space-y-2 text-sm text-ink-muted">
              <li><Link className="hover:text-brand" href="/store">גלריית התוספים</Link></li>
              <li><Link className="hover:text-brand" href="/download">הורדת ExtSync Agent</Link></li>
              <li><Link className="hover:text-brand" href="/docs">תיעוד למפתחים</Link></li>
              <li><Link className="hover:text-brand" href="/security">אבטחה</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-ink">מפתח ויצירת קשר</h3>
            <ul className="space-y-2 text-sm text-ink-muted">
              <li>פותח ע&quot;י אברהם גלסר</li>
              <li>
                <a className="hover:text-brand" href="mailto:glasser.avraham@gmail.com" dir="ltr">
                  glasser.avraham@gmail.com
                </a>
              </li>
              <li>
                <a className="hover:text-brand" href="https://github.com/avraham12200540/extsync"
                   target="_blank" rel="noreferrer" dir="ltr">
                  GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-line pt-6 text-xs text-ink-muted sm:flex-row">
          <span>© {new Date().getFullYear()} ExtSync. כל הזכויות שמורות.</span>
          <span>אינה תחליף רשמי ל-Chrome Web Store.</span>
        </div>
      </div>
    </footer>
  );
}
