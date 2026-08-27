import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionHandler } from "../../src/http/handlers/session";
import { SESSION_ROTATION_THRESHOLD_MS } from "../../src/http/session";
import { bootstrap, createTestDeps, extractCookieValue, extractSetCookie } from "./test-support";

test("bootstrap sets an HttpOnly, SameSite=Lax, Path=/guess cookie and returns a CSRF token in JSON", async () => {
  const { deps } = createTestDeps();
  const handler = createSessionHandler(deps);
  const { response } = await bootstrap((req) => handler(req, {}));

  const setCookie = extractSetCookie(response);
  assert.ok(setCookie);
  assert.match(setCookie!, /HttpOnly/);
  assert.match(setCookie!, /SameSite=Lax/);
  assert.match(setCookie!, /Path=\/guess/);
  assert.match(setCookie!, /guess_session=/);

  const json = (await response.clone().json()) as { csrfToken: string; sessionExpiresAt: string };
  assert.ok(json.csrfToken);
  assert.ok(json.sessionExpiresAt);
});

test("in production mode, the cookie is marked Secure", async () => {
  const { deps } = createTestDeps({ isProduction: true });
  const handler = createSessionHandler(deps);
  const { response } = await bootstrap((req) => handler(req, {}));
  assert.match(extractSetCookie(response)!, /Secure/);
});

test("in development mode, the cookie is NOT marked Secure (so local E2E over plain HTTP still works)", async () => {
  const { deps } = createTestDeps({ isProduction: false });
  const handler = createSessionHandler(deps);
  const { response } = await bootstrap((req) => handler(req, {}));
  assert.doesNotMatch(extractSetCookie(response)!, /Secure/);
});

test("the raw session token never appears in the JSON response body", async () => {
  const { deps } = createTestDeps();
  const handler = createSessionHandler(deps);
  const { response, rawSessionToken } = await bootstrap((req) => handler(req, {}));
  const bodyText = await response.clone().text();
  assert.doesNotMatch(bodyText, new RegExp(rawSessionToken));
});

test("calling bootstrap again with the same session cookie resumes the session and rotates only the CSRF token", async () => {
  const { deps } = createTestDeps();
  const handler = createSessionHandler(deps);
  const first = await bootstrap((req) => handler(req, {}));

  const second = await handler(
    new Request("https://example.invalid/guess/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `guess_session=${encodeURIComponent(first.rawSessionToken)}` },
      body: "{}",
    }),
    {},
  );
  const secondJson = (await second.json()) as { csrfToken: string };
  const secondCookie = extractSetCookie(second);
  const secondRawSessionToken = extractCookieValue(secondCookie, "guess_session");

  assert.equal(secondRawSessionToken, first.rawSessionToken, "resuming must not rotate the session token yet");
  assert.notEqual(secondJson.csrfToken, first.rawCsrfToken, "csrf token rotates on every bootstrap");
});

test("bootstrap rotates the session token once it is older than the rotation threshold", async () => {
  const { deps, advanceClock } = createTestDeps();
  const handler = createSessionHandler(deps);
  const first = await bootstrap((req) => handler(req, {}));

  advanceClock(SESSION_ROTATION_THRESHOLD_MS + 1000);

  const second = await handler(
    new Request("https://example.invalid/guess/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `guess_session=${encodeURIComponent(first.rawSessionToken)}` },
      body: "{}",
    }),
    {},
  );
  const secondRawSessionToken = extractCookieValue(extractSetCookie(second), "guess_session");
  assert.notEqual(secondRawSessionToken, first.rawSessionToken);
});

test("bootstrap response carries no-cache headers", async () => {
  const { deps } = createTestDeps();
  const handler = createSessionHandler(deps);
  const { response } = await bootstrap((req) => handler(req, {}));
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("bootstrap rejects a non-JSON content type with a stable 400 shape", async () => {
  const { deps } = createTestDeps();
  const handler = createSessionHandler(deps);
  const response = await handler(
    new Request("https://example.invalid/guess/api/session", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }),
    {},
  );
  assert.equal(response.status, 400);
  const json = (await response.json()) as { error: { code: string } };
  assert.equal(json.error.code, "invalid_request");
});
