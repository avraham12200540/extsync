"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/providers";
import { AuthShell } from "@/components/marketing";
import { useLocale } from "@/components/locale-context";
import { Button, Card, Field, Input } from "@/components/ui";
import { CircleCheck } from "lucide-react";

/** Device-flow approval: the CLI shows a short code; the signed-in user enters
 *  it here to authorize that device. */
export default function ActivatePage() {
  const { user, loading } = useAuth();
  const { t } = useLocale();
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
      setError(e instanceof ApiError ? e.message : t("act.failed"));
    } finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <Card className="w-full shadow-lift">
        {done ? (
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow"><CircleCheck className="h-7 w-7 text-white" strokeWidth={1.75} /></div>
            <h1 className="mb-2 text-2xl font-bold text-ink">{t("act.done.title")}</h1>
            <p className="text-ink-muted">{t("act.done.body")}</p>
          </div>
        ) : (
          <>
            <h1 className="mb-2 text-2xl font-bold text-ink">{t("act.title")}</h1>
            <p className="mb-4 text-sm text-ink-muted">{t("act.body")}</p>
            {!loading && !user && (
              <p className="mb-4 rounded-md bg-amber-50 dark:bg-amber-400/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                {t("act.needlogin.1")} <Link href="/login" className="font-medium text-brand hover:underline">{t("act.needlogin.2")}</Link>{t("act.needlogin.3")}
              </p>
            )}
            {error && <p className="mb-4 rounded-md bg-red-50 dark:bg-red-500/10 p-3 text-sm text-danger dark:text-red-400">{error}</p>}
            <Field label={t("act.code")}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX"
                     className="text-center text-lg tracking-widest" dir="ltr" autoFocus
                     onKeyDown={(e) => e.key === "Enter" && code && submit()} />
            </Field>
            <Button className="w-full" onClick={submit} disabled={busy || !code || !user}>
              {busy ? t("act.busy") : t("act.submit")}
            </Button>
          </>
        )}
      </Card>
    </AuthShell>
  );
}
