"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { AuthShell } from "@/components/marketing";
import { useLocale } from "@/components/locale-context";
import { Button, Card, Field, Input } from "@/components/ui";
import { Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async () => {
    try { await api.post("/auth/forgot-password", { email }); } finally { setSent(true); }
  };

  return (
    <AuthShell>
      <Card className="w-full shadow-lift">
        <h1 className="mb-4 text-2xl font-bold text-ink">{t("fp.title")}</h1>
        {sent ? (
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow"><Mail className="h-7 w-7 text-white" strokeWidth={1.75} /></div>
            <p className="text-ink-muted">{t("fp.sent")}</p>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-ink-muted">{t("fp.body")}</p>
            <Field label={t("fp.email")}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && email && submit()} autoFocus />
            </Field>
            <Button className="w-full" onClick={submit} disabled={!email}>{t("fp.submit")}</Button>
          </>
        )}
        <Link href="/login" className="mt-4 inline-block text-sm text-brand hover:underline">{t("fp.back")}</Link>
      </Card>
    </AuthShell>
  );
}
