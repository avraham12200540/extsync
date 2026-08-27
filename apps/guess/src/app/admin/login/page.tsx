"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { classifyAdminAuthError } from "@/lib/admin-client";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { useTranslation } from "@/lib/use-translation";

function errorKeyFor(kind: string): string {
  switch (kind) {
    case "invalidCredentials":
      return "admin.login.invalidCredentials";
    case "rateLimited":
      return "state.rateLimited";
    case "offline":
      return "state.offline";
    case "crossOrigin":
      return "admin.login.crossOriginError";
    default:
      return "state.genericError";
  }
}

export default function AdminLoginPage() {
  const t = useTranslation();
  const router = useRouter();
  const { status, login } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") router.replace("/admin");
  }, [status, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrorKey(null);
    try {
      await login(email, password);
      router.replace("/admin");
    } catch (err) {
      setErrorKey(errorKeyFor(classifyAdminAuthError(err)));
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="text-xl font-semibold text-ink">{t("admin.login.title")}</h1>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div>
          <label htmlFor="admin-login-email" className="mb-1 block text-xs text-ink-muted">
            {t("admin.login.emailLabel")}
          </label>
          <input
            id="admin-login-email"
            type="email"
            required
            autoComplete="username"
            autoFocus
            dir="auto"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent"
          />
        </div>
        <div>
          <label htmlFor="admin-login-password" className="mb-1 block text-xs text-ink-muted">
            {t("admin.login.passwordLabel")}
          </label>
          <input
            id="admin-login-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent"
          />
        </div>

        {errorKey && (
          <p role="alert" className="text-sm text-ink-muted">
            {t(errorKey)}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded border border-accent bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition-opacity disabled:opacity-50"
        >
          {pending ? t("admin.login.submitting") : t("admin.login.submit")}
        </button>
      </form>

      <Link href="/" className="mt-8 text-sm text-ink-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink">
        {t("admin.login.backToGame")}
      </Link>
    </main>
  );
}
