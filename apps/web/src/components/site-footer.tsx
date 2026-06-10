import Link from "next/link";
import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-brand-navy text-slate-300">
      {/* subtle brand glow to match the hero */}
      <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-brand-teal/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-brand-sky/10 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <Logo size={30} onDark />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-400">
              הפצה, התקנה ועדכון אוטומטי של תוספי Chrome פרטיים - מחוץ לחנות, עם חתימה
              דיגיטלית ואבטחה מלאה.
            </p>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">ניווט</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li><Link className="transition-colors hover:text-white" href="/store">גלריית התוספים</Link></li>
              <li><Link className="transition-colors hover:text-white" href="/download">הורדת ExtSync Agent</Link></li>
              <li><Link className="transition-colors hover:text-white" href="/docs">המדריך המהיר</Link></li>
              <li><Link className="transition-colors hover:text-white" href="/security">אבטחה</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">מפתח ויצירת קשר</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>פותח ע&quot;י אברהם גלסר</li>
              <li>
                <a className="transition-colors hover:text-white" href="mailto:glasser.avraham@gmail.com" dir="ltr">
                  glasser.avraham@gmail.com
                </a>
              </li>
              <li>
                <a className="transition-colors hover:text-white" href="https://github.com/avraham12200540/extsync"
                   target="_blank" rel="noreferrer" dir="ltr">
                  GitHub
                </a>
              </li>
              <li>
                <a className="transition-colors hover:text-white"
                   href="https://mitmachim.top/user/%D7%90%D7%91%D7%A8%D7%94%D7%9D-%D7%92%D7%9C%D7%A1%D7%A8"
                   target="_blank" rel="noreferrer">
                  מתמחים טופ
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-white/10 pt-6 text-xs text-slate-500 sm:flex-row">
          <span>© {new Date().getFullYear()} ExtSync. כל הזכויות שמורות.</span>
          <span>אינה תחליף רשמי ל-Chrome Web Store.</span>
        </div>
      </div>
    </footer>
  );
}
