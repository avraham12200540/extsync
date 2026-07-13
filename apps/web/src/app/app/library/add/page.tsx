"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, LibraryBig, Puzzle } from "lucide-react";
import { DashHeader } from "@/components/dashboard";
import { useLocale } from "@/components/locale-context";
import { api, ApiError, type CatalogItem, type LibraryItem } from "@/lib/api";
import { Button, Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Gallery multi-select: pick extensions from the store and add them all to the
 * library at once, without installing. Extensions already in the library are
 * shown as such and can't be re-picked.
 */
export default function AddFromGalleryPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [ownedSlugs, setOwnedSlugs] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = () => {
    setLoadFailed(false);
    Promise.all([
      api.get<CatalogItem[]>("/catalog"),
      api.get<LibraryItem[]>("/me/extensions"),
    ])
      .then(([cat, lib]) => {
        setCatalog(cat);
        setOwnedSlugs(new Set(lib.map((i) => i.slug)));
      })
      .catch(() => setLoadFailed(true));
  };
  useEffect(load, []);

  const toggle = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  // Only extensions not already in the library are selectable.
  const pickable = useMemo(
    () => (catalog ?? []).filter((c) => !(ownedSlugs?.has(c.slug))),
    [catalog, ownedSlugs],
  );

  const finish = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      // The API caps a batch at 200; chunk so any selection size succeeds.
      const slugs = [...selected];
      for (let i = 0; i < slugs.length; i += 200) {
        await api.post("/me/extensions/bulk", { slugs: slugs.slice(i, i + 200) });
      }
      router.push("/app/library");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("lib.add.error"));
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl pb-24">
      <DashHeader icon={<LibraryBig size={20} />} title={t("lib.add.title")} subtitle={t("lib.add.sub")} />

      {catalog === null ? (
        loadFailed ? (
          <Card className="text-center">
            <p className="text-ink-muted">{t("lib.add.loadfailed")}</p>
            <Button variant="secondary" className="mt-4" onClick={load}>{t("lib.retry")}</Button>
          </Card>
        ) : (
          <div className="flex justify-center p-10"><Spinner /></div>
        )
      ) : pickable.length === 0 ? (
        <Card className="text-center">
          <p className="text-ink-muted">{t("lib.add.allowned")}</p>
          <Link href="/app/library" className="mt-4 inline-block">
            <Button variant="secondary">{t("lib.add.back")}</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {pickable.map((item) => {
            const isSel = selected.has(item.slug);
            return (
              <button
                key={item.slug}
                type="button"
                onClick={() => toggle(item.slug)}
                aria-pressed={isSel}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3 text-start transition-colors",
                  isSel ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-line hover:bg-surface-2",
                )}
              >
                {item.iconUrl ? (
                  <Image src={item.iconUrl} alt="" width={40} height={40}
                         className="h-10 w-10 shrink-0 rounded-lg object-cover" unoptimized />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                    <Puzzle size={20} className="text-ink-muted" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{item.name}</p>
                  <p className="truncate text-xs text-ink-muted">{item.developerName}</p>
                  {item.shortDescription && (
                    <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{item.shortDescription}</p>
                  )}
                </div>
                <span className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                  isSel ? "border-brand bg-brand text-white" : "border-line",
                )}>
                  {isSel && <Check size={13} strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Sticky finish bar */}
      {catalog !== null && pickable.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 p-3 backdrop-blur md:ms-60">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            {error ? (
              <span className="text-sm text-danger">{error}</span>
            ) : (
              <span className="text-sm text-ink-muted">{t("lib.add.selected")}: {selected.size}</span>
            )}
            <div className="flex gap-2">
              <Link href="/app/library"><Button variant="ghost" size="sm">{t("dash.st.cancel")}</Button></Link>
              <Button size="sm" onClick={finish} disabled={saving || selected.size === 0}>
                {saving ? t("lib.add.saving") : `${t("lib.add.finish")} (${selected.size})`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
