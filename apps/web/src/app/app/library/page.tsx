"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { LibraryBig, MonitorDown, Puzzle, Trash2 } from "lucide-react";
import { DashHeader } from "@/components/dashboard";
import { useLocale } from "@/components/locale-context";
import { api, ApiError, type InstallBatch, type LibraryItem } from "@/lib/api";
import { Button, Card, Spinner } from "@/components/ui";

/**
 * The signed-in user's extension library: store extensions they installed from
 * the site. "Install all" opens the ExtSync Agent with the whole queue - the
 * moving-to-a-new-computer flow.
 */
export default function LibraryPage() {
  const { t } = useLocale();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agentMissing, setAgentMissing] = useState(false);
  const [batchError, setBatchError] = useState(false);

  const load = () => {
    setLoadFailed(false);
    api.get<LibraryItem[]>("/me/extensions").then(setItems).catch(() => setLoadFailed(true));
  };
  useEffect(load, []);

  const remove = async (projectId: string) => {
    const prev = items ?? [];
    const item = prev.find((i) => i.projectId === projectId);
    const index = prev.findIndex((i) => i.projectId === projectId);
    setItems(prev.filter((i) => i.projectId !== projectId));
    try {
      await api.del(`/me/extensions/${projectId}`);
    } catch {
      // Re-insert exactly the one item at its old spot - no refetch, so this
      // can't race with other pending removes or hide items on a second failure.
      setItems((cur) => {
        if (!item || !cur || cur.some((i) => i.projectId === projectId)) return cur;
        const next = [...cur];
        next.splice(Math.min(index, next.length), 0, item);
        return next;
      });
    }
  };

  const installAll = async () => {
    setBusy(true);
    setAgentMissing(false);
    setBatchError(false);
    try {
      const batch = await api.post<InstallBatch>("/me/extensions/install-batch");
      window.location.href = batch.uri;
      // Same not-installed detection as the install page: if nothing handles the
      // extsync:// URI the tab stays visible, so surface the download hint.
      let timer = 0;
      const settled = () => {
        window.clearTimeout(timer);
        document.removeEventListener("visibilitychange", settled);
        window.removeEventListener("blur", settled);
        window.removeEventListener("pagehide", settled);
      };
      document.addEventListener("visibilitychange", settled);
      window.addEventListener("blur", settled);
      window.addEventListener("pagehide", settled);
      timer = window.setTimeout(() => {
        settled();
        if (document.visibilityState === "visible") setAgentMissing(true);
      }, 2500);
    } catch (e) {
      // Never a silent dead end: on a real error tell the user and refresh the
      // list (availability may have changed).
      if (!(e instanceof ApiError) || e.status !== 404) setBatchError(true);
      load();
    } finally {
      setBusy(false);
    }
  };

  const available = (items ?? []).filter((i) => i.available);

  return (
    <div className="max-w-2xl">
      <DashHeader icon={<LibraryBig size={20} />} title={t("lib.title")} subtitle={t("lib.sub")} />

      {items === null ? (
        loadFailed ? (
          <Card className="text-center">
            <p className="text-ink-muted">{t("lib.load.failed")}</p>
            <Button variant="secondary" className="mt-4" onClick={load}>{t("lib.retry")}</Button>
          </Card>
        ) : (
          <div className="flex justify-center p-10"><Spinner /></div>
        )
      ) : items.length === 0 ? (
        <Card className="text-center">
          <p className="text-ink-muted">{t("lib.empty")}</p>
          <Link href="/store" className="mt-4 inline-block">
            <Button variant="primary">{t("lib.empty.cta")}</Button>
          </Link>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-ink">{t("lib.installall.title")}</h2>
                <p className="mt-1 text-sm text-ink-muted">{t("lib.installall.hint")}</p>
              </div>
              <Button variant="primary" disabled={busy || available.length === 0} onClick={installAll}
                      className="shrink-0 gap-2">
                <MonitorDown className="h-4 w-4" />
                {t("lib.installall")} ({available.length})
              </Button>
            </div>
            {batchError && <p className="mt-3 text-sm text-danger">{t("lib.installall.error")}</p>}
            {agentMissing && (
              <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                <p className="font-semibold">{t("inst.notdetected.title")}</p>
                <p className="mt-1">{t("inst.notdetected.body")}</p>
                <div className="mt-3">
                  <Link href="/download"><Button size="sm" variant="secondary">{t("inst.dl")}</Button></Link>
                </div>
              </div>
            )}
            {/* Always-on hint: old Agents (pre-batch) silently no-op on the
                extsync://install-batch URI and can't be feature-detected. */}
            <p className="mt-3 text-xs text-ink-muted">{t("lib.installall.caption")}</p>
          </Card>

          <div className="space-y-3">
            {items.map((item) => (
              <Card key={item.projectId} className="flex items-center gap-3">
                {item.iconUrl ? (
                  <Image src={item.iconUrl} alt="" width={40} height={40}
                         className="h-10 w-10 shrink-0 rounded-lg object-cover" unoptimized />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                    <Puzzle size={20} className="text-ink-muted" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {item.available ? (
                    <Link href={`/store/${item.slug}`} className="font-medium text-ink hover:text-brand">
                      {item.name}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">{item.name}</span>
                  )}
                  <p className="truncate text-xs text-ink-muted">
                    {item.developerName}
                    {!item.available && (
                      <span className="ms-2 text-amber-600 dark:text-amber-300">{t("lib.unavailable")}</span>
                    )}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove(item.projectId)}
                        aria-label={t("lib.remove")} className="shrink-0 gap-1.5 text-ink-muted hover:text-danger">
                  <Trash2 size={15} /> {t("lib.remove")}
                </Button>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
