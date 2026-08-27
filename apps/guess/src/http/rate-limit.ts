import crypto from "node:crypto";

/**
 * PostgreSQL-backed fixed-window rate limiting (no Redis - matches the
 * "guess-web + guess-db, nothing else" isolated stack). Every count is an
 * atomic upsert (INSERT ... ON CONFLICT DO UPDATE SET count = count + 1);
 * IPs are never stored raw, only as a hash salted with a server-only
 * pepper AND rotated daily, so even a leaked table can't link one day's
 * activity to another's for the same visitor. Bounded retention: rows are
 * meant to be pruned once their window (and the day-bucket the hash
 * belongs to) is well in the past - the actual cleanup job is future,
 * approval-gated infra work (see README); this module only defines the
 * hashing/window shape.
 */

export const RATE_LIMITS = {
  session: { windowSeconds: 60, limit: 10 },
  gameCreate: { windowSeconds: 60, limit: 10 },
  hint: { windowSeconds: 60, limit: 60 },
  guess: { windowSeconds: 60, limit: 60 },
  advance: { windowSeconds: 60, limit: 30 },
  shareResults: { windowSeconds: 60, limit: 30 },
  adminLogin: { windowSeconds: 300, limit: 10 },
  /** Applies to every authenticated admin mutation (approve/reject/edit/override/import-trigger/session-revoke) - defense in depth even against a legitimate-but-compromised admin session. */
  adminMutation: { windowSeconds: 60, limit: 30 },
} as const;

export type RateLimitEndpoint = keyof typeof RATE_LIMITS;

export function computeDayKey(now: Date): string {
  const iso = now.toISOString();
  return iso.slice(0, 10);
}

export function computeWindowStart(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** ip is never stored raw; pepper is server-only key material, injected (env-provided in a later runtime stage, never hardcoded here). */
export function hashIpForBucket(ip: string, pepper: string, dayKey: string): string {
  return crypto.createHash("sha256").update(`${pepper}:${dayKey}:${ip}`, "utf8").digest("hex");
}

/**
 * Trusted-proxy IP extraction. Next.js Route Handlers see the Web
 * standard `Request` object, which has NO raw socket/remote-address
 * access - the only client-IP signal available at all is whatever header
 * a reverse proxy sets. `trustedHopCount` says how many of the
 * right-most, comma-separated X-Forwarded-For entries were appended by
 * proxies this deployment actually controls (each proxy hop is supposed
 * to APPEND its observed peer to the header, so the real client is
 * `trustedHopCount` entries from the right).
 *
 * DEPLOYMENT CAVEAT (must be verified before production): this defaults
 * to 1, matching the ONE documented reverse-proxy hop (Caddy) in front of
 * this app per the project's deploy model. That assumption was NOT
 * independently verified against the real, live Caddy configuration in
 * this cycle (it lives on the production host and was not accessible for
 * inspection). If the real topology ever adds or removes a hop (a CDN, a
 * load balancer, a different Caddy chain), `trustedHopCount` must be
 * updated to match, or a malicious client can spoof their apparent IP by
 * prepending fake entries to X-Forwarded-For and defeating rate limiting
 * entirely. When the header is missing, empty, or has fewer entries than
 * `trustedHopCount` (a malformed/unexpected shape), this returns `null`
 * rather than guessing - the caller must then fall back to a single
 * shared "unknown" bucket, never to a client-controlled value.
 */
export interface TrustedProxyConfig {
  trustedHopCount: number;
}

export const DEFAULT_TRUSTED_PROXY_CONFIG: TrustedProxyConfig = { trustedHopCount: 1 };

export function extractClientIp(xForwardedFor: string | null, config: TrustedProxyConfig): string | null {
  if (config.trustedHopCount <= 0 || !xForwardedFor) return null;
  const hops = xForwardedFor
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const index = hops.length - config.trustedHopCount;
  if (index < 0 || index >= hops.length) return null;
  const candidate = hops[index];
  return candidate && candidate.length > 0 ? candidate : null;
}

/** The bucket key used when the real client IP cannot be safely determined - shared by all such requests, never derived from anything a client controls. */
export const UNKNOWN_IP_BUCKET = "unknown-ip";

export interface RateLimitRepository {
  /** Atomically increments the bucket for (ipHash, endpoint, windowStart) and returns the new count. */
  incrementAndCheck(ipHash: string, endpoint: string, windowStart: Date): Promise<number>;
}

export function createInMemoryRateLimitRepository(): RateLimitRepository & { buckets: Map<string, number> } {
  const buckets = new Map<string, number>();
  return {
    buckets,
    async incrementAndCheck(ipHash, endpoint, windowStart) {
      const key = `${ipHash}:${endpoint}:${windowStart.getTime()}`;
      const next = (buckets.get(key) ?? 0) + 1;
      buckets.set(key, next);
      return next;
    },
  };
}

export class RateLimitExceededError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`rate limit exceeded, retry after ${retryAfterSeconds}s`);
  }
}

export interface RateLimitDeps {
  repo: RateLimitRepository;
  pepper: string;
  proxyConfig: TrustedProxyConfig;
}

/** Throws RateLimitExceededError when the caller is over the endpoint's limit; otherwise resolves silently. */
export async function enforceRateLimit(
  deps: RateLimitDeps,
  endpoint: RateLimitEndpoint,
  xForwardedFor: string | null,
  now: Date,
): Promise<void> {
  const { windowSeconds, limit } = RATE_LIMITS[endpoint];
  const clientIp = extractClientIp(xForwardedFor, deps.proxyConfig) ?? UNKNOWN_IP_BUCKET;
  const dayKey = computeDayKey(now);
  const ipHash = hashIpForBucket(clientIp, deps.pepper, dayKey);
  const windowStart = computeWindowStart(now, windowSeconds);

  const count = await deps.repo.incrementAndCheck(ipHash, endpoint, windowStart);
  if (count > limit) {
    const windowEnd = new Date(windowStart.getTime() + windowSeconds * 1000);
    const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd.getTime() - now.getTime()) / 1000));
    throw new RateLimitExceededError(retryAfterSeconds);
  }
}
