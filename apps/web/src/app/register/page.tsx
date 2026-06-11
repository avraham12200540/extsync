"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/marketing";
import { useLocale } from "@/components/locale-context";
import { Button, Card, Field, Input } from "@/components/ui";

type Form = {
  displayName: string;
  orgName?: string;
  email: string;
  password: string;
  acceptTerms: true;
};

export default function RegisterPage() {
  const { t } = useLocale();
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const schema = z.object({
    displayName: z.string().min(1, t("reg.err.name")),
    orgName: z.string().optional().default(""),
    email: z.string().email(t("reg.err.email")),
    password: z.string().min(10, t("reg.err.password")),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: t("reg.err.terms") }) }),
  });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: Form) => {
    setServerError(null);
    try {
      await api.post("/auth/register", data);
      setDone(true);
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : t("reg.failed"));
    }
  };

  if (done) {
    return (
      <AuthShell>
        <Card className="w-full text-center shadow-lift">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-2xl shadow-glow">🎉</div>
          <h1 className="mb-2 text-2xl font-bold text-ink">{t("reg.done.title")}</h1>
          <p className="text-ink-muted">{t("reg.done.body")}</p>
          <Link href="/login" className="mt-4 inline-block text-brand hover:underline">{t("reg.done.back")}</Link>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Card className="w-full shadow-lift">
        <h1 className="mb-6 text-2xl font-bold text-ink">{t("reg.title")}</h1>
        {serverError && <p className="mb-4 rounded-md bg-red-50 dark:bg-red-500/10 p-3 text-sm text-danger dark:text-red-400">{serverError}</p>}
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Field label={t("reg.name")} error={errors.displayName?.message}>
            <Input {...register("displayName")} />
          </Field>
          <Field label={t("reg.org")} error={errors.orgName?.message}>
            <Input {...register("orgName")} />
          </Field>
          <Field label={t("reg.email")} error={errors.email?.message}>
            <Input type="email" autoComplete="email" {...register("email")} />
          </Field>
          <Field label={t("reg.password")} error={errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...register("password")} />
          </Field>
          <label className="mb-4 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" {...register("acceptTerms")} />
            {t("reg.terms")}
          </label>
          {errors.acceptTerms && <p className="mb-3 text-xs text-danger">{errors.acceptTerms.message}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? t("reg.busy") : t("reg.submit")}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-ink-muted">
          {t("reg.have")} <Link href="/login" className="text-brand hover:underline">{t("reg.login")}</Link>
        </p>
      </Card>
    </AuthShell>
  );
}
