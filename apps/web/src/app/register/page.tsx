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
import { cn } from "@/lib/utils";
import { CircleCheck, Code2, User } from "lucide-react";

type AccountType = "personal" | "developer";

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
  const [accountType, setAccountType] = useState<AccountType>("personal");
  const [serverError, setServerError] = useState<string | null>(null);
  const schema = z.object({
    displayName: z.string().min(1, t("reg.err.name")),
    orgName: z.string().optional().default(""),
    email: z.string().email(t("reg.err.email")),
    password: z.string().min(10, t("reg.err.password")).refine(
      (v) => [/[a-z]/.test(v), /[A-Z]/.test(v), /\d/.test(v), /[^a-zA-Z0-9]/.test(v)].filter(Boolean).length >= 2,
      t("reg.err.password"),
    ),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: t("reg.err.terms") }) }),
  });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: Form) => {
    setServerError(null);
    try {
      await api.post("/auth/register", { ...data, accountType });
      setDone(true);
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : t("reg.failed"));
    }
  };

  if (done) {
    return (
      <AuthShell>
        <Card className="w-full text-center shadow-lift">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow"><CircleCheck className="h-7 w-7 text-white" strokeWidth={1.75} /></div>
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
        <h1 className="mb-4 text-2xl font-bold text-ink">{t("reg.title")}</h1>

        {/* Account type: a plain personal account (rate + library) or a
            developer account that can also publish extensions. */}
        <p className="mb-2 text-sm font-medium text-ink">{t("reg.type.label")}</p>
        <div className="mb-5 grid gap-2 sm:grid-cols-2">
          {([
            { id: "personal" as const, Icon: User, t: t("reg.type.personal"), d: t("reg.type.personal.d") },
            { id: "developer" as const, Icon: Code2, t: t("reg.type.developer"), d: t("reg.type.developer.d") },
          ]).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setAccountType(opt.id)}
              aria-pressed={accountType === opt.id}
              className={cn(
                "rounded-lg border p-3 text-start transition-colors",
                accountType === opt.id
                  ? "border-brand bg-brand/5 ring-1 ring-brand"
                  : "border-line hover:bg-surface-2",
              )}
            >
              <span className="flex items-center gap-2 font-medium text-ink">
                <opt.Icon size={16} className="text-brand" /> {opt.t}
              </span>
              <span className="mt-1 block text-xs text-ink-muted">{opt.d}</span>
            </button>
          ))}
        </div>

        {serverError && <p className="mb-4 rounded-md bg-red-50 dark:bg-red-500/10 p-3 text-sm text-danger dark:text-red-400">{serverError}</p>}
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Field label={t("reg.name")} error={errors.displayName?.message}>
            <Input {...register("displayName")} />
          </Field>
          {accountType === "developer" && (
            <Field label={t("reg.org")} error={errors.orgName?.message}>
              <Input {...register("orgName")} />
            </Field>
          )}
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
        <div className="my-5 flex items-center gap-3 text-xs text-ink-muted">
          <span className="h-px flex-1 bg-line" />{t("auth.or")}<span className="h-px flex-1 bg-line" />
        </div>
        <a href={`${api.apiUrl}/auth/google/start`} className="block">
          <Button type="button" variant="secondary" className="w-full">{t("auth.google")}</Button>
        </a>
        <p className="mt-4 text-center text-sm text-ink-muted">
          {t("reg.have")} <Link href="/login" className="text-brand hover:underline">{t("reg.login")}</Link>
        </p>
      </Card>
    </AuthShell>
  );
}
