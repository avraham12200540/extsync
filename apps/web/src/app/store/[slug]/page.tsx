"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError, type CatalogDetail } from "@/lib/api";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { RateWidget, RatingDisplay } from "@/components/stars";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { formatDate } from "@/lib/utils";

export default function StoreDetailPage({ params }: { params: { slug: string } }) {
  const [d, setD] = useState<CatalogDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<CatalogDetail>(`/catalog/${params.slug}`).then(setD)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "שגיאה"));
  }, [params.slug]);

  if (err) return <Shell><Card className="text-center"><h1 className="text-xl font-semibold text-ink">לא נמצא</h1><p className="mt-2 text-ink-muted">{err}</p></Card></Shell>;
  if (!d) return <Shell><div className="flex justify-center py-20"><Spinner /></div></Shell>;

  const stable = d.channels.find((c) => c.channel === "stable") ?? d.channels[0];

  return (
    <Shell>
      <Card>
        <div className="flex items-center gap-4">
          {d.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.iconUrl} alt="" className="h-16 w-16 rounded-lg" />
          ) : <div className="h-16 w-16 rounded-lg bg-brand-muted" />}
          <div>
            <h1 className="text-2xl font-semibold text-ink">{d.name}</h1>
            <p className="text-sm text-ink-muted">מאת {d.developerName}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {stable && <Badge>גרסה {stable.version}</Badge>}
              {d.category && <Badge>{d.category}</Badge>}
              {d.usesNativeMessaging && <Badge>עדכון אוטומטי</Badge>}
            </div>
          </div>
        </div>

        {/* ratings */}
        <div className="mt-4 flex flex-col gap-2 rounded-lg border border-line bg-surface-2/50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <RatingDisplay avg={d.avgRating} count={d.ratingsCount} />
          <RateWidget slug={d.slug} myRating={d.myRating ?? null} />
        </div>

        {d.shortDescription && <p className="mt-4 text-ink">{d.shortDescription}</p>}
        {d.fullDescription && <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">{d.fullDescription}</p>}

        {/* Install / download */}
        <div className="mt-6 flex flex-wrap gap-3">
          {d.installUri && (
            <a href={d.installUri}>
              <Button>התקנה מנוהלת (עדכון אוטומטי)</Button>
            </a>
          )}
          {stable?.downloadUrl && (
            <a href={stable.downloadUrl} download>
              <Button variant="secondary">הורדת ZIP ידנית (v{stable.version})</Button>
            </a>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          התקנה מנוהלת דורשת את <Link href="/download" className="text-brand hover:underline">ExtSync Agent</Link> (עדכונים אוטומטיים).
          הורדה ידנית = קובץ ה-ZIP לטעינה עצמית ב-chrome://extensions.
        </p>

        {/* permissions */}
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-ink">הרשאות</h2>
          {d.permissions.length === 0 && d.hostPermissions.length === 0 ? (
            <p className="text-sm text-ink-muted">אין הרשאות מיוחדות.</p>
          ) : (
            <ul className="space-y-1 text-sm text-ink-muted">
              {d.permissions.map((p) => <li key={p}>• {p}</li>)}
              {d.hostPermissions.length > 0 && <li>• גישה לאתרים: {d.hostPermissions.join(", ")}</li>}
            </ul>
          )}
        </div>

        {/* all channels */}
        {d.channels.length > 1 && (
          <div className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-ink">ערוצים</h2>
            <div className="space-y-1 text-sm">
              {d.channels.map((ch) => (
                <div key={ch.channel} className="flex items-center justify-between">
                  <span className="text-ink">{ch.channel} - v{ch.version} <span className="text-ink-muted">({formatDate(ch.publishedAt)})</span></span>
                  {ch.downloadUrl && <a href={ch.downloadUrl} download className="text-brand hover:underline">הורדה</a>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          {d.website && <a href={d.website} className="text-brand hover:underline">אתר</a>}
          {d.repoUrl && <a href={d.repoUrl} className="text-brand hover:underline">קוד מקור</a>}
          {d.privacyPolicyUrl && <a href={d.privacyPolicyUrl} className="text-brand hover:underline">פרטיות</a>}
        </div>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">{children}</main>
      <SiteFooter />
    </div>
  );
}
