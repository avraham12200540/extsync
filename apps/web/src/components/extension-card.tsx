"use client";

import Link from "next/link";
import type { CatalogItem } from "@/lib/api";
import { LogoIcon } from "@/components/logo";
import { RatingDisplay } from "@/components/stars";
import { useLocale } from "@/components/locale-context";

/** Shimmering placeholder shown while the catalog loads. */
export function SkeletonCard({ delay = 0 }: { delay?: number }) {
  const bar = "animate-shimmer rounded bg-gradient-to-l from-surface-2 via-line/60 to-surface-2 bg-[length:200%_100%]";
  return (
    <div className="fade-up overflow-hidden rounded-xl border border-line bg-surface shadow-card"
         style={{ ["--d" as never]: `${delay}ms` }} aria-hidden>
      <div className={`aspect-[4/3] ${bar} !rounded-none`} />
      <div className="space-y-2.5 p-4">
        <div className={`h-4 w-2/3 ${bar}`} />
        <div className={`h-3 w-full ${bar}`} />
        <div className={`h-3 w-1/3 ${bar}`} />
      </div>
    </div>
  );
}

/** Friendly load-failure notice (API unreachable ≠ empty catalog). */
export function CatalogError() {
  const { t } = useLocale();
  return (
    <div className="rounded-xl border border-line bg-surface p-10 text-center">
      <p className="font-medium text-ink">{t("store.error.title")}</p>
      <p className="mt-1 text-sm text-ink-muted">{t("store.error.sub")}</p>
    </div>
  );
}

/** Store card: image fills most of the square; bottom row has the name on the
 *  right and the current version on the left (RTL layout), plus the rating. */
export function ExtensionCard({ item, delay = 0 }: { item: CatalogItem; delay?: number }) {
  const { t } = useLocale();
  return (
    <Link href={`/store/${item.slug}`} className="block">
      <article
        className="lift fade-up group overflow-hidden rounded-xl border border-line bg-surface shadow-card hover:border-brand/50"
        style={{ ["--d" as never]: `${delay}ms` }}
      >
        {/* image area - most of the card */}
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-gradient-to-br from-brand/10 via-surface-2 to-brand-teal/10">
          {item.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.iconUrl}
              alt={item.name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="opacity-40 transition-transform duration-500 group-hover:scale-110">
              <LogoIcon size={84} />
            </div>
          )}
          {item.category && (
            <span className="absolute right-3 top-3 rounded-full bg-brand-navy/80 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur">
              {item.category}
            </span>
          )}
        </div>

        {/* bottom strip */}
        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate font-semibold text-ink group-hover:text-brand">{item.name}</h3>
            <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-muted" dir="ltr">
              v{item.latestVersion ?? "-"}
            </span>
          </div>
          {item.shortDescription && (
            <p className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-sm leading-snug text-ink-muted">
              {item.shortDescription}
            </p>
          )}
          <p className="mt-1.5 truncate text-xs text-ink-muted">{t("store.by")} {item.developerName}</p>
          <div className="mt-2">
            <RatingDisplay avg={item.avgRating} count={item.ratingsCount} />
          </div>
        </div>
      </article>
    </Link>
  );
}
