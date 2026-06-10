import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Logo, LogoIcon } from "@/components/logo";

/** Standard public-page shell: header + animated content + footer. */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

/** Decorated hero band used at the top of every public page. */
export function PageHero({
  eyebrow, title, subtitle,
}: { eyebrow?: string; title: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b border-line bg-hero-radial">
      <div className="pointer-events-none absolute -left-24 top-0 h-64 w-64 animate-float rounded-full bg-brand-teal/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-12 -right-20 h-72 w-72 animate-float rounded-full bg-brand/10 blur-3xl [animation-delay:1.5s]" />
      <div className="mx-auto max-w-4xl px-6 py-16 text-center sm:py-20">
        {eyebrow && (
          <p className="fade-up mb-3 inline-block rounded-full bg-brand-muted px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand">
            {eyebrow}
          </p>
        )}
        <h1 className="fade-up text-4xl font-extrabold text-ink sm:text-5xl" style={{ ["--d" as never]: "70ms" }}>
          {title}
        </h1>
        {subtitle && (
          <p className="fade-up mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-ink-muted"
             style={{ ["--d" as never]: "150ms" }}>
            {subtitle}
          </p>
        )}
      </div>
    </section>
  );
}

export function SectionHeading({ title, subtitle, center = true }: { title: string; subtitle?: string; center?: boolean }) {
  return (
    <div className={`mb-10 ${center ? "text-center" : ""}`}>
      <h2 className="text-3xl font-bold text-ink">{title}</h2>
      {subtitle && <p className="mt-2 text-ink-muted">{subtitle}</p>}
      <span className={`mt-4 block h-1 w-16 rounded-full bg-brand-gradient ${center ? "mx-auto" : ""}`} />
    </div>
  );
}

/** Split-screen auth layout: brand panel + form. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* brand panel (desktop) */}
      <div className="relative hidden overflow-hidden bg-brand-navy p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -left-16 -top-16 h-72 w-72 rounded-full bg-brand-teal/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-10 h-80 w-80 rounded-full bg-brand-sky/20 blur-3xl" />
        <a href="/" className="relative"><Logo size={38} /></a>
        <div className="relative">
          <h2 className="text-3xl font-extrabold leading-snug">
            חנות התוספים הפרטית<br />שמתעדכנת לבד.
          </h2>
          <p className="mt-4 max-w-sm text-slate-300">
            הפצה, התקנה ועדכון אוטומטי של תוספי Chrome - מאובטח בחתימה דיגיטלית, מחוץ ל-Web Store.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-slate-300">
            <li className="flex items-center gap-2">✅ עדכונים אוטומטיים עם Rollback</li>
            <li className="flex items-center gap-2">✅ חתימת Ed25519 על כל גרסה</li>
            <li className="flex items-center gap-2">✅ גלריה ציבורית עם דירוגים</li>
          </ul>
        </div>
        <p className="relative text-xs text-slate-400">© {new Date().getFullYear()} ExtSync</p>
      </div>

      {/* form side */}
      <div className="flex items-center justify-center bg-surface-2 px-6 py-12">
        <div className="fade-up w-full max-w-md">
          <a href="/" className="mb-8 inline-flex lg:hidden"><Logo size={34} /></a>
          {children}
        </div>
      </div>
    </div>
  );
}

export { LogoIcon };
