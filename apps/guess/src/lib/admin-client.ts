"use client";

import type {
  AdminForumUserDetailView,
  AdminForumUserView,
  AdminSessionView,
  ImportRunView,
  ModerationPostDetailView,
  ModerationQueueItemView,
  PaginatedView,
} from "@/admin/view-models";
import { bootstrap as bootstrapPlayerSession } from "./guess-client";

/**
 * Client-side wrapper for /guess/api/admin/**. Mirrors guess-client.ts's
 * security discipline exactly: the raw admin CSRF token lives ONLY in a
 * module-level in-memory variable (never localStorage/sessionStorage,
 * never a URL, never a data attribute), and the admin session token itself
 * is never visible to this module at all - it only ever travels as the
 * `guess_admin_session` HttpOnly cookie the browser manages.
 *
 * A real admin CSRF token is issued ONLY at login (see AdminLoginResult) -
 * there is no endpoint that reissues one for an already-valid session,
 * because the server only ever stores its SHA-256 hash and cannot recover
 * the raw value later. That means a hard page reload keeps the session
 * cookie valid but loses the in-memory CSRF token. Rather than change the
 * Stage 5 API surface to work around that, every mutating call here can
 * throw AdminCsrfMissingError - callers (admin-auth-context.tsx) catch it
 * and prompt for a fresh sign-in (which is exactly the login endpoint,
 * already CSRF-protected via the pre-auth nonce below, and always returns
 * a fresh token), then retry the original action. This is a legitimate,
 * common "confirm your password to continue" pattern for a sensitive
 * action after a reload, not a workaround for a missing capability.
 */
const API_BASE = "/guess/api/admin";

let adminCsrfToken: string | null = null;
let cachedEmail: string | null = null;

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/** Thrown locally, before any network request, when a mutating call has no admin CSRF token cached - never sent as a real request. Callers must reauthenticate() and retry. */
export class AdminCsrfMissingError extends Error {}

/** Thrown when the server itself rejects a request as unauthenticated/unauthorized (401/403) - callers must treat this as a full sign-out, not a retry. */
export class AdminUnauthenticatedError extends Error {}

export function getCachedAdminEmail(): string | null {
  return cachedEmail;
}

export function hasAdminCsrfToken(): boolean {
  return adminCsrfToken !== null;
}

/** Called on sign-out (explicit or forced) - clears every in-memory credential-adjacent value this module holds. */
export function clearAdminClientState(): void {
  adminCsrfToken = null;
  cachedEmail = null;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let parsed: { error?: { code?: string; message?: string } } = {};
    try {
      parsed = (await response.json()) as typeof parsed;
    } catch {
      // Non-JSON error body (should not normally happen) - fall through to the generic shape below.
    }
    const retryAfterHeader = response.headers.get("retry-after");
    throw new AdminApiError(
      response.status,
      parsed.error?.code ?? "internal_error",
      parsed.error?.message ?? "Unknown error",
      retryAfterHeader ? Number(retryAfterHeader) : undefined,
    );
  }
  return response.json() as Promise<T>;
}

interface FetchOpts {
  method: "GET" | "POST";
  body?: unknown;
}

async function adminApiFetch<T>(path: string, opts: FetchOpts): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.method === "POST") {
    headers["content-type"] = "application/json";
    if (!adminCsrfToken) throw new AdminCsrfMissingError("no admin CSRF token cached - reauthenticate before retrying");
    headers["x-guess-admin-csrf"] = adminCsrfToken;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: opts.method,
    credentials: "include",
    headers,
    body: opts.method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
  });

  if (response.status === 401 || response.status === 403) {
    clearAdminClientState();
    throw new AdminUnauthenticatedError("admin session is no longer valid");
  }

  return parseResponse<T>(response);
}

function buildQuery(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export interface AdminLoginResult extends AdminSessionView {
  csrfToken: string;
}

/**
 * Also used for the re-authentication prompt (a hard reload's recovery
 * path) - it is the exact same call either way, since the server has no
 * separate "confirm my existing session" endpoint that could issue a new
 * CSRF token.
 */
export async function adminLogin(email: string, password: string): Promise<AdminLoginResult> {
  const player = await bootstrapPlayerSession();
  const response = await fetch(`${API_BASE}/login`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "x-guess-csrf": player.csrfToken },
    body: JSON.stringify({ email, password }),
  });
  const result = await parseResponse<AdminLoginResult>(response);
  adminCsrfToken = result.csrfToken;
  cachedEmail = result.email;
  return result;
}

/** Read-only - never throws AdminCsrfMissingError (GET, no CSRF needed). Used both to gate the admin shell on mount and to recover the admin's email for the reauth prompt after a reload. */
export async function getAdminSession(): Promise<AdminSessionView> {
  const response = await fetch(`${API_BASE}/session`, { credentials: "include" });
  if (response.status === 401 || response.status === 403) {
    clearAdminClientState();
    throw new AdminUnauthenticatedError("no valid admin session");
  }
  const view = await parseResponse<AdminSessionView>(response);
  cachedEmail = view.email;
  return view;
}

/**
 * Logout is deliberately forgiving about a missing CSRF token: if the
 * admin reloaded and hasn't re-authenticated for anything yet, forcing a
 * password re-entry just to sign out would be absurd UX. In that case
 * this only clears local state and lets the server-side session expire
 * naturally (or be cleaned up by a future login's revoke-others) rather
 * than attempting a network call that would only fail the same way.
 */
export async function adminLogout(): Promise<void> {
  if (!adminCsrfToken) {
    clearAdminClientState();
    return;
  }
  try {
    await adminApiFetch<{ loggedOut: boolean }>("/logout", { method: "POST" });
  } finally {
    clearAdminClientState();
  }
}

export async function revokeOtherAdminSessions(): Promise<{ revokedCount: number }> {
  return adminApiFetch("/sessions/revoke-others", { method: "POST" });
}

export interface ForumUsersListParams {
  page?: number;
  pageSize?: number;
  sortField?: "forumUsername" | "createdAt" | "updatedAt" | "approvedPostCount";
  sortDirection?: "asc" | "desc";
  accountStatus?: "unknown" | "active" | "deleted" | "banned";
  adminOverride?: "none" | "force_eligible" | "force_ineligible";
  effectiveEligibleOnly?: boolean;
  usernameContains?: string;
}

export async function listForumUsers(params: ForumUsersListParams = {}): Promise<PaginatedView<AdminForumUserView>> {
  return adminApiFetch(`/forum-users${buildQuery(params)}`, { method: "GET" });
}

export async function getForumUserDetail(forumUserId: string): Promise<AdminForumUserDetailView> {
  return adminApiFetch(`/forum-users/${encodeURIComponent(forumUserId)}`, { method: "GET" });
}

export type EligibilityOverride = "none" | "force_eligible" | "force_ineligible";

export async function setForumUserOverride(forumUserId: string, override: EligibilityOverride): Promise<AdminForumUserDetailView> {
  return adminApiFetch(`/forum-users/${encodeURIComponent(forumUserId)}/eligibility-override`, { method: "POST", body: { override } });
}

export interface ModerationQueueParams {
  page?: number;
  pageSize?: number;
  sortField?: "postedAt" | "qualityScore" | "potentialLeakScore" | "wordCount";
  sortDirection?: "asc" | "desc";
  status?: "pending" | "approved" | "rejected" | "needs_review";
}

export async function listModerationQueue(params: ModerationQueueParams = {}): Promise<PaginatedView<ModerationQueueItemView>> {
  return adminApiFetch(`/moderation/queue${buildQuery(params)}`, { method: "GET" });
}

export async function getModerationPostDetail(forumPostId: string): Promise<ModerationPostDetailView> {
  return adminApiFetch(`/moderation/${encodeURIComponent(forumPostId)}`, { method: "GET" });
}

export async function approveModerationPost(forumPostId: string, expectedVersion: number): Promise<ModerationPostDetailView> {
  return adminApiFetch(`/moderation/${encodeURIComponent(forumPostId)}/approve`, { method: "POST", body: { expectedVersion } });
}

export async function rejectModerationPost(forumPostId: string, expectedVersion: number, reason?: string): Promise<ModerationPostDetailView> {
  return adminApiFetch(`/moderation/${encodeURIComponent(forumPostId)}/reject`, { method: "POST", body: { expectedVersion, reason } });
}

export async function editModerationPost(forumPostId: string, expectedVersion: number, cleanContent: string): Promise<ModerationPostDetailView> {
  return adminApiFetch(`/moderation/${encodeURIComponent(forumPostId)}/edit`, { method: "POST", body: { expectedVersion, cleanContent } });
}

export interface ImportRunsListParams {
  page?: number;
  pageSize?: number;
}

export async function listImportRuns(params: ImportRunsListParams = {}): Promise<PaginatedView<ImportRunView>> {
  return adminApiFetch(`/import-runs${buildQuery(params)}`, { method: "GET" });
}

export async function getImportRunDetail(importRunId: string): Promise<ImportRunView> {
  return adminApiFetch(`/import-runs/${encodeURIComponent(importRunId)}`, { method: "GET" });
}

export interface ImportTriggerResult {
  importRunId: string;
  status: "running" | "success" | "partial_failure" | "failed";
  stoppedReason: string;
  postsFetched: number;
  postsNew: number;
  postsDiverged: number;
  usersTouched: number;
  pagesFetched: number;
  errorCount: number;
}

export async function triggerImportRun(): Promise<ImportTriggerResult> {
  return adminApiFetch("/import-runs/trigger", { method: "POST" });
}

/** Shared classification for login/reauth error copy - never distinguishes "unknown email" from "wrong password" (the server itself is already constant-shape; this just maps status/code to a Hebrew/English-ready category, it must not invent a distinction the server didn't make). */
export type AdminAuthErrorKind = "invalidCredentials" | "rateLimited" | "crossOrigin" | "offline" | "generic";

export function classifyAdminAuthError(err: unknown): AdminAuthErrorKind {
  if (err instanceof AdminApiError) {
    if (err.status === 401) return "invalidCredentials";
    if (err.status === 429) return "rateLimited";
    if (err.status === 403) return "crossOrigin";
    return "generic";
  }
  if (err instanceof TypeError) return "offline";
  return "generic";
}
