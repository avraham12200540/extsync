"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
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
    <Card className="w-full max-w-md text-center">
      {state === "loading" && <div className="flex justify-center"><Spinner /></div>}
      {state === "ok" && (
        <>
          <h1 className="mb-2 text-2xl font-semibold text-ink">האימייל אומת ✓</h1>
          <p className="text-ink-muted">החשבון פעיל. אפשר להתחבר.</p>
          <Link href="/login" className="mt-4 inline-block text-brand hover:underline">להתחברות</Link>
        </>
      )}
      {state === "error" && (
        <>
          <h1 className="mb-2 text-2xl font-semibold text-ink">הקישור אינו תקין</h1>
          <p className="text-ink-muted">קישור האימות פג תוקף או כבר נוצל.</p>
          <Link href="/login" className="mt-4 inline-block text-brand hover:underline">חזרה</Link>
        </>
      )}
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <Suspense fallback={<Spinner />}>
        <VerifyInner />
      </Suspense>
    </div>
  );
}
