"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, setAccessToken, setOnAuthLost, type Me } from "@/lib/api";

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ twoFactorRequired?: boolean; challenge?: string }>;
  complete2fa: (challenge: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within Providers");
  return ctx;
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = async () => {
    try {
      const me = await api.get<Me>("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    setOnAuthLost(() => setUser(null));
    // Attempt silent session restore via the refresh cookie.
    (async () => {
      try {
        const r = await fetch(`${api.apiUrl}/auth/refresh`, { method: "POST", credentials: "include" });
        if (r.ok) {
          const data = await r.json();
          setAccessToken(data.accessToken);
          await refreshMe();
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login: AuthState["login"] = async (email, password) => {
    const res = await api.post<{ twoFactorRequired: boolean; challenge?: string; accessToken?: string; expiresIn?: number }>(
      "/auth/login", { email, password });
    if (res.twoFactorRequired) return { twoFactorRequired: true, challenge: res.challenge };
    setAccessToken(res.accessToken ?? null);
    await refreshMe();
    return {};
  };

  const complete2fa: AuthState["complete2fa"] = async (challenge, code) => {
    const res = await api.post<{ accessToken: string }>("/auth/2fa/verify", { challenge, code });
    setAccessToken(res.accessToken);
    await refreshMe();
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    setAccessToken(null);
    setUser(null);
  };

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, complete2fa, logout, refreshMe }),
    [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function Providers({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  }));
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem nonce={nonce}>
      <QueryClientProvider client={client}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
