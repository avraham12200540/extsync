"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Inbox, MailOpen } from "lucide-react";
import { DashHeader } from "@/components/dashboard";
import { useLocale } from "@/components/locale-context";
import { FEEDBACK_UNREAD_KEY } from "@/components/feedback-badge";
import { api, type FeedbackItem } from "@/lib/api";
import { Button, Card, Spinner } from "@/components/ui";

/**
 * Developer inbox: private messages users sent about the developer's extensions.
 * Only the owning developer sees these. Opening a message marks it read.
 */
export default function FeedbackInboxPage() {
  const { t, locale } = useLocale();
  const qc = useQueryClient();
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = () => {
    setLoadFailed(false);
    api.get<FeedbackItem[]>("/me/feedback").then(setItems).catch(() => setLoadFailed(true));
  };
  useEffect(load, []);

  const fmt = useMemo(() => {
    const df = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", { dateStyle: "medium", timeStyle: "short" });
    // Never let a malformed timestamp throw inside .map and blank the whole list.
    return (iso: string): string => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? "" : df.format(d);
    };
  }, [locale]);

  const markRead = async (item: FeedbackItem) => {
    if (item.read) return;
    setItems((cur) => cur?.map((i) => (i.id === item.id ? { ...i, read: true } : i)) ?? cur);
    try {
      await api.post(`/me/feedback/${item.id}/read`);
      // Refresh the shared unread badge (header + sidebar) to match.
      qc.invalidateQueries({ queryKey: [FEEDBACK_UNREAD_KEY] });
    } catch {
      setItems((cur) => cur?.map((i) => (i.id === item.id ? { ...i, read: false } : i)) ?? cur);
    }
  };

  const unread = (items ?? []).filter((i) => !i.read).length;

  return (
    <div className="max-w-2xl">
      <DashHeader
        icon={<Inbox size={20} />}
        title={t("fbinbox.title")}
        subtitle={unread > 0 ? `${unread} ${t("fbinbox.unread")}` : t("fbinbox.sub")}
      />

      {items === null ? (
        loadFailed ? (
          <Card className="text-center">
            <p className="text-ink-muted">{t("fbinbox.load.failed")}</p>
            <Button variant="secondary" className="mt-4" onClick={load}>{t("fbinbox.retry")}</Button>
          </Card>
        ) : (
          <div className="flex justify-center p-10"><Spinner /></div>
        )
      ) : items.length === 0 ? (
        <Card className="text-center">
          <MailOpen className="mx-auto mb-3 text-ink-muted" size={28} />
          <p className="text-ink-muted">{t("fbinbox.empty")}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card
              key={item.id}
              onClick={item.read ? undefined : () => markRead(item)}
              onKeyDown={item.read ? undefined : (e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); markRead(item); }
              }}
              role={item.read ? undefined : "button"}
              tabIndex={item.read ? undefined : 0}
              aria-label={item.read ? undefined : t("fbinbox.markread")}
              className={item.read ? undefined : "cursor-pointer border-brand/40 bg-brand/5"}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {!item.read && <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />}
                  <span className="font-medium text-ink">{item.fromName}</span>
                  <span className="text-xs text-ink-muted">{t("fbinbox.about")}</span>
                  <Link
                    href={`/store/${item.projectSlug}`}
                    className="text-xs text-brand hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {item.projectName}
                  </Link>
                </div>
                <span className="text-xs text-ink-muted">{fmt(item.createdAt)}</span>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm text-ink">{item.body}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
