"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type CatalogItem } from "@/lib/api";
import { MarketingShell, PageHero } from "@/components/marketing";
import { ExtensionCard, SkeletonCard, CatalogError } from "@/components/extension-card";
import { Search } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Card, Input } from "@/components/ui";

type SortKey = "rating" | "newest" | "name";

export default function StorePage() {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("rating");

  useEffect(() => {
    api.get<CatalogItem[]>("/catalog").then(setItems)
      .catch(() => { setLoadError(true); setItems([]); });
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const i of items ?? []) if (i.category) set.add(i.category);
    return [...set].sort((a, b) => a.localeCompare(b, locale));
  }, [items, locale]);

  const filtered = useMemo(() => {
    let list = (items ?? []).filter(
      (i) => (!q || i.name.toLowerCase().includes(q.toLowerCase()) ||
        (i.shortDescription || "").toLowerCase().includes(q.toLowerCase())) &&
        (!category || i.category === category),
    );
    switch (sort) {
      case "newest":
        list = [...list].sort((a, b) =>
          (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
        break;
      case "name":
        list = [...list].sort((a, b) => a.name.localeCompare(b.name, locale));
        break;
      default: // rating: avg desc, then number of votes as a tie-breaker
        list = [...list].sort((a, b) =>
          (b.avgRating ?? 0) - (a.avgRating ?? 0) ||
          (b.ratingsCount ?? 0) - (a.ratingsCount ?? 0));
    }
    return list;
  }, [items, q, category, sort, locale]);

  return (
    <MarketingShell>
      <PageHero
        eyebrow={t("store.eyebrow")}
        title={t("store.title")}
        subtitle={t("store.sub")}
      />

      <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        {/* toolbar: count / category chips / sort + search */}
        <div className="mb-6 flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-muted">
              {items === null
                ? t("store.loading")
                : `${filtered.length} ${t("store.count")}${q || category ? ` ${t("store.matching")}` : ""}`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="sort"
                className="rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-ink"
              >
                <option value="rating">{t("store.sort.rating")}</option>
                <option value="newest">{t("store.sort.newest")}</option>
                <option value="name">{t("store.sort.name")}</option>
              </select>
              <div className="relative sm:w-64">
                <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted ltr:left-3 rtl:right-3" />
                <Input placeholder={t("store.search")} value={q} onChange={(e) => setQ(e.target.value)}
                       className="w-full ltr:pl-9 rtl:pr-9" />
              </div>
            </div>
          </div>

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {[null, ...categories].map((c) => {
                const active = category === c;
                return (
                  <button
                    key={c ?? "__all"}
                    onClick={() => setCategory(c)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "bg-brand-gradient text-white shadow-glow"
                        : "border border-line bg-surface text-ink-muted hover:text-ink"
                    }`}
                  >
                    {c ?? t("store.cat.all")}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {items === null ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => <SkeletonCard key={i} delay={i * 70} />)}
          </div>
        ) : loadError ? (
          <CatalogError />
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center text-ink-muted">
            {q || category ? t("store.none.q") : t("store.none")}
          </Card>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item, idx) => (
              <ExtensionCard key={item.slug} item={item} delay={idx * 70} />
            ))}
          </div>
        )}
      </section>
    </MarketingShell>
  );
}
