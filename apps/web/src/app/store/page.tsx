"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type CatalogItem } from "@/lib/api";
import { MarketingShell, PageHero } from "@/components/marketing";
import { ExtensionCard, SkeletonCard, CatalogError } from "@/components/extension-card";
import { Card, Input } from "@/components/ui";

type SortKey = "rating" | "newest" | "name";

const SORT_LABELS: Record<SortKey, string> = {
  rating: "לפי דירוג",
  newest: "החדשים קודם",
  name: "לפי שם (א-ת)",
};

export default function StorePage() {
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
    return [...set].sort((a, b) => a.localeCompare(b, "he"));
  }, [items]);

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
        list = [...list].sort((a, b) => a.name.localeCompare(b.name, "he"));
        break;
      default: // rating: avg desc, then number of votes as a tie-breaker
        list = [...list].sort((a, b) =>
          (b.avgRating ?? 0) - (a.avgRating ?? 0) ||
          (b.ratingsCount ?? 0) - (a.ratingsCount ?? 0));
    }
    return list;
  }, [items, q, category, sort]);

  return (
    <MarketingShell>
      <PageHero
        eyebrow="גלריה"
        title="גלריית התוספים"
        subtitle="מסודרים לפי דירוג הקהילה - התקנה מנוהלת (עדכון אוטומטי) או הורדה ידנית."
      />

      <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        {/* toolbar: count / category chips / sort + search */}
        <div className="mb-6 flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-muted">
              {items === null ? "טוען…" : `${filtered.length} תוספים${q || category ? " תואמים" : ""}`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="מיון"
                className="rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-ink"
              >
                {Object.entries(SORT_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
              <Input placeholder="🔍 חיפוש תוסף…" value={q} onChange={(e) => setQ(e.target.value)}
                     className="sm:w-64" />
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
                    {c ?? "הכל"}
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
            {q || category ? "לא נמצאו תוספים תואמים." : "עדיין אין תוספים ציבוריים שפורסמו. חזרו מאוחר יותר 🙂"}
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
