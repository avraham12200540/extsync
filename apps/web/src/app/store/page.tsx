"use client";

import { useEffect, useState } from "react";
import { api, type CatalogItem } from "@/lib/api";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ExtensionCard } from "@/components/extension-card";
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
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="fade-up">
            <h1 className="text-3xl font-bold text-ink">גלריית התוספים</h1>
            <p className="mt-1 text-ink-muted">
              מסודרים לפי דירוג הקהילה — התקנה מנוהלת (עדכון אוטומטי) או הורדה ידנית.
            </p>
            <span className="mt-3 block h-1 w-16 rounded-full bg-brand-gradient" />
          </div>
          <Input placeholder="🔍 חיפוש תוסף…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-64" />
        </div>

        {items === null ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center text-ink-muted">
            {q ? "לא נמצאו תוספים תואמים." : "עדיין אין תוספים ציבוריים שפורסמו. חזרו מאוחר יותר 🙂"}
          </Card>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item, idx) => (
              <ExtensionCard key={item.slug} item={item} delay={idx * 70} />
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
