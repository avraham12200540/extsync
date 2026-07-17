"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { useAuth } from "@/components/providers";
import { useLocale } from "@/components/locale-context";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui";

const DRAFT_KEY = "sb_feedback_draft";

/**
 * "Message the developer" box on a store page. Everyone sees it and can type;
 * login is required only at the final SEND step. When a logged-out user sends,
 * the draft is stashed and they are sent to /login?next=<this page>; on return
 * (now signed in) the send finishes automatically - login is the last step.
 */
export function FeedbackForm({ slug }: { slug: string }) {
  const { t } = useLocale();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const flushed = useRef(false);

  const send = async (text: string) => {
    setState("sending");
    setError(null);
    try {
      await api.post(`/catalog/${slug}/feedback`, { body: text });
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      setBody("");
      setState("sent");
    } catch (e) {
      setState("error");
      setError(e instanceof ApiError ? e.message : t("fb.error"));
    }
  };

  // On return from login with a preserved draft for THIS extension, finish sending.
  useEffect(() => {
    if (loading || !user || flushed.current) return;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as { slug?: string; body?: string; ts?: number };
      if (d.slug === slug && d.body && d.ts && Date.now() - d.ts < 30 * 60 * 1000) {
        flushed.current = true;
        // Show the text in the box too, so a failed auto-send leaves it visible
        // and editable (the Send button re-enables) instead of an empty trap.
        setBody(d.body);
        void send(d.body);
      } else if (d.slug === slug) {
        sessionStorage.removeItem(DRAFT_KEY);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, slug]);

  const onSend = () => {
    const text = body.trim();
    if (!text) return;
    if (user) { void send(text); return; }
    // Logged out: preserve the draft and go log in; the effect above finishes it.
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ slug, body: text, ts: Date.now() }));
    } catch { /* ignore */ }
    router.push(`/login?next=${encodeURIComponent(`/store/${slug}`)}`);
  };

  return (
    <div className="mt-6 rounded-xl border border-line bg-surface-2/40 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <MessageSquare size={16} className="text-brand" /> {t("fb.title")}
      </h2>
      <p className="mt-1 text-xs text-ink-muted">{t("fb.sub")}</p>

      {state === "sent" ? (
        <p className="mt-3 rounded-md bg-green-50 dark:bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">
          {t("fb.sent")}
        </p>
      ) : (
        <>
          <textarea
            value={body}
            onChange={(e) => { setBody(e.target.value); if (state === "error") setState("idle"); }}
            maxLength={4000}
            rows={4}
            placeholder={t("fb.placeholder")}
            className="mt-3 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted outline-none focus:border-brand"
          />
          {error && <p className="mt-1 text-xs text-danger">{error}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={onSend} disabled={state === "sending" || !body.trim()}>
              {state === "sending" ? t("fb.sending") : t("fb.send")}
            </Button>
            {!user && !loading && <span className="text-xs text-ink-muted">{t("fb.loginhint")}</span>}
          </div>
        </>
      )}
    </div>
  );
}
