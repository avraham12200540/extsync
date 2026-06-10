"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { AuthShell } from "@/components/marketing";
import { Card, Spinner } from "@/components/ui";

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    if (!token) { setState("error"); return; }
    api.post("/auth/verify-email", { token }).then(() => setState("ok")).catch(() => setState("error"));
  }, [token]);

  return (
    <Card className="w-full text-center shadow-lift">
      {state === "loading" && <div className="flex justify-center py-6"><Spinner /></div>}
      {state === "ok" && (
        <>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-2xl shadow-glow">✅</div>
          <h1 className="mb-2 text-2xl font-bold text-ink">האימייל אומת</h1>
          <p className="text-ink-muted">החשבון פעיל. אפשר להתחבר.</p>
          <Link href="/login" className="mt-4 inline-block text-brand hover:underline">להתחברות</Link>
        </>
      )}
      {state === "error" && (
        <>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-400/15 text-2xl">⚠️</div>
          <h1 className="mb-2 text-2xl font-bold text-ink">הקישור אינו תקין</h1>
          <p className="text-ink-muted">קישור האימות פג תוקף או כבר נוצל.</p>
          <Link href="/login" className="mt-4 inline-block text-brand hover:underline">חזרה</Link>
        </>
      )}
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell>
      <Suspense fallback={<div className="flex justify-center py-6"><Spinner /></div>}>
        <VerifyInner />
      </Suspense>
    </AuthShell>
  );
}
