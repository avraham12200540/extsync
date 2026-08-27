"use client";

import type { GameView, RoundView, ShareResultsView } from "@/game/view-models";

/**
 * Client-side API wrapper for /guess/api/**. The CSRF token lives only in
 * a module-level variable (in-memory, cleared on full page reload) -
 * never localStorage/sessionStorage, never a URL, never a data attribute.
 * The session token itself is never visible to this module at all: it
 * only ever travels as an HttpOnly cookie the browser manages, which this
 * code cannot read even if it wanted to.
 *
 * basePath ("/guess") is NOT automatically applied to plain fetch() calls
 * (unlike <Link>/useRouter) - every path below is written out in full.
 */
const API_BASE = "/guess/api";

let csrfToken: string | null = null;
let bootstrapPromise: Promise<BootstrapResult> | null = null;

export interface BootstrapResult {
  csrfToken: string;
  sessionExpiresAt: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
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
    throw new ApiError(
      response.status,
      parsed.error?.code ?? "internal_error",
      parsed.error?.message ?? "Unknown error",
      retryAfterHeader ? Number(retryAfterHeader) : undefined,
    );
  }
  return response.json() as Promise<T>;
}

/** Idempotent within one in-flight call: concurrent callers share the same bootstrap request instead of firing two. */
export async function bootstrap(force = false): Promise<BootstrapResult> {
  if (!force && bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    const response = await fetch(`${API_BASE}/session`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const result = await parseResponse<BootstrapResult>(response);
    csrfToken = result.csrfToken;
    return result;
  })();
  return bootstrapPromise;
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

interface FetchOpts {
  method: "GET" | "POST";
  body?: unknown;
}

async function apiFetch<T>(path: string, opts: FetchOpts): Promise<T> {
  const buildRequest = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (opts.method === "POST") {
      headers["content-type"] = "application/json";
      if (!csrfToken) await bootstrap();
      headers["x-guess-csrf"] = csrfToken!;
      headers["x-idempotency-key"] = newIdempotencyKey();
    }
    return fetch(`${API_BASE}${path}`, {
      method: opts.method,
      credentials: "include",
      headers,
      body: opts.method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
    });
  };

  let response = await buildRequest();
  if (response.status === 401) {
    // Session expired or never existed - re-bootstrap once and retry with a fresh idempotency key.
    csrfToken = null;
    bootstrapPromise = null;
    await bootstrap(true);
    response = await buildRequest();
  }
  return parseResponse<T>(response);
}

export async function createOrResumeDailyGame(): Promise<GameView> {
  return apiFetch<GameView>("/games/daily", { method: "POST" });
}

export async function createFreeplayGame(): Promise<GameView> {
  return apiFetch<GameView>("/games/freeplay", { method: "POST" });
}

export async function getCurrentRound(gameId: string): Promise<RoundView> {
  return apiFetch<RoundView>(`/games/${encodeURIComponent(gameId)}/round`, { method: "GET" });
}

export async function requestHint(gameId: string, roundId: string): Promise<RoundView> {
  return apiFetch<RoundView>(`/games/${encodeURIComponent(gameId)}/round/hint`, { method: "POST", body: { roundId } });
}

export async function submitGuess(gameId: string, roundId: string, choiceId: string): Promise<RoundView> {
  return apiFetch<RoundView>(`/games/${encodeURIComponent(gameId)}/round/guess`, { method: "POST", body: { roundId, choiceId } });
}

export interface AdvanceResult {
  completed: boolean;
  game: GameView;
  round?: RoundView;
}

export async function advanceGame(gameId: string): Promise<AdvanceResult> {
  return apiFetch<AdvanceResult>(`/games/${encodeURIComponent(gameId)}/advance`, { method: "POST" });
}

export interface OwnResultsView extends GameView {
  shareUrl: string | null;
}

export async function getOwnResults(gameId: string): Promise<OwnResultsView> {
  return apiFetch<OwnResultsView>(`/games/${encodeURIComponent(gameId)}/results`, { method: "GET" });
}

export async function getShareResults(shareToken: string): Promise<ShareResultsView> {
  return apiFetch<ShareResultsView>(`/results/${encodeURIComponent(shareToken)}`, { method: "GET" });
}
