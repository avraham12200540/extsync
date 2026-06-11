"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/components/providers";
import { useLocale } from "@/components/locale-context";
import { api, ApiError } from "@/lib/api";
import { Button, Card, Field, Input } from "@/components/ui";
import { DashHeader } from "@/components/dashboard";

export default function SettingsPage() {
  const { user, refreshMe } = useAuth();
  const { t } = useLocale();
  const { theme, setTheme } = useTheme();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const begin2fa = async () => {
    setError(null);
    try { setSetup(await api.post("/auth/2fa/setup")); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("dash.err")); }
  };
  const confirm2fa = async () => {
    setError(null);
    try {
      const res = await api.post<{ recoveryCodes: string[] }>("/auth/2fa/verify", { code });
      setRecovery(res.recoveryCodes);
      setSetup(null);
      await refreshMe();
    } catch (e) { setError(e instanceof ApiError ? e.message : t("dash.st.2fa.wrong")); }
  };

  return (
    <div className="max-w-2xl">
      <DashHeader icon={<SettingsIcon size={20} />} title={t("dash.st.title")} subtitle={t("dash.st.sub")} />

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-ink">{t("dash.st.account")}</h2>
        <p className="text-sm text-ink-muted">{user?.displayName} • {user?.email} • {user?.role}</p>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-ink">{t("dash.st.appearance")}</h2>
        <div className="flex gap-2">
          <Button size="sm" variant={theme === "light" ? "primary" : "secondary"} onClick={() => setTheme("light")}>{t("dash.st.light")}</Button>
          <Button size="sm" variant={theme === "dark" ? "primary" : "secondary"} onClick={() => setTheme("dark")}>{t("dash.st.dark")}</Button>
          <Button size="sm" variant={theme === "system" ? "primary" : "secondary"} onClick={() => setTheme("system")}>{t("dash.st.system")}</Button>
        </div>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-ink">{t("dash.st.2fa")}</h2>
        {error && <p className="mb-3 rounded-md bg-red-50 dark:bg-red-500/10 p-2 text-sm text-danger dark:text-red-400">{error}</p>}
        {user?.twoFactorEnabled ? (
          <p className="text-sm text-success">{t("dash.st.2fa.on")}</p>
        ) : recovery ? (
          <div>
            <p className="mb-2 text-sm text-ink">{t("dash.st.2fa.recovery")}</p>
            <div className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-3 font-mono text-xs">
              {recovery.map((c) => <span key={c}>{c}</span>)}
            </div>
          </div>
        ) : setup ? (
          <div>
            <p className="mb-2 text-sm text-ink-muted">{t("dash.st.2fa.scan")}</p>
            <code className="mb-3 block break-all rounded bg-surface-2 p-2 text-xs">{setup.secret}</code>
            <Field label={t("dash.st.2fa.code")}><Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" /></Field>
            <Button onClick={confirm2fa} disabled={code.length < 6}>{t("dash.st.2fa.activate")}</Button>
          </div>
        ) : (
          <Button onClick={begin2fa}>{t("dash.st.2fa.enable")}</Button>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-ink">{t("dash.st.sessions")}</h2>
        <Button variant="danger" size="sm" onClick={() => api.post("/auth/logout-all")}>
          {t("dash.st.logoutall")}
        </Button>
      </Card>
    </div>
  );
}
