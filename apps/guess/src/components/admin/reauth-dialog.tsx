"use client";

import { useState } from "react";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { useTranslation } from "@/lib/use-translation";
import { Dialog } from "./dialog";

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

/**
 * Prompts for the current admin's password to obtain a fresh CSRF token
 * (see admin-client.ts's module doc on why a hard reload loses it while
 * the session cookie survives). Rendered once, globally, by the admin
 * shell - src/lib/admin-auth-context.tsx's withReauth() opens it from
 * anywhere a mutating action is attempted.
 */
export function ReauthDialog() {
  const t = useTranslation();
  const { reauth, email } = useAdminAuth();
  const [password, setPassword] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await reauth.submit(password);
    setPassword("");
  }

  function handleCancel() {
    setPassword("");
    reauth.cancel();
  }

  return (
    <Dialog open={reauth.open} titleId="admin-reauth-dialog-title" title={t("admin.reauth.title")} onDismiss={handleCancel}>
      <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-3">
        <p className="text-sm text-ink-muted">{t("admin.reauth.body")}</p>
        {email && (
          <p dir="auto" className="text-sm text-ink">
            {email}
          </p>
        )}
        <div>
          <label htmlFor="admin-reauth-password" className="mb-1 block text-xs text-ink-muted">
            {t("admin.login.passwordLabel")}
          </label>
          <input
            id="admin-reauth-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent"
          />
        </div>
        {reauth.errorKind && (
          <p role="alert" className="text-sm text-ink-muted">
            {t(errorKeyFor(reauth.errorKind))}
          </p>
        )}
        <div className="mt-2 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleCancel}
            disabled={reauth.pending}
            className="text-sm text-ink-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
          >
            {t("admin.reauth.cancel")}
          </button>
          <button
            type="submit"
            disabled={reauth.pending || password.length === 0}
            className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity disabled:opacity-50"
          >
            {reauth.pending ? t("admin.reauth.submitting") : t("admin.reauth.submit")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
