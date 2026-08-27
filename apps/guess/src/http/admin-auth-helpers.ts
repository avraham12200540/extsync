import { ADMIN_CSRF_HEADER_NAME, ADMIN_SESSION_COOKIE_NAME } from "./admin-session";
import type { AdminSessionAndCsrfResult, AdminSessionRecord } from "./admin-session";
import { requireAdminSession, requireAdminSessionAndCsrf } from "./admin-session";
import type { AdminHttpDeps } from "./deps";
import { readCookie } from "./http-utils";

/** Read-only admin authentication - for GET admin endpoints, which must never mutate/extend/rotate a session (see admin-session.ts's module doc). */
export async function authenticateAdminOnly(deps: AdminHttpDeps, request: Request, now: Date): Promise<AdminSessionRecord> {
  const rawSessionToken = readCookie(request, ADMIN_SESSION_COOKIE_NAME);
  return requireAdminSession(deps.adminSessionRepo, rawSessionToken, now);
}

/** Full admin authentication for a mutating endpoint: session + CSRF, with sliding renewal/rotation. */
export async function authenticateAdminAndVerifyCsrf(deps: AdminHttpDeps, request: Request, now: Date): Promise<AdminSessionAndCsrfResult> {
  const rawSessionToken = readCookie(request, ADMIN_SESSION_COOKIE_NAME);
  const submittedCsrf = request.headers.get(ADMIN_CSRF_HEADER_NAME);
  return requireAdminSessionAndCsrf(deps.adminSessionRepo, rawSessionToken, submittedCsrf, now, { randomToken: deps.randomToken });
}
