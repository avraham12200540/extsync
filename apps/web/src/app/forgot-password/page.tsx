"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, Card, Field, Input } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async () => {
    try { await api.post("/auth/forgot-password", { email }); } finally { setSent(true); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-md">
        <h1 className="mb-4 text-2xl font-semibold text-ink">איפוס סיסמה</h1>
        {sent ? (
          <p className="text-ink-muted">אם קיים חשבון עם כתובת זו, נשלח אליו קישור לאיפוס סיסמה.</p>
        ) : (
          <>
            <Field label="אימייל"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Button className="w-full" onClick={submit} disabled={!email}>שליחת קישור איפוס</Button>
          </>
        )}
        <Link href="/login" className="mt-4 inline-block text-sm text-brand hover:underline">חזרה להתחברות</Link>
      </Card>
    </div>
  );
}
