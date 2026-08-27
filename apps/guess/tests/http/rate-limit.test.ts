import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TRUSTED_PROXY_CONFIG,
  RATE_LIMITS,
  RateLimitExceededError,
  UNKNOWN_IP_BUCKET,
  computeDayKey,
  computeWindowStart,
  createInMemoryRateLimitRepository,
  enforceRateLimit,
  extractClientIp,
  hashIpForBucket,
} from "../../src/http/rate-limit";

const NOW = new Date("2026-01-01T00:00:30Z");
const PEPPER = "test-only-pepper-never-real";

test("extractClientIp with trustedHopCount=1 takes the rightmost XFF entry", () => {
  const ip = extractClientIp("1.2.3.4, 5.6.7.8", { trustedHopCount: 1 });
  assert.equal(ip, "5.6.7.8");
});

test("extractClientIp with trustedHopCount=2 takes the second-from-right entry", () => {
  const ip = extractClientIp("1.2.3.4, 5.6.7.8, 9.9.9.9", { trustedHopCount: 2 });
  assert.equal(ip, "5.6.7.8");
});

test("extractClientIp returns null (not a guess) when the header has fewer entries than trustedHopCount", () => {
  const ip = extractClientIp("5.6.7.8", { trustedHopCount: 2 });
  assert.equal(ip, null);
});

test("extractClientIp returns null when trustedHopCount is 0 (no proxy trusted at all)", () => {
  const ip = extractClientIp("1.2.3.4", { trustedHopCount: 0 });
  assert.equal(ip, null);
});

test("extractClientIp returns null for a missing header", () => {
  assert.equal(extractClientIp(null, DEFAULT_TRUSTED_PROXY_CONFIG), null);
  assert.equal(extractClientIp("", DEFAULT_TRUSTED_PROXY_CONFIG), null);
});

test("hashIpForBucket never contains the raw ip and rotates by day", () => {
  const hashDay1 = hashIpForBucket("1.2.3.4", PEPPER, "2026-01-01");
  const hashDay2 = hashIpForBucket("1.2.3.4", PEPPER, "2026-01-02");
  assert.doesNotMatch(hashDay1, /1\.2\.3\.4/);
  assert.notEqual(hashDay1, hashDay2, "the same IP must hash differently on different days");
});

test("hashIpForBucket is stable for the same ip/pepper/day (needed to aggregate within one rate-limit window)", () => {
  assert.equal(hashIpForBucket("1.2.3.4", PEPPER, "2026-01-01"), hashIpForBucket("1.2.3.4", PEPPER, "2026-01-01"));
});

test("computeWindowStart buckets timestamps into fixed windows", () => {
  const start1 = computeWindowStart(new Date("2026-01-01T00:00:05Z"), 60);
  const start2 = computeWindowStart(new Date("2026-01-01T00:00:55Z"), 60);
  const start3 = computeWindowStart(new Date("2026-01-01T00:01:05Z"), 60);
  assert.deepEqual(start1, start2, "both within the same 60s window");
  assert.notDeepEqual(start1, start3, "the next window must be a distinct bucket");
});

test("computeDayKey is a stable calendar-day string", () => {
  assert.equal(computeDayKey(new Date("2026-01-01T00:00:00Z")), "2026-01-01");
  assert.equal(computeDayKey(new Date("2026-01-01T23:59:59Z")), "2026-01-01");
});

test("enforceRateLimit allows requests under the endpoint's limit", async () => {
  const repo = createInMemoryRateLimitRepository();
  const limit = RATE_LIMITS.hint.limit;
  for (let i = 0; i < limit; i++) {
    await enforceRateLimit({ repo, pepper: PEPPER, proxyConfig: DEFAULT_TRUSTED_PROXY_CONFIG }, "hint", "1.2.3.4", NOW);
  }
  // No throw up to the limit.
  assert.ok(true);
});

test("enforceRateLimit throws RateLimitExceededError once the endpoint's limit is exceeded, with a positive retryAfterSeconds", async () => {
  const repo = createInMemoryRateLimitRepository();
  const limit = RATE_LIMITS.session.limit;
  for (let i = 0; i < limit; i++) {
    await enforceRateLimit({ repo, pepper: PEPPER, proxyConfig: DEFAULT_TRUSTED_PROXY_CONFIG }, "session", "1.2.3.4", NOW);
  }
  await assert.rejects(
    () => enforceRateLimit({ repo, pepper: PEPPER, proxyConfig: DEFAULT_TRUSTED_PROXY_CONFIG }, "session", "1.2.3.4", NOW),
    (err: unknown) => {
      assert.ok(err instanceof RateLimitExceededError);
      assert.ok(err.retryAfterSeconds > 0);
      return true;
    },
  );
});

test("enforceRateLimit tracks distinct IPs (via their hash) independently", async () => {
  const repo = createInMemoryRateLimitRepository();
  const limit = RATE_LIMITS.session.limit;
  for (let i = 0; i < limit; i++) {
    await enforceRateLimit({ repo, pepper: PEPPER, proxyConfig: DEFAULT_TRUSTED_PROXY_CONFIG }, "session", "1.1.1.1", NOW);
  }
  // A different IP must not be affected by 1.1.1.1's exhausted bucket.
  await enforceRateLimit({ repo, pepper: PEPPER, proxyConfig: DEFAULT_TRUSTED_PROXY_CONFIG }, "session", "2.2.2.2", NOW);
});

test("enforceRateLimit tracks distinct endpoints independently for the same IP", async () => {
  const repo = createInMemoryRateLimitRepository();
  const limit = RATE_LIMITS.session.limit;
  for (let i = 0; i < limit; i++) {
    await enforceRateLimit({ repo, pepper: PEPPER, proxyConfig: DEFAULT_TRUSTED_PROXY_CONFIG }, "session", "1.1.1.1", NOW);
  }
  // hint has a much higher limit and is a different endpoint bucket entirely.
  await enforceRateLimit({ repo, pepper: PEPPER, proxyConfig: DEFAULT_TRUSTED_PROXY_CONFIG }, "hint", "1.1.1.1", NOW);
});

test("a fresh window resets the count (fixed-window semantics)", async () => {
  const repo = createInMemoryRateLimitRepository();
  const limit = RATE_LIMITS.session.limit;
  for (let i = 0; i < limit; i++) {
    await enforceRateLimit({ repo, pepper: PEPPER, proxyConfig: DEFAULT_TRUSTED_PROXY_CONFIG }, "session", "1.1.1.1", NOW);
  }
  const nextWindow = new Date(NOW.getTime() + RATE_LIMITS.session.windowSeconds * 1000 + 1);
  await enforceRateLimit({ repo, pepper: PEPPER, proxyConfig: DEFAULT_TRUSTED_PROXY_CONFIG }, "session", "1.1.1.1", nextWindow);
});

test("requests with an unresolvable client IP share the UNKNOWN_IP_BUCKET, not a client-chosen value", async () => {
  const repo = createInMemoryRateLimitRepository();
  await enforceRateLimit({ repo, pepper: PEPPER, proxyConfig: DEFAULT_TRUSTED_PROXY_CONFIG }, "session", null, NOW);
  const expectedHash = hashIpForBucket(UNKNOWN_IP_BUCKET, PEPPER, computeDayKey(NOW));
  const windowStart = computeWindowStart(NOW, RATE_LIMITS.session.windowSeconds);
  assert.equal(repo.buckets.get(`${expectedHash}:session:${windowStart.getTime()}`), 1);
});
