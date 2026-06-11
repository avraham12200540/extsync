import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import type { CatalogDetail } from "@/lib/api";
import { MarketingShell } from "@/components/marketing";
import { RatingSection } from "@/components/rating-section";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { getLocale } from "@/lib/locale-server";
import { t as tr } from "@/lib/i18n";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Server-side fetch so every public extension is a real, indexable page
 *  (the old client-only fetch rendered an empty shell for crawlers). */
async function getDetail(slug: string): Promise<CatalogDetail | null> {
  try {
    const res = await fetch(`${API_URL}/catalog/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as CatalogDetail;
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { params }: { params: { slug: string } },
): Promise<Metadata> {
  const d = await getDetail(params.slug);
  if (!d) return { title: "Not found" };
  const description = d.shortDescription || `${d.developerName} | ExtSync`;
  return {
    title: d.name,
    description,
    openGraph: {
      title: `${d.name} | ExtSync`,
      description,
      images: [{ url: d.iconUrl || "/og.jpg" }],
    },
  };
}

export default async function StoreDetailPage({ params }: { params: { slug: string } }) {
  const locale = getLocale();
  const t = (k: string) => tr(k, locale);
  const d = await getDetail(params.slug);
  if (!d) notFound();

  const stable = d.channels.find((c) => c.channel === "stable") ?? d.channels[0];

  // Rich result for Google: extension as a free software application.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: d.name,
    description: d.shortDescription || undefined,
    applicationCategory: "BrowserApplication",
    operatingSystem: "Chrome",
    url: `https://extsync.com/store/${encodeURIComponent(d.slug)}`,
    image: d.iconUrl || "https://extsync.com/og.jpg",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    ...(d.ratingsCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: d.avgRating,
            ratingCount: d.ratingsCount,
          },
        }
      : {}),
  };

  return (
    <MarketingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="mx-auto w-full max-w-2xl px-6 py-10">
        <Link href="/store" className="mb-4 inline-block text-sm text-ink-muted hover:text-brand">{t("detail.back")}</Link>
        <div className="rounded-lg border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center gap-4">
            {d.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.iconUrl} alt="" className="h-16 w-16 rounded-lg" />
            ) : <div className="h-16 w-16 rounded-lg bg-brand-muted dark:bg-brand/20" />}
            <div>
              <h1 className="text-2xl font-semibold text-ink">{d.name}</h1>
              <p className="text-sm text-ink-muted">
                {t("detail.by")}{" "}
                <Link href={`/dev/${encodeURIComponent(d.developerName)}`}
                      className="text-brand hover:underline">
                  {d.developerName}
                </Link>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {stable && <Badge>{t("detail.version")} {stable.version}</Badge>}
                {d.category && <Badge>{d.category}</Badge>}
                {d.usesNativeMessaging && <Badge>{t("detail.autoupdate")}</Badge>}
                {(d.installs ?? 0) > 0 && <Badge>⬇ {d.installs} {t("store.installs")}</Badge>}
              </div>
            </div>
          </div>

          {/* ratings (client island: live average + voting) */}
          <RatingSection slug={d.slug} initialAvg={d.avgRating} initialCount={d.ratingsCount} />

          {d.shortDescription && <p className="mt-4 text-ink">{d.shortDescription}</p>}
          {d.fullDescription && (
            <div className="md-body mt-2 text-sm text-ink-muted">
              <ReactMarkdown>{d.fullDescription}</ReactMarkdown>
            </div>
          )}

          {/* what's new */}
          {stable?.releaseNotes && (
            <div className="mt-4 rounded-lg border border-line bg-surface-2/50 p-3">
              <h2 className="text-sm font-semibold text-ink">{t("detail.whatsnew")} {stable.version}</h2>
              <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{stable.releaseNotes}</p>
            </div>
          )}

          {/* Install / download */}
          <div className="mt-6 flex flex-wrap gap-3">
            {d.installUri && (
              <a href={d.installUri}
                 className="rounded-md bg-brand-gradient px-4 py-2 text-sm font-medium text-white shadow-glow hover:brightness-110">
                {t("detail.install")}
              </a>
            )}
            {stable?.downloadUrl && (
              <a href={stable.downloadUrl} download
                 className="rounded-md border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">
                {t("detail.downloadzip")} (v{stable.version})
              </a>
            )}
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            {t("detail.installnote.1")} <Link href="/download" className="text-brand hover:underline">ExtSync Agent</Link> {t("detail.installnote.2")}
          </p>

          {/* permissions */}
          <div className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-ink">{t("detail.perms")}</h2>
            {d.permissions.length === 0 && d.hostPermissions.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("detail.noperms")}</p>
            ) : (
              <ul className="space-y-1 text-sm text-ink-muted">
                {d.permissions.map((p) => <li key={p}>• {p}</li>)}
                {d.hostPermissions.length > 0 && <li>• {t("detail.hosts")} {d.hostPermissions.join(", ")}</li>}
              </ul>
            )}
          </div>

          {/* all channels */}
          {d.channels.length > 1 && (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-ink">{t("detail.channels")}</h2>
              <div className="space-y-1 text-sm">
                {d.channels.map((ch) => (
                  <div key={ch.channel} className="flex items-center justify-between">
                    <span className="text-ink">{ch.channel} - v{ch.version} <span className="text-ink-muted">({formatDate(ch.publishedAt)})</span></span>
                    {ch.downloadUrl && <a href={ch.downloadUrl} download className="text-brand hover:underline">{t("detail.download")}</a>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-4 text-sm">
            {d.website && <a href={d.website} className="text-brand hover:underline">{t("detail.website")}</a>}
            {d.repoUrl && <a href={d.repoUrl} className="text-brand hover:underline">{t("detail.source")}</a>}
            {d.privacyPolicyUrl && <a href={d.privacyPolicyUrl} className="text-brand hover:underline">{t("detail.privacy")}</a>}
          </div>
        </div>
      </main>
    </MarketingShell>
  );
}
