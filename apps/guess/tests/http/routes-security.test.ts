import assert from "node:assert/strict";
import { test } from "node:test";
import { createGamesDailyHandler } from "../../src/http/handlers/games-daily";
import { createGamesFreeplayHandler } from "../../src/http/handlers/games-freeplay";
import { createSessionHandler } from "../../src/http/handlers/session";
import { RATE_LIMITS } from "../../src/http/rate-limit";
import { authedHeaders, bootstrap, createTestDeps } from "./test-support";

function jsonReq(url: string, method: string, headers: Record<string, string>, body?: unknown): Request {
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

test("session bootstrap is rate-limited per IP: the (limit+1)th request in a window is rejected with 429 and Retry-After", async () => {
  const { deps } = createTestDeps();
  const handler = createSessionHandler(deps);
  const headers = { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" };

  for (let i = 0; i < RATE_LIMITS.session.limit; i++) {
    const response = await handler(new Request("https://x/y", { method: "POST", headers, body: "{}" }), {});
    assert.equal(response.status, 200);
  }
  const limited = await handler(new Request("https://x/y", { method: "POST", headers, body: "{}" }), {});
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
  const body = (await limited.json()) as { error: { code: string } };
  assert.equal(body.error.code, "rate_limited");
});

test("rate limiting is scoped per IP: a different X-Forwarded-For value is not affected by another IP's exhausted bucket", async () => {
  const { deps } = createTestDeps();
  const handler = createSessionHandler(deps);
  const exhaustedHeaders = { "content-type": "application/json", "x-forwarded-for": "1.1.1.1" };
  for (let i = 0; i < RATE_LIMITS.session.limit; i++) {
    await handler(new Request("https://x/y", { method: "POST", headers: exhaustedHeaders, body: "{}" }), {});
  }
  const otherIpResponse = await handler(
    new Request("https://x/y", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "2.2.2.2" }, body: "{}" }),
    {},
  );
  assert.equal(otherIpResponse.status, 200);
});

test("with the default trusted-proxy hop count (1), only the rightmost X-Forwarded-For entry determines the rate-limit bucket - a spoofed leftmost entry does not let a client evade its own limit", async () => {
  const { deps } = createTestDeps();
  const handler = createSessionHandler(deps);

  // Same real (rightmost) IP, different spoofed leftmost entries each time - must still all count toward ONE bucket.
  for (let i = 0; i < RATE_LIMITS.session.limit; i++) {
    const headers = { "content-type": "application/json", "x-forwarded-for": `spoofed-${i}.attacker.example, 5.5.5.5` };
    const response = await handler(new Request("https://x/y", { method: "POST", headers, body: "{}" }), {});
    assert.equal(response.status, 200);
  }
  const limited = await handler(
    new Request("https://x/y", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "yet-another-spoof, 5.5.5.5" }, body: "{}" }),
    {},
  );
  assert.equal(limited.status, 429, "the real (rightmost) IP must still be recognized as the same client despite a changing spoofed prefix");
});

test("with no X-Forwarded-For header at all, requests fall back to the shared unknown-IP bucket rather than erroring", async () => {
  const { deps } = createTestDeps();
  const handler = createSessionHandler(deps);
  const response = await handler(new Request("https://x/y", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), {});
  assert.equal(response.status, 200);
});

test("every error response uses the exact same stable {error:{code,message},requestId} shape", async () => {
  const { deps } = createTestDeps();
  const handler = createGamesDailyHandler(deps);

  const unauthenticated = await handler(jsonReq("https://x/y", "POST", { "content-type": "application/json" }, {}), {});
  const invalidBody = await handler(jsonReq("https://x/y", "POST", { "content-type": "text/plain" }, {}), {});

  for (const response of [unauthenticated, invalidBody]) {
    const body = (await response.json()) as { error: { code: string; message: string }; requestId: string };
    assert.equal(typeof body.error.code, "string");
    assert.equal(typeof body.error.message, "string");
    assert.equal(typeof body.requestId, "string");
    assert.equal(Object.keys(body).sort().join(","), "error,requestId");
    assert.equal(Object.keys(body.error).sort().join(","), "code,message");
  }
});

test("error responses never leak a stack trace or raw error message text", async () => {
  const { deps } = createTestDeps();
  const handler = createGamesDailyHandler(deps);
  const response = await handler(jsonReq("https://x/y", "POST", { "content-type": "application/json" }, {}), {});
  const raw = await response.text();
  assert.doesNotMatch(raw, /at .+\(.+:\d+:\d+\)/); // a typical stack-frame shape
  assert.doesNotMatch(raw, /\.ts:\d+/);
});

test("all API responses (success and error) carry Cache-Control: no-store", async () => {
  const { deps } = createTestDeps();
  const sessionHandler = createSessionHandler(deps);
  const ok = await bootstrap((req) => sessionHandler(req, {}));
  assert.equal(ok.response.headers.get("cache-control"), "no-store");

  const dailyHandler = createGamesDailyHandler(deps);
  const errorResponse = await dailyHandler(jsonReq("https://x/y", "POST", { "content-type": "application/json" }, {}), {});
  assert.equal(errorResponse.headers.get("cache-control"), "no-store");
});

test("a request without an X-Idempotency-Key header is rejected with a stable validation error", async () => {
  const { deps } = createTestDeps();
  const session = createSessionHandler(deps);
  const { rawSessionToken, rawCsrfToken } = await bootstrap((req) => session(req, {}));
  const handler = createGamesFreeplayHandler(deps);
  const response = await handler(
    jsonReq("https://x/y", "POST", {
      "content-type": "application/json",
      cookie: `guess_session=${encodeURIComponent(rawSessionToken)}`,
      "x-guess-csrf": rawCsrfToken,
    }, {}),
    {},
  );
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "invalid_request");
});

test("session bootstrap never logs the raw session or CSRF token, even though both pass through the handler", async () => {
  const { deps, logLines } = createTestDeps();
  const handler = createSessionHandler(deps);
  const { rawSessionToken, rawCsrfToken } = await bootstrap((req) => handler(req, {}));
  const allLogs = logLines.join("\n");
  assert.doesNotMatch(allLogs, new RegExp(rawSessionToken));
  assert.doesNotMatch(allLogs, new RegExp(rawCsrfToken));
});

test("guess submission never logs the target's forum identity", async () => {
  const { deps, logLines } = createTestDeps({ poolSize: 30 });
  const session = createSessionHandler(deps);
  const { rawSessionToken, rawCsrfToken } = await bootstrap((req) => session(req, {}));

  const dailyHandler = createGamesDailyHandler(deps);
  await dailyHandler(jsonReq("https://x/y", "POST", authedHeaders(rawSessionToken, rawCsrfToken, "log-scan-daily"), {}), {});

  // Every eligible synthetic forumUserId follows "user-NNN" - none of those literal ids should ever appear in a log line.
  const allLogs = logLines.join("\n");
  for (let i = 0; i < 30; i++) {
    assert.doesNotMatch(allLogs, new RegExp(`"user-${String(i).padStart(3, "0")}"`));
  }
});
