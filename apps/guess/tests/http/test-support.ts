import type { EligibleTarget } from "../../src/game/daily-challenge";
import { createInMemoryCuratedPoolRepository } from "../../src/game/curated-pool-repository";
import { createInMemoryGameUnitOfWork } from "../../src/game/unit-of-work";
import type { ForumContentLookup } from "../../src/game/unit-of-work";
import { DEFAULT_TRUSTED_PROXY_CONFIG, createInMemoryRateLimitRepository } from "../../src/http/rate-limit";
import { createInMemoryIdempotencyRepository } from "../../src/http/idempotency";
import { createInMemorySessionRepository } from "../../src/http/session";
import type { HttpDeps } from "../../src/http/deps";

/** Synthetic pool - never real forum content, matching every other domain test in this repo. */
export function makeEligiblePool(size: number, postsPerUser = 5): EligibleTarget[] {
  return Array.from({ length: size }, (_, i) => ({
    forumUserId: `user-${String(i).padStart(3, "0")}`,
    forumUsername: `synthetic${i}`,
    approvedPostCount: postsPerUser,
    avgWordCount: 40 + i,
    avgQualityScore: 0.6,
    topCategories: ["tech"],
    firstActiveAt: new Date("2024-01-01T00:00:00Z"),
    lastActiveAt: new Date("2024-06-01T00:00:00Z"),
    approvedPostIds: Array.from({ length: postsPerUser }, (_, p) => `post-${String(i).padStart(3, "0")}-${p}`),
  }));
}

function makeContentLookup(): ForumContentLookup {
  return {
    async getCleanContent(forumPostId) {
      return `synthetic clean text for ${forumPostId}`;
    },
    async getUsername(forumUserId) {
      return `username-for-${forumUserId}`;
    },
  };
}

export interface TestDepsOptions {
  poolSize?: number;
  now?: Date;
  isProduction?: boolean;
}

export interface TestDepsBundle {
  deps: HttpDeps;
  logLines: string[];
  advanceClock: (ms: number) => void;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}
let tokenCounter = 0;
function nextToken(): string {
  tokenCounter += 1;
  return `raw-token-${tokenCounter}`;
}

export function createTestDeps(opts: TestDepsOptions = {}): TestDepsBundle {
  let currentNow = opts.now ?? new Date("2026-01-01T12:00:00Z");
  const logLines: string[] = [];

  const deps: HttpDeps = {
    sessionRepo: createInMemorySessionRepository({ generateId: () => nextId("sess") }),
    gameUow: createInMemoryGameUnitOfWork({ generateId: () => nextId("g") }),
    curatedPool: createInMemoryCuratedPoolRepository({ generateId: () => nextId("dc") }, makeEligiblePool(opts.poolSize ?? 30)),
    contentLookup: makeContentLookup(),
    rateLimitRepo: createInMemoryRateLimitRepository(),
    idempotencyRepo: createInMemoryIdempotencyRepository(),
    clock: () => currentNow,
    randomToken: nextToken,
    generateId: () => nextId("id"),
    isProduction: opts.isProduction ?? false,
    rateLimitPepper: "test-only-pepper-never-real",
    dailySeedSecret: "test-only-seed-secret-never-real",
    trustedProxyConfig: DEFAULT_TRUSTED_PROXY_CONFIG,
    logSink: (line: string) => logLines.push(line),
  };

  return {
    deps,
    logLines,
    advanceClock: (ms: number) => {
      currentNow = new Date(currentNow.getTime() + ms);
    },
  };
}

export function extractSetCookie(response: Response): string | null {
  return response.headers.get("set-cookie");
}

export function extractCookieValue(setCookieHeader: string | null, name: string): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Performs a real POST /guess/api/session-shaped bootstrap through the actual handler and returns the raw session+csrf tokens ready to use in follow-up requests. */
export async function bootstrap(
  handler: (request: Request) => Promise<Response>,
): Promise<{ rawSessionToken: string; rawCsrfToken: string; response: Response }> {
  const response = await handler(
    new Request("https://example.invalid/guess/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  const setCookie = extractSetCookie(response);
  const rawSessionToken = extractCookieValue(setCookie, "guess_session");
  if (!rawSessionToken) throw new Error("bootstrap() test helper: no session cookie in response");
  const json = (await response.clone().json()) as { csrfToken: string };
  return { rawSessionToken, rawCsrfToken: json.csrfToken, response };
}

export function withCookie(headers: Record<string, string>, rawSessionToken: string): Record<string, string> {
  return { ...headers, cookie: `guess_session=${encodeURIComponent(rawSessionToken)}` };
}

export function authedHeaders(rawSessionToken: string, rawCsrfToken: string, idempotencyKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    cookie: `guess_session=${encodeURIComponent(rawSessionToken)}`,
    "x-guess-csrf": rawCsrfToken,
  };
  if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
  return headers;
}
