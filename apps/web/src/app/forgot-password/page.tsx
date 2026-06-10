"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { AuthShell } from "@/components/marketing";
import { Button, Card, Field, Input } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async () => {
    try { await api.post("/auth/forgot-password", { email }); } finally { setSent(true); }
  };

  return (
    <AuthShell>
      <Card className="w-full shadow-lift">
        <h1 className="mb-4 text-2xl font-bold text-ink">איפוס סיסמה</h1>
        {sent ? (
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-2xl shadow-glow">📧</div>
            <p className="text-ink-muted">אם קיים חשבון עם כתובת זו, נשלח אליו קישור לאיפוס סיסמה. בדוק גם את תיקיית הספאם.</p>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-ink-muted">הזן את כתובת המייל של החשבון ונשלח לך קישור לבחירת סיסמה חדשה.</p>
            <Field label="אימייל">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && email && submit()} autoFocus />
            </Field>
            <Button className="w-full" onClick={submit} disabled={!email}>שליחת קישור איפוס</Button>
          </>
        )}
        <Link href="/login" className="mt-4 inline-block text-sm text-brand hover:underline">חזרה להתחברות</Link>
      </Card>
    </AuthShell>
  );
}
