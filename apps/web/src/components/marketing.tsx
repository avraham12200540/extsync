import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Logo, LogoIcon } from "@/components/logo";
import { AuthBrandPanel } from "@/components/auth-brand-panel";
import { LocaleToggle } from "@/components/locale-toggle";

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

/** Shared darkened backdrop (the radar/shield art) behind every hero band.
 *  Softened + dimmed so it reads as atmosphere, then faded into the page. */
export function HeroArt({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`absolute inset-0 -z-10 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/reka.webp"
        alt=""
        className="h-full w-full scale-105 object-cover object-[center_35%] blur-[3px]"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-brand-navy/80 via-brand-navy/85 to-surface-2" />
      <div className="absolute inset-0 bg-hero-radial opacity-70" />
    </div>
  );
}

/** Decorated hero band used at the top of every public page. */
export function PageHero({
  eyebrow, title, subtitle,
}: { eyebrow?: string; title: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden">
      <HeroArt />
      <div className="pointer-events-none absolute -left-24 top-0 h-64 w-64 animate-float rounded-full bg-brand-teal/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-12 -right-20 h-72 w-72 animate-float rounded-full bg-brand-sky/15 blur-3xl [animation-delay:1.5s]" />
      <div className="mx-auto max-w-4xl px-6 py-20 text-center sm:py-24">
        {eyebrow && (
          <p className="fade-up mb-4 inline-block rounded-full bg-white/10 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-white ring-1 ring-inset ring-white/20 backdrop-blur">
            {eyebrow}
          </p>
        )}
        <h1 className="fade-up text-4xl font-extrabold text-white sm:text-5xl" style={{ ["--d" as never]: "70ms" }}>
          {title}
        </h1>
        {subtitle && (
          <p className="fade-up mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-slate-200"
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
        <Link href="/" className="relative"><Logo size={38} onDark /></Link>
        <AuthBrandPanel />
        <p className="relative text-xs text-slate-400">© {new Date().getFullYear()} ExtSync</p>
      </div>

      {/* form side */}
      <div className="relative flex items-center justify-center bg-surface-2 px-6 py-12">
        <div className="absolute left-4 top-4"><LocaleToggle /></div>
        <div className="fade-up w-full max-w-md">
          <Link href="/" className="mb-8 inline-flex lg:hidden"><Logo size={34} /></Link>
          {children}
        </div>
      </div>
    </div>
  );
}

export { LogoIcon };
