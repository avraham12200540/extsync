"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AdminAuthErrorKind } from "./admin-client";
import {
  AdminCsrfMissingError,
  AdminUnauthenticatedError,
  adminLogin,
  adminLogout,
  classifyAdminAuthError,
  getAdminSession,
  getCachedAdminEmail,
} from "./admin-client";

export type AdminAuthStatus = "checking" | "authenticated" | "unauthenticated";

interface ReauthState {
  open: boolean;
  pending: boolean;
  errorKind: AdminAuthErrorKind | null;
  submit: (password: string) => Promise<void>;
  cancel: () => void;
}

interface AdminAuthValue {
  status: AdminAuthStatus;
  email: string | null;
  sessionExpiresAt: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Wraps a single mutating admin-client call. If it fails only because
   * there is no admin CSRF token cached (AdminCsrfMissingError - a hard
   * page reload lost the in-memory token, the session cookie is still
   * fine), this opens the reauth dialog, waits for the admin to confirm
   * their password, then retries the action exactly once. If the server
   * itself rejects the request as unauthenticated (AdminUnauthenticatedError),
   * this clears auth state so the shell redirects to login - it never retries.
   */
  withReauth: <T>(action: () => Promise<T>) => Promise<T>;
  reauth: ReauthState;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AdminAuthStatus>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);

  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthPending, setReauthPending] = useState(false);
  const [reauthErrorKind, setReauthErrorKind] = useState<AdminAuthErrorKind | null>(null);
  const reauthResolverRef = useRef<{ resolve: () => void; reject: (err: unknown) => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await getAdminSession();
        if (cancelled) return;
        setEmail(session.email);
        setSessionExpiresAt(session.sessionExpiresAt);
        setStatus("authenticated");
      } catch {
        if (cancelled) return;
        setStatus("unauthenticated");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (loginEmail: string, password: string) => {
    const result = await adminLogin(loginEmail, password);
    setEmail(result.email);
    setSessionExpiresAt(result.sessionExpiresAt);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    await adminLogout();
    setEmail(null);
    setSessionExpiresAt(null);
    setStatus("unauthenticated");
  }, []);

  const requestReauth = useCallback((): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      reauthResolverRef.current = { resolve, reject };
      setReauthErrorKind(null);
      setReauthOpen(true);
    });
  }, []);

  const submitReauth = useCallback(
    async (password: string) => {
      const targetEmail = email ?? getCachedAdminEmail();
      if (!targetEmail) {
        setReauthErrorKind("generic");
        return;
      }
      setReauthPending(true);
      setReauthErrorKind(null);
      try {
        await adminLogin(targetEmail, password);
        setReauthPending(false);
        setReauthOpen(false);
        reauthResolverRef.current?.resolve();
        reauthResolverRef.current = null;
      } catch (err) {
        setReauthPending(false);
        setReauthErrorKind(classifyAdminAuthError(err));
      }
    },
    [email],
  );

  const cancelReauth = useCallback(() => {
    setReauthOpen(false);
    setReauthPending(false);
    setReauthErrorKind(null);
    reauthResolverRef.current?.reject(new AdminCsrfMissingError("reauthentication cancelled"));
    reauthResolverRef.current = null;
  }, []);

  const withReauth = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (err) {
        if (err instanceof AdminCsrfMissingError) {
          await requestReauth();
          return action();
        }
        if (err instanceof AdminUnauthenticatedError) {
          setStatus("unauthenticated");
          setEmail(null);
          setSessionExpiresAt(null);
        }
        throw err;
      }
    },
    [requestReauth],
  );

  const value: AdminAuthValue = {
    status,
    email,
    sessionExpiresAt,
    login,
    logout,
    withReauth,
    reauth: {
      open: reauthOpen,
      pending: reauthPending,
      errorKind: reauthErrorKind,
      submit: submitReauth,
      cancel: cancelReauth,
    },
  };

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within an AdminAuthProvider");
  return ctx;
}
