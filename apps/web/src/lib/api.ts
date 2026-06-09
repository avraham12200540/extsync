// Typed API client. Access token lives in memory (set by the auth context); the
// refresh token is an httpOnly cookie, so we send credentials and auto-refresh on 401.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

let accessToken: string | null = null;
let onAuthLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
export function setOnAuthLost(cb: () => void) {
  onAuthLost = cb;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include" });
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const data = await res.json();
    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.message || `HTTP ${res.status}`, err?.code, err?.details);
  }
  return data as T;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  let res = await rawFetch(path, init);
  if (res.status === 401 && path !== "/auth/refresh") {
    if (await tryRefresh()) {
      res = await rawFetch(path, init);
    } else {
      onAuthLost?.();
    }
  }
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  async upload<T>(path: string, formData: FormData): Promise<T> {
    let res = await rawFetch(path, { method: "POST", body: formData });
    if (res.status === 401 && (await tryRefresh())) {
      res = await rawFetch(path, { method: "POST", body: formData });
    }
    return parse<T>(res);
  },
  apiUrl: API_URL,
};

// ---- Shared response types (mirror backend camelCase schemas) ----
export interface Me {
  id: string;
  email: string;
  displayName: string;
  role: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  fullDescription?: string | null;
  iconUrl?: string | null;
  website?: string | null;
  repoUrl?: string | null;
  visibility: "public" | "private";
  status: string;
  extensionId?: string | null;
  bridgeMode: string;
  version: number;
  permissions: string[];
}

export interface Release {
  id: string;
  projectId: string;
  version: string;
  channel: string;
  status: string;
  sequence?: number | null;
  rolloutPercentage: number;
  permissionsChanged: boolean;
  requiresUserApproval: boolean;
  riskScore: number;
  releaseNotes?: string | null;
  validationReport?: any;
  publishedAt?: string | null;
  createdAt?: string | null;
}

export interface InstallLink {
  id: string;
  token: string;
  url: string;
  label: string;
  linkType: string;
  channel: string;
  usedCount: number;
  maxUses?: number | null;
  disabled: boolean;
}

export interface InstallPage {
  token: string;
  name: string;
  iconUrl?: string | null;
  shortDescription: string;
  developerName: string;
  website?: string | null;
  repoUrl?: string | null;
  privacyPolicyUrl?: string | null;
  visibility: string;
  channel: string;
  version?: string | null;
  publishedAt?: string | null;
  permissions: {
    permissions: string[];
    hostPermissions: string[];
    optionalPermissions: string[];
    usesNativeMessaging: boolean;
  };
  requiresAccount: boolean;
  hasBridge: boolean;
  installUri: string;
  usable: boolean;
  reason?: string | null;
}
