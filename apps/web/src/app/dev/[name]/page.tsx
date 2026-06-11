import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CatalogItem } from "@/lib/api";
import { MarketingShell, PageHero } from "@/components/marketing";
import { ExtensionCard } from "@/components/extension-card";
import { getLocale } from "@/lib/locale-server";
import { t as tr } from "@/lib/i18n";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Public developer profile: every extension by this developer, shareable as
 *  one link. Filters the public catalog by the display name. */
async function getExtensions(name: string): Promise<CatalogItem[] | null> {
  try {
    const res = await fetch(`${API_URL}/catalog`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const items = (await res.json()) as CatalogItem[];
    return items.filter((i) => i.developerName === name);
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { params }: { params: { name: string } },
): Promise<Metadata> {
  const name = decodeURIComponent(params.name);
  const locale = getLocale();
  return {
    title: locale === "en" ? `Extensions by ${name}` : `התוספים של ${name}`,
    description: locale === "en"
      ? `All Chrome extensions by ${name} on ExtSync - installed and auto-updated.`
      : `כל תוספי ה-Chrome של ${name} ב-ExtSync - התקנה ועדכון אוטומטי.`,
  };
}

export default async function DeveloperPage({ params }: { params: { name: string } }) {
  const locale = getLocale();
  const t = (k: string) => tr(k, locale);
  const name = decodeURIComponent(params.name);
  const items = await getExtensions(name);
  if (items === null || items.length === 0) notFound();

  return (
    <MarketingShell>
      <PageHero
        eyebrow={t("dev.eyebrow")}
        title={name}
        subtitle={`${items.length} ${t("dev.sub.1")}`}
      />
      <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, idx) => (
            <ExtensionCard key={item.slug} item={item} delay={idx * 70} />
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link href="/store" className="text-sm font-medium text-brand hover:underline">
            {t("dev.all")}
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
