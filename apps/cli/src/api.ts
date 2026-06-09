/** Thin API client using global fetch (Node 18+). */
import { loadConfig } from "./config.js";

export interface ApiError extends Error {
  status: number;
  code?: string;
}

async function request<T>(method: string, path: string, opts: {
  body?: unknown;
  formData?: FormData;
  token?: string;
} = {}): Promise<T> {
  const cfg = loadConfig();
  const token = opts.token ?? cfg.token;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${cfg.apiUrl}${path}`, { method, headers, body });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? `HTTP ${res.status}`) as ApiError;
    err.status = res.status;
    err.code = data?.error?.code;
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, formData: FormData) => request<T>("POST", path, { formData }),
  me: <T>(token: string) => request<T>("GET", "/auth/me", { token }),
};
