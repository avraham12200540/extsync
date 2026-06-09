"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type CatalogItem } from "@/lib/api";
import { SiteHeader } from "@/components/site-header";
import { Card, Input, Spinner } from "@/components/ui";

export default function StorePage() {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.get<CatalogItem[]>("/catalog").then(setItems).catch(() => setItems([]));
  }, []);

  const filtered = (items ?? []).filter(
    (i) => !q || i.name.toLowerCase().includes(q.toLowerCase()) ||
      (i.shortDescription || "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-ink">גלריית התוספים</h1>
            <p className="mt-1 text-ink-muted">תוספי Chrome ציבוריים — להתקנה מנוהלת (עדכון אוטומטי) או הורדה ידנית.</p>
          </div>
          <Input placeholder="חיפוש תוסף…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-64" />
        </div>

        {items === null ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <Card className="text-center text-ink-muted">
            עדיין אין תוספים ציבוריים שפורסמו. חזרו מאוחר יותר 🙂
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((i) => (
              <Link key={i.slug} href={`/store/${i.slug}`}>
                <Card className="h-full transition-colors hover:border-brand">
                  <div className="flex items-center gap-3">
                    {i.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.iconUrl} alt="" className="h-12 w-12 rounded-lg" />
                    ) : (
                      <div className="h-12 w-12 rounded-lg bg-brand-muted" />
                    )}
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-ink">{i.name}</h2>
                      <p className="truncate text-xs text-ink-muted">{i.developerName}</p>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-ink-muted">{i.shortDescription}</p>
                  <p className="mt-3 text-xs text-ink-muted">גרסה {i.latestVersion ?? "—"}</p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
