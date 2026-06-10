"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/marketing";
import { Button, Card, Field, Input } from "@/components/ui";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    if (password.length < 10) { setError("הסיסמה חייבת להיות באורך 10 תווים לפחות."); return; }
    if (password !== confirm) { setError("הסיסמאות אינן זהות."); return; }
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, newPassword: password });
      setDone(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "האיפוס נכשל - ייתכן שהקישור פג תוקף.");
    } finally { setBusy(false); }
  };

  if (!token) {
    return (
      <Card className="w-full text-center shadow-lift">
        <h1 className="mb-2 text-2xl font-bold text-ink">קישור לא תקין</h1>
        <p className="text-ink-muted">חסר טוקן איפוס. בקש קישור חדש דרך &quot;שכחתי סיסמה&quot;.</p>
        <Link href="/forgot-password" className="mt-4 inline-block text-brand hover:underline">לבקשת קישור חדש</Link>
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="w-full text-center shadow-lift">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-2xl shadow-glow">✅</div>
        <h1 className="mb-2 text-2xl font-bold text-ink">הסיסמה אופסה בהצלחה</h1>
        <p className="text-ink-muted">מעבירים אותך להתחברות…</p>
        <Link href="/login" className="mt-4 inline-block text-brand hover:underline">להתחברות עכשיו</Link>
      </Card>
    );
  }

  return (
    <Card className="w-full shadow-lift">
      <h1 className="mb-6 text-2xl font-bold text-ink">בחירת סיסמה חדשה</h1>
      {error && <p className="mb-4 rounded-md bg-red-50 dark:bg-red-500/10 p-3 text-sm text-danger dark:text-red-400">{error}</p>}
      <Field label="סיסמה חדשה (לפחות 10 תווים)">
        <Input type="password" autoComplete="new-password" value={password}
               onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
      <Field label="אימות סיסמה">
        <Input type="password" autoComplete="new-password" value={confirm}
               onChange={(e) => setConfirm(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && submit()} />
      </Field>
      <Button className="w-full" onClick={submit} disabled={busy || !password || !confirm}>
        {busy ? "מאפס…" : "איפוס סיסמה"}
      </Button>
      <Link href="/login" className="mt-4 inline-block text-sm text-brand hover:underline">חזרה להתחברות</Link>
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
