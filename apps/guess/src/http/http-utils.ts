import crypto from "node:crypto";
import type { HttpDeps, RouteHandler, RouteParams } from "./deps";
import { mapErrorToResponse } from "./errors";

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    if (trimmed.slice(0, eqIndex) === name) {
      return decodeURIComponent(trimmed.slice(eqIndex + 1));
    }
  }
  return null;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

/** Every response from this API is dynamic/session-specific - never cached by a browser or intermediary. */
export function noCacheHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
}

export function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...noCacheHeaders(), ...extraHeaders },
  });
}

/** Maps any thrown error to the stable, non-revealing shape from errors.ts and wraps it as a Response - the single place every handler's catch block routes through. */
export function errorResponse(err: unknown, requestId: string): Response {
  const mapped = mapErrorToResponse(err);
  const extraHeaders: Record<string, string> = {};
  if (mapped.retryAfterSeconds) extraHeaders["Retry-After"] = String(mapped.retryAfterSeconds);
  return jsonResponse(mapped.status, { error: { code: mapped.code, message: mapped.message }, requestId }, extraHeaders);
}

/**
 * Every route.ts wrapper calls this rather than invoking
 * `handlerFactory(depsFactory())(request, params)` directly, because
 * `depsFactory()` (getProductionHttpDeps) can throw synchronously - e.g.
 * a misconfigured deployment missing a required env var - BEFORE the
 * handler's own try/catch ever runs. Without this wrapper that throw
 * would fall through to Next.js's own default error handling instead of
 * this API's uniform JSON error envelope. Confirmed live: booting the
 * standalone build with GUESS_RATE_LIMIT_PEPPER/GUESS_DAILY_SEED_SECRET
 * unset previously returned an empty body with no JSON shape at all -
 * this wrapper is what makes that same misconfiguration return the same
 * safe `{error:{code,message}}` shape as every other error.
 *
 * Generic over the deps type (defaulting to HttpDeps) purely so the admin
 * route wiring can pass an AdminHttpDeps factory/handler through the same
 * function - every existing gameplay call site infers D=HttpDeps exactly
 * as before with no changes required there.
 */
export async function invokeWithDeps<D = HttpDeps>(
  depsFactory: () => D,
  handlerFactory: (deps: D) => RouteHandler,
  request: Request,
  params: RouteParams,
): Promise<Response> {
  try {
    const deps = depsFactory();
    return await handlerFactory(deps)(request, params);
  } catch (err) {
    return errorResponse(err, newRequestId());
  }
}
