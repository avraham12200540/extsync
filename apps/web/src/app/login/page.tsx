"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/components/providers";
import { AuthShell } from "@/components/marketing";
import { useLocale } from "@/components/locale-context";
import { Button, Card, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

type Form = { email: string; password: string };

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLocale();
  const { login, complete2fa } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  // Where to go after a successful login. Only same-origin paths are honored (no
  // open redirect). We RESOLVE ?next against our origin and compare origins - a
  // prefix check like "/" + not "//" is not enough, because the URL parser
  // normalizes backslashes (e.g. "/\evil.com" -> https://evil.com). Used e.g. by
  // "send feedback", which sends a logged-out user here and back to finish sending.
  const afterLogin = (): string => {
    if (typeof window === "undefined") return "/app";
    const n = new URLSearchParams(window.location.search).get("next");
    if (!n) return "/app";
    try {
      const u = new URL(n, window.location.origin);
      if (u.origin === window.location.origin) return u.pathname + u.search + u.hash;
    } catch { /* malformed - fall through */ }
    return "/app";
  };
  const schema = z.object({
    email: z.string().email(t("reg.err.email")),
    password: z.string().min(1, t("login.password")),
  });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Surface a failed Google OAuth round-trip (callback redirects with ?oauth=failed).
    if (params.get("oauth") === "failed") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setServerError(t("auth.google.failed"));
    }
    // A 2FA-enabled account that signed in with Google is handed off here with a
    // challenge to finish the second factor (OAuth never skips 2FA).
    const ch = params.get("challenge");
    if (ch) {
      setChallenge(ch);
      window.history.replaceState({}, "", "/login");
    }
  }, [t]);

  const onSubmit = async (data: Form) => {
    setServerError(null);
    try {
      const res = await login(data.email, data.password);
      if (res.twoFactorRequired && res.challenge) setChallenge(res.challenge);
      else router.push(afterLogin());
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : t("login.failed"));
    }
  };

  const submit2fa = async () => {
    if (!challenge) return;
    setServerError(null);
    try {
      await complete2fa(challenge, code);
      router.push(afterLogin());
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : t("dash.st.2fa.wrong"));
    }
  };

  return (
    <AuthShell>
      <Card className="w-full shadow-lift">
        <h1 className="mb-6 text-2xl font-bold text-ink">{t("login.title")}</h1>
        {serverError && <p className="mb-4 rounded-md bg-red-50 dark:bg-red-500/10 p-3 text-sm text-danger dark:text-red-400">{serverError}</p>}

        {!challenge ? (
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <Field label={t("login.email")} error={errors.email?.message}>
              <Input type="email" autoComplete="email" {...register("email")} />
            </Field>
            <Field label={t("login.password")} error={errors.password?.message}>
              <Input type="password" autoComplete="current-password" {...register("password")} />
            </Field>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t("login.busy") : t("login.submit")}
            </Button>
          </form>
        ) : (
          <div>
            <p className="mb-3 text-sm text-ink-muted">{t("login.2fa.body")}</p>
            <Field label={t("login.2fa.title")}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoFocus />
            </Field>
            <Button className="w-full" onClick={submit2fa}>{t("login.2fa.submit")}</Button>
          </div>
        )}

        {!challenge && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-ink-muted">
              <span className="h-px flex-1 bg-line" />{t("auth.or")}<span className="h-px flex-1 bg-line" />
            </div>
            <a href={`${api.apiUrl}/auth/google/start`} className="block">
              <Button type="button" variant="secondary" className="w-full">{t("auth.google")}</Button>
            </a>
          </>
        )}

        <div className="mt-4 flex justify-between text-sm">
          <Link href="/forgot-password" className="text-brand hover:underline">{t("login.forgot")}</Link>
          <Link href="/register" className="text-brand hover:underline">{t("login.register")}</Link>
        </div>
      </Card>
    </AuthShell>
  );
}
