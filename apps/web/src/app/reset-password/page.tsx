"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/marketing";
import { useLocale } from "@/components/locale-context";
import { Button, Card, Field, Input } from "@/components/ui";

function ResetForm() {
  const router = useRouter();
  const { t } = useLocale();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    if (password.length < 10) { setError(t("rp.short")); return; }
    if (password !== confirm) { setError(t("rp.mismatch")); return; }
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, newPassword: password });
      setDone(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("rp.failed"));
    } finally { setBusy(false); }
  };

  if (!token) {
    return (
      <Card className="w-full text-center shadow-lift">
        <h1 className="mb-2 text-2xl font-bold text-ink">{t("rp.invalid.title")}</h1>
        <p className="text-ink-muted">{t("rp.invalid.body")}</p>
        <Link href="/forgot-password" className="mt-4 inline-block text-brand hover:underline">{t("rp.invalid.cta")}</Link>
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="w-full text-center shadow-lift">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-2xl shadow-glow">✅</div>
        <h1 className="mb-2 text-2xl font-bold text-ink">{t("rp.done.title")}</h1>
        <p className="text-ink-muted">{t("rp.done.body")}</p>
        <Link href="/login" className="mt-4 inline-block text-brand hover:underline">{t("rp.done.cta")}</Link>
      </Card>
    );
  }

  return (
    <Card className="w-full shadow-lift">
      <h1 className="mb-6 text-2xl font-bold text-ink">{t("rp.title")}</h1>
      {error && <p className="mb-4 rounded-md bg-red-50 dark:bg-red-500/10 p-3 text-sm text-danger dark:text-red-400">{error}</p>}
      <Field label={t("rp.pass")}>
        <Input type="password" autoComplete="new-password" value={password}
               onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
      <Field label={t("rp.confirm")}>
        <Input type="password" autoComplete="new-password" value={confirm}
               onChange={(e) => setConfirm(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && submit()} />
      </Field>
      <Button className="w-full" onClick={submit} disabled={busy || !password || !confirm}>
        {busy ? t("rp.busy") : t("rp.submit")}
      </Button>
      <Link href="/login" className="mt-4 inline-block text-sm text-brand hover:underline">{t("fp.back")}</Link>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
