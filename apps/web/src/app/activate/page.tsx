"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/providers";
import { AuthShell } from "@/components/marketing";
import { Button, Card, Field, Input } from "@/components/ui";

/** Device-flow approval: the CLI shows a short code; the signed-in user enters
 *  it here to authorize that device. */
export default function ActivatePage() {
  const { user, loading } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null); setBusy(true);
    try {
      await api.post("/auth/device-flow/approve", { userCode: code.trim().toUpperCase() });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "הקוד שגוי או שפג תוקפו.");
    } finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <Card className="w-full shadow-lift">
        {done ? (
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-2xl shadow-glow">✅</div>
            <h1 className="mb-2 text-2xl font-bold text-ink">המכשיר אושר</h1>
            <p className="text-ink-muted">אפשר לחזור לטרמינל - ההתחברות תושלם אוטומטית.</p>
          </div>
        ) : (
          <>
            <h1 className="mb-2 text-2xl font-bold text-ink">אישור מכשיר</h1>
            <p className="mb-4 text-sm text-ink-muted">הזן את הקוד שמוצג בטרמינל (CLI) כדי לאשר את ההתחברות.</p>
            {!loading && !user && (
              <p className="mb-4 rounded-md bg-amber-50 dark:bg-amber-400/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                צריך להתחבר קודם - <Link href="/login" className="font-medium text-brand hover:underline">להתחברות</Link>, ואז לחזור לכאן.
              </p>
            )}
            {error && <p className="mb-4 rounded-md bg-red-50 dark:bg-red-500/10 p-3 text-sm text-danger dark:text-red-400">{error}</p>}
            <Field label="קוד אימות">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX"
                     className="text-center text-lg tracking-widest" dir="ltr" autoFocus
                     onKeyDown={(e) => e.key === "Enter" && code && submit()} />
            </Field>
            <Button className="w-full" onClick={submit} disabled={busy || !code || !user}>
              {busy ? "מאשר…" : "אישור המכשיר"}
            </Button>
          </>
        )}
      </Card>
    </AuthShell>
  );
}
