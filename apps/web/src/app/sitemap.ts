import type { MetadataRoute } from "next";
import type { CatalogItem } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const BASE = "https://extsync.com";

export const revalidate = 3600; // refresh the slug list hourly

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const statics: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/store`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/download`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/docs`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/security`, changeFrequency: "monthly", priority: 0.6 },
  ];

  let items: CatalogItem[] = [];
  try {
    const res = await fetch(`${API_URL}/catalog`, { next: { revalidate: 3600 } });
    if (res.ok) items = await res.json();
  } catch {
    // API down: ship the static part rather than failing the sitemap
  }

  return [
    ...statics,
    ...items.map((i) => ({
      url: `${BASE}/store/${encodeURIComponent(i.slug)}`,
      lastModified: i.publishedAt ? new Date(i.publishedAt) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
