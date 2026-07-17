"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Code2, Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/components/providers";
import { useLocale } from "@/components/locale-context";
import { api, ApiError } from "@/lib/api";
import { Button, Card, Field, Input } from "@/components/ui";
import { DashHeader } from "@/components/dashboard";

// The developer-alert notification kinds that can be emailed, with their label keys.
// A checkbox = "email me this"; unchecking adds the kind to the server-side opt-out.
const NOTIF_KINDS: { kind: string; key: string }[] = [
  { kind: "release.validation_failed", key: "dash.st.notif.validationFailed" },
  { kind: "release.published", key: "dash.st.notif.published" },
  { kind: "rollout.paused", key: "dash.st.notif.rolloutPaused" },
  { kind: "rollback.done", key: "dash.st.notif.rollbackDone" },
  { kind: "install_link.used", key: "dash.st.notif.installUsed" },
  { kind: "feedback.received", key: "dash.st.notif.feedback" },
  { kind: "high_failure_rate", key: "dash.st.notif.highFailure" },
  { kind: "new_login", key: "dash.st.notif.newLogin" },
];

export default function SettingsPage() {
  const { user, refreshMe } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [upgrading, setUpgrading] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [showDisable, setShowDisable] = useState(false);
  const [disablePw, setDisablePw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [savingNotif, setSavingNotif] = useState<string | null>(null);

  const toggleNotif = async (kind: string, enabled: boolean) => {
    if (!user) return;
    const current = user.emailNotifOptout ?? [];
    const next = enabled ? current.filter((k) => k !== kind) : [...current, kind];
    setSavingNotif(kind);
    setError(null);
    try {
      await api.patch("/auth/me", { emailNotifOptout: next });
      await refreshMe();
    } catch (e) { setError(e instanceof ApiError ? e.message : t("dash.err")); }
    finally { setSavingNotif(null); }
  };

  // Intentional one-way sync of the editable field with the async-loaded user.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (user) setDisplayName(user.displayName); }, [user]);

  const saveName = async () => {
    setError(null);
    setNameSaved(false);
    setSavingName(true);
    try {
      await api.patch("/auth/me", { displayName: displayName.trim() });
      await refreshMe();
      setNameSaved(true);
    } catch (e) { setError(e instanceof ApiError ? e.message : t("dash.err")); }
    finally { setSavingName(false); }
  };

  const becomeDeveloper = async () => {
    setError(null);
    setUpgrading(true);
    try {
      await api.post("/auth/become-developer");
      await refreshMe();
      router.push("/app"); // now a developer - open the developer dashboard
    } catch (e) { setError(e instanceof ApiError ? e.message : t("dash.err")); }
    finally { setUpgrading(false); }
  };

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
  const disable2fa = async () => {
    setError(null);
    try {
      await api.post("/auth/2fa/disable", { password: disablePw });
      setShowDisable(false);
      setDisablePw("");
      await refreshMe();
    } catch (e) { setError(e instanceof ApiError ? e.message : t("dash.err")); }
  };

  return (
    <div className="max-w-2xl">
      <DashHeader icon={<SettingsIcon size={20} />} title={t("dash.st.title")} subtitle={t("dash.st.sub")} />

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-ink">{t("dash.st.account")}</h2>
        <p className="mb-4 text-sm text-ink-muted">{user?.email} • {user?.role}</p>
        <Field label={t("dash.st.name")}>
          <Input
            value={displayName}
            maxLength={120}
            onChange={(e) => { setDisplayName(e.target.value); setNameSaved(false); }}
          />
        </Field>
        <p className="-mt-2 mb-3 text-xs text-ink-muted">{t("dash.st.name.hint")}</p>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={saveName}
            disabled={savingName || !displayName.trim() || displayName.trim() === user?.displayName}
          >
            {t("dash.st.name.save")}
          </Button>
          {nameSaved && <span className="text-sm text-success">{t("dash.st.name.saved")}</span>}
        </div>
      </Card>

      {user?.role === "end_user" && (
        <Card className="mb-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold text-ink">
            <Code2 size={17} className="text-brand" /> {t("dash.st.becomedev")}
          </h2>
          <p className="mb-3 text-sm text-ink-muted">{t("dash.st.becomedev.body")}</p>
          <Button size="sm" onClick={becomeDeveloper} disabled={upgrading}>
            {upgrading ? t("dash.st.becomedev.busy") : t("dash.st.becomedev.cta")}
          </Button>
        </Card>
      )}

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-ink">{t("dash.st.appearance")}</h2>
        <div className="flex gap-2">
          <Button size="sm" variant={theme === "light" ? "primary" : "secondary"} onClick={() => setTheme("light")}>{t("dash.st.light")}</Button>
          <Button size="sm" variant={theme === "dark" ? "primary" : "secondary"} onClick={() => setTheme("dark")}>{t("dash.st.dark")}</Button>
          <Button size="sm" variant={theme === "system" ? "primary" : "secondary"} onClick={() => setTheme("system")}>{t("dash.st.system")}</Button>
        </div>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-ink">{t("dash.st.notif")}</h2>
        <p className="mb-3 text-sm text-ink-muted">{t("dash.st.notif.hint")}</p>
        <div className="space-y-0.5">
          {NOTIF_KINDS.map(({ kind, key }) => {
            const enabled = !(user?.emailNotifOptout ?? []).includes(kind);
            return (
              <label key={kind} className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-surface-2">
                <span className="text-sm text-ink">{t(key)}</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={enabled}
                  disabled={savingNotif === kind}
                  onChange={(e) => toggleNotif(kind, e.target.checked)}
                />
              </label>
            );
          })}
        </div>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-ink">{t("dash.st.2fa")}</h2>
        {error && <p className="mb-3 rounded-md bg-red-50 dark:bg-red-500/10 p-2 text-sm text-danger dark:text-red-400">{error}</p>}
        {user?.twoFactorEnabled ? (
          <div>
            <p className="mb-3 text-sm text-success">{t("dash.st.2fa.on")}</p>
            {showDisable ? (
              <div className="space-y-3">
                <Field label={t("dash.st.2fa.pw")}>
                  <Input type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} autoComplete="current-password" />
                </Field>
                <div className="flex gap-2">
                  <Button variant="danger" size="sm" onClick={disable2fa} disabled={!disablePw}>{t("dash.st.2fa.disableconfirm")}</Button>
                  <Button variant="secondary" size="sm" onClick={() => { setShowDisable(false); setDisablePw(""); setError(null); }}>{t("dash.st.cancel")}</Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setShowDisable(true)}>{t("dash.st.2fa.disable")}</Button>
            )}
          </div>
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

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-ink">{t("dash.st.sessions")}</h2>
        <Button variant="danger" size="sm" onClick={() => api.post("/auth/logout-all")}>
          {t("dash.st.logoutall")}
        </Button>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-ink">{t("dash.st.danger")}</h2>
        <p className="text-sm text-ink-muted">
          {t("dash.st.danger.body")}{" "}
          <a href="mailto:glasser.avraham@gmail.com?subject=Delete%20my%20ExtSync%20account" className="text-brand hover:underline">glasser.avraham@gmail.com</a>
        </p>
      </Card>
    </div>
  );
}
