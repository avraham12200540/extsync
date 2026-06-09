"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { useAuth } from "@/components/providers";
import { api, ApiError } from "@/lib/api";
import { Button, Card, Field, Input } from "@/components/ui";

export default function SettingsPage() {
  const { user, refreshMe } = useAuth();
  const { theme, setTheme } = useTheme();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const begin2fa = async () => {
    setError(null);
    try { setSetup(await api.post("/auth/2fa/setup")); }
    catch (e) { setError(e instanceof ApiError ? e.message : "שגיאה"); }
  };
  const confirm2fa = async () => {
    setError(null);
    try {
      const res = await api.post<{ recoveryCodes: string[] }>("/auth/2fa/verify", { code });
      setRecovery(res.recoveryCodes);
      setSetup(null);
      await refreshMe();
    } catch (e) { setError(e instanceof ApiError ? e.message : "קוד שגוי"); }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold text-ink">הגדרות חשבון</h1>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-ink">פרטי חשבון</h2>
        <p className="text-sm text-ink-muted">{user?.displayName} • {user?.email} • {user?.role}</p>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-ink">מראה</h2>
        <div className="flex gap-2">
          <Button size="sm" variant={theme === "light" ? "primary" : "secondary"} onClick={() => setTheme("light")}>בהיר</Button>
          <Button size="sm" variant={theme === "dark" ? "primary" : "secondary"} onClick={() => setTheme("dark")}>כהה</Button>
          <Button size="sm" variant={theme === "system" ? "primary" : "secondary"} onClick={() => setTheme("system")}>מערכת</Button>
        </div>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-ink">אימות דו-שלבי (2FA)</h2>
        {error && <p className="mb-3 rounded-md bg-red-50 p-2 text-sm text-danger">{error}</p>}
        {user?.twoFactorEnabled ? (
          <p className="text-sm text-success">אימות דו-שלבי מופעל ✓</p>
        ) : recovery ? (
          <div>
            <p className="mb-2 text-sm text-ink">2FA הופעל. שמור את קודי השחזור במקום בטוח:</p>
            <div className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-3 font-mono text-xs">
              {recovery.map((c) => <span key={c}>{c}</span>)}
            </div>
          </div>
        ) : setup ? (
          <div>
            <p className="mb-2 text-sm text-ink-muted">סרוק באפליקציית אימות (Google Authenticator וכו') או הזן ידנית:</p>
            <code className="mb-3 block break-all rounded bg-surface-2 p-2 text-xs">{setup.secret}</code>
            <Field label="הזן את הקוד מהאפליקציה"><Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" /></Field>
            <Button onClick={confirm2fa} disabled={code.length < 6}>הפעלה</Button>
          </div>
        ) : (
          <Button onClick={begin2fa}>הפעלת אימות דו-שלבי</Button>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-ink">אבטחת סשנים</h2>
        <Button variant="danger" size="sm" onClick={() => api.post("/auth/logout-all")}>
          התנתקות מכל המכשירים
        </Button>
      </Card>
    </div>
  );
}
