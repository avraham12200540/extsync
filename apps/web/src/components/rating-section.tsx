"use client";

import { useEffect, useState } from "react";
import { api, type CatalogDetail } from "@/lib/api";
import { useAuth } from "@/components/providers";
import { RateWidget, RatingDisplay } from "@/components/stars";

/** Client island on the (server-rendered) store detail page: shows the live
 *  average and lets signed-in users vote. Fetches `myRating` after mount since
 *  the SSR fetch is anonymous. */
export function RatingSection({
  slug, initialAvg, initialCount,
}: { slug: string; initialAvg: number; initialCount: number }) {
  const { user } = useAuth();
  const [avg, setAvg] = useState(initialAvg);
  const [count, setCount] = useState(initialCount);
  const [mine, setMine] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    api.get<CatalogDetail>(`/catalog/${slug}`)
      .then((d) => { setMine(d.myRating ?? null); setAvg(d.avgRating); setCount(d.ratingsCount); })
      .catch(() => { /* keep SSR values */ });
  }, [user, slug]);

  const refresh = () =>
    api.get<CatalogDetail>(`/catalog/${slug}`)
      .then((d) => { setAvg(d.avgRating); setCount(d.ratingsCount); })
      .catch(() => { /* non-fatal */ });

  return (
    <div className="mt-4 flex flex-col gap-2 rounded-lg border border-line bg-surface-2/50 p-3 sm:flex-row sm:items-center sm:justify-between">
      <RatingDisplay avg={avg} count={count} />
      <RateWidget key={mine ?? "anon"} slug={slug} myRating={mine} onRated={refresh} />
    </div>
  );
}
