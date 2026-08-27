import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminAuditEventRecord } from "../../src/admin/audit";
import { createAdminLoginHandler } from "../../src/http/handlers/admin-login";
import { createAdminLogoutHandler } from "../../src/http/handlers/admin-logout";
import { createAdminSessionInfoHandler } from "../../src/http/handlers/admin-session-info";
import { createAdminRevokeOtherSessionsHandler } from "../../src/http/handlers/admin-revoke-other-sessions";
import { createAdminForumUsersListHandler, createAdminForumUserOverrideHandler } from "../../src/http/handlers/admin-forum-users";
import { createAdminModerationApproveHandler, createAdminModerationDetailHandler, createAdminModerationQueueHandler } from "../../src/http/handlers/admin-moderation";
import { createAdminImportRunTriggerHandler } from "../../src/http/handlers/admin-import-runs";
import { createSessionHandler } from "../../src/http/handlers/session";
import type { AdminHttpDeps } from "../../src/http/deps";
import { createAdminTestDeps, gatedNodebbClient, seedAdminUser } from "./admin-test-support";
import { bootstrap, extractCookieValue, extractSetCookie } from "./test-support";

const NOW = new Date("2026-01-01T12:00:00Z");

async function loginAsAdmin(
  deps: AdminHttpDeps,
  email: string,
  password: string,
  existingPlayer?: { rawSessionToken: string; rawCsrfToken: string },
) {
  const player = existingPlayer ?? (await bootstrap((req) => createSessionHandler(deps)(req, {})));
  const response = await createAdminLoginHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: deps.appOrigin,
        cookie: `guess_session=${encodeURIComponent(player.rawSessionToken)}`,
        "x-guess-csrf": player.rawCsrfToken,
      },
      body: JSON.stringify({ email, password }),
    }),
    {},
  );
  const setCookie = extractSetCookie(response);
  const rawAdminSessionToken = extractCookieValue(setCookie, "guess_admin_session");
  const json = (await response.clone().json()) as { csrfToken?: string };
  return { response, rawAdminSessionToken, rawAdminCsrfToken: json.csrfToken ?? null };
}

function adminHeaders(rawAdminSessionToken: string, rawAdminCsrfToken: string): Record<string, string> {
  return {
    "content-type": "application/json",
    cookie: `guess_admin_session=${encodeURIComponent(rawAdminSessionToken)}`,
    "x-guess-admin-csrf": rawAdminCsrfToken,
  };
}

test("login: correct credentials returns a Strict/HttpOnly/Path=/guess cookie and a csrfToken, never the raw session token in the body", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({ now: NOW, adminUsers: [admin] });
  const { response, rawAdminSessionToken, rawAdminCsrfToken } = await loginAsAdmin(deps, "admin@example.invalid", "correct-horse-battery-staple");

  assert.equal(response.status, 200);
  const setCookie = extractSetCookie(response)!;
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\/guess/);
  assert.ok(rawAdminSessionToken);
  assert.ok(rawAdminCsrfToken);
  const bodyText = await response.clone().text();
  assert.doesNotMatch(bodyText, new RegExp(rawAdminSessionToken!));
});

test("login: in production mode the admin cookie is marked Secure", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({ now: NOW, adminUsers: [admin], isProduction: true });
  const { response } = await loginAsAdmin(deps, "admin@example.invalid", "correct-horse-battery-staple");
  assert.match(extractSetCookie(response)!, /Secure/);
});

test("login: wrong password returns 401 invalid_credentials, not a distinguishable error", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({ now: NOW, adminUsers: [admin] });
  const { response } = await loginAsAdmin(deps, "admin@example.invalid", "wrong-password");
  assert.equal(response.status, 401);
  const json = (await response.json()) as { error: { code: string } };
  assert.equal(json.error.code, "invalid_credentials");
});

test("login: a cross-origin Origin header is rejected even with a valid pre-auth nonce", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({ now: NOW, adminUsers: [admin] });
  const player = await bootstrap((req) => createSessionHandler(deps)(req, {}));

  const response = await createAdminLoginHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.invalid",
        cookie: `guess_session=${encodeURIComponent(player.rawSessionToken)}`,
        "x-guess-csrf": player.rawCsrfToken,
      },
      body: JSON.stringify({ email: "admin@example.invalid", password: "correct-horse-battery-staple" }),
    }),
    {},
  );
  assert.equal(response.status, 403);
});

test("login: missing the pre-auth player session/CSRF nonce is rejected even with a same-origin request", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({ now: NOW, adminUsers: [admin] });

  const response = await createAdminLoginHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: deps.appOrigin },
      body: JSON.stringify({ email: "admin@example.invalid", password: "correct-horse-battery-staple" }),
    }),
    {},
  );
  assert.equal(response.status, 401);
});

test("login: exceeding the per-IP rate limit returns 429 with Retry-After", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({ now: NOW, adminUsers: [admin] });
  // Bootstrap the pre-auth player session ONCE and reuse it - a real client
  // would not re-bootstrap on every retry, and doing so here would also
  // trip the unrelated player-session rate limit before ever reaching login.
  const player = await bootstrap((req) => createSessionHandler(deps)(req, {}));
  let lastResponse!: Response;
  for (let i = 0; i < 11; i++) {
    const result = await loginAsAdmin(deps, "admin@example.invalid", "wrong-password", player);
    lastResponse = result.response;
  }
  assert.equal(lastResponse.status, 429);
  assert.ok(lastResponse.headers.get("retry-after"));
});

test("current-session (GET) requires authentication and is IDOR-safe with no session", async () => {
  const { deps } = createAdminTestDeps({ now: NOW });
  const response = await createAdminSessionInfoHandler(deps)(new Request("https://example.invalid/guess/api/admin/session"), {});
  assert.equal(response.status, 401);
});

test("current-session (GET) returns the authenticated admin's own email, never a password/hash field", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({ now: NOW, adminUsers: [admin] });
  const { rawAdminSessionToken } = await loginAsAdmin(deps, "admin@example.invalid", "correct-horse-battery-staple");

  const response = await createAdminSessionInfoHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/session", { headers: { cookie: `guess_admin_session=${encodeURIComponent(rawAdminSessionToken!)}` } }),
    {},
  );
  assert.equal(response.status, 200);
  const json = (await response.json()) as Record<string, unknown>;
  assert.equal(json.email, "admin@example.invalid");
  assert.equal("passwordHash" in json, false);
  assert.equal("password" in json, false);
});

test("logout revokes the session - a subsequent authenticated call fails", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({ now: NOW, adminUsers: [admin] });
  const { rawAdminSessionToken, rawAdminCsrfToken } = await loginAsAdmin(deps, "admin@example.invalid", "correct-horse-battery-staple");

  const logoutResponse = await createAdminLogoutHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/logout", { method: "POST", headers: adminHeaders(rawAdminSessionToken!, rawAdminCsrfToken!), body: "{}" }),
    {},
  );
  assert.equal(logoutResponse.status, 200);

  const after = await createAdminSessionInfoHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/session", { headers: { cookie: `guess_admin_session=${encodeURIComponent(rawAdminSessionToken!)}` } }),
    {},
  );
  assert.equal(after.status, 401);
});

test("a mutating admin endpoint without the admin CSRF header is rejected with 403", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({ now: NOW, adminUsers: [admin] });
  const { rawAdminSessionToken } = await loginAsAdmin(deps, "admin@example.invalid", "correct-horse-battery-staple");

  const response = await createAdminLogoutHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/logout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `guess_admin_session=${encodeURIComponent(rawAdminSessionToken!)}` },
      body: "{}",
    }),
    {},
  );
  assert.equal(response.status, 403);
});

test("revoke-others revokes every other session but not the caller's own", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({ now: NOW, adminUsers: [admin] });
  const sessionA = await loginAsAdmin(deps, "admin@example.invalid", "correct-horse-battery-staple");
  const sessionB = await loginAsAdmin(deps, "admin@example.invalid", "correct-horse-battery-staple");

  const response = await createAdminRevokeOtherSessionsHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/sessions/revoke-others", {
      method: "POST",
      headers: adminHeaders(sessionA.rawAdminSessionToken!, sessionA.rawAdminCsrfToken!),
      body: "{}",
    }),
    {},
  );
  assert.equal(response.status, 200);
  const json = (await response.json()) as { revokedCount: number };
  assert.equal(json.revokedCount, 1);

  const stillOk = await createAdminSessionInfoHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/session", { headers: { cookie: `guess_admin_session=${encodeURIComponent(sessionA.rawAdminSessionToken!)}` } }),
    {},
  );
  assert.equal(stillOk.status, 200);
  const revoked = await createAdminSessionInfoHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/session", { headers: { cookie: `guess_admin_session=${encodeURIComponent(sessionB.rawAdminSessionToken!)}` } }),
    {},
  );
  assert.equal(revoked.status, 401);
});

test("forum-users list is IDOR-safe (401 with no session) and rejects an out-of-range pageSize", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({ now: NOW, adminUsers: [admin] });

  const noAuth = await createAdminForumUsersListHandler(deps)(new Request("https://example.invalid/guess/api/admin/forum-users"), {});
  assert.equal(noAuth.status, 401);

  const { rawAdminSessionToken } = await loginAsAdmin(deps, "admin@example.invalid", "correct-horse-battery-staple");
  const badPageSize = await createAdminForumUsersListHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/forum-users?pageSize=99999", {
      headers: { cookie: `guess_admin_session=${encodeURIComponent(rawAdminSessionToken!)}` },
    }),
    {},
  );
  assert.equal(badPageSize.status, 400);

  const badSortField = await createAdminForumUsersListHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/forum-users?sortField=DROP+TABLE", {
      headers: { cookie: `guess_admin_session=${encodeURIComponent(rawAdminSessionToken!)}` },
    }),
    {},
  );
  assert.equal(badSortField.status, 400);
});

test("eligibility override is audited with the before/after value", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({
    now: NOW,
    adminUsers: [admin],
    forumUsers: [
      {
        id: "fu-1",
        forumUid: "1001",
        forumUsername: "synthetic_user",
        forumUserslug: "synthetic-user",
        accountStatus: "active",
        isSystemOrBot: false,
        adminOverride: "none",
        computedEligible: true,
        computedReasons: [],
        createdAt: NOW,
        updatedAt: NOW,
        approvedPostCount: 10,
        totalPostCount: 10,
        avgWordCount: 40,
        avgQualityScore: 0.8,
        usernameLength: 14,
        firstActiveAt: null,
        lastActiveAt: null,
      },
    ],
  });
  const { rawAdminSessionToken, rawAdminCsrfToken } = await loginAsAdmin(deps, "admin@example.invalid", "correct-horse-battery-staple");

  const response = await createAdminForumUserOverrideHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/forum-users/fu-1/eligibility-override", {
      method: "POST",
      headers: adminHeaders(rawAdminSessionToken!, rawAdminCsrfToken!),
      body: JSON.stringify({ override: "force_ineligible" }),
    }),
    { forumUserId: "fu-1" },
  );
  assert.equal(response.status, 200);
  const auditEvents = deps.adminAuditRepo as unknown as { events: AdminAuditEventRecord[] };
  const audited = auditEvents.events.at(-1);
  assert.equal(audited?.action, "eligibility.override");
  assert.deepEqual(audited?.metadata, { previousOverride: "none", newOverride: "force_ineligible" });
});

test("moderation approve with a stale expectedVersion returns 409, and the queue/detail responses never carry rawContent outside the single detail endpoint", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({
    now: NOW,
    adminUsers: [admin],
    moderationPosts: [
      {
        id: "post-1",
        forumPid: "555",
        forumTid: "10",
        forumCategoryCid: "2",
        forumUserId: "fu-1",
        forumUsername: "synthetic_user",
        rawContent: "<p>SECRET RAW HTML</p>",
        cleanContent: "clean text",
        moderationStatus: "pending",
        moderationVersion: 0,
        qualityScore: 0.8,
        potentialLeakScore: 0,
        moderationFlags: [],
        wordCount: 10,
        contentLength: 30,
        quoteRatio: 0,
        genericResponseScore: 0,
        linksCount: 0,
        mentionsCount: 0,
        sourceDiverged: false,
        sourceDivergedAt: null,
        postedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  });
  const { rawAdminSessionToken, rawAdminCsrfToken } = await loginAsAdmin(deps, "admin@example.invalid", "correct-horse-battery-staple");
  const headers = adminHeaders(rawAdminSessionToken!, rawAdminCsrfToken!);

  const queueResponse = await createAdminModerationQueueHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/moderation/queue", { headers: { cookie: headers.cookie! } }),
    {},
  );
  const queueBody = await queueResponse.text();
  assert.doesNotMatch(queueBody, /SECRET RAW HTML/);

  const detailResponse = await createAdminModerationDetailHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/moderation/post-1", { headers: { cookie: headers.cookie! } }),
    { forumPostId: "post-1" },
  );
  const detailBody = await detailResponse.text();
  assert.match(detailBody, /SECRET RAW HTML/, "the single-post admin detail view IS allowed to carry raw content");
  assert.match(detailBody, /"sourceUrl":"https:\/\/mitmachim\.top\/post\/555"/);

  const firstApprove = await createAdminModerationApproveHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/moderation/post-1/approve", { method: "POST", headers, body: JSON.stringify({ expectedVersion: 0 }) }),
    { forumPostId: "post-1" },
  );
  assert.equal(firstApprove.status, 200);

  const staleApprove = await createAdminModerationApproveHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/moderation/post-1/approve", { method: "POST", headers, body: JSON.stringify({ expectedVersion: 0 }) }),
    { forumPostId: "post-1" },
  );
  assert.equal(staleApprove.status, 409);
});

test("import trigger returns 409 if one is already running", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple" });
  const { deps } = createAdminTestDeps({ now: NOW, adminUsers: [admin] });
  const { rawAdminSessionToken, rawAdminCsrfToken } = await loginAsAdmin(deps, "admin@example.invalid", "correct-horse-battery-staple");
  const headers = adminHeaders(rawAdminSessionToken!, rawAdminCsrfToken!);

  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  deps.nodebbClient = gatedNodebbClient(gate);

  const firstTriggerPromise = createAdminImportRunTriggerHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/import-runs/trigger", { method: "POST", headers, body: "{}" }),
    {},
  );
  await new Promise((resolve) => setTimeout(resolve, 10));

  const secondTrigger = await createAdminImportRunTriggerHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/import-runs/trigger", { method: "POST", headers, body: "{}" }),
    {},
  );
  assert.equal(secondTrigger.status, 409);

  releaseGate();
  const firstResponse = await firstTriggerPromise;
  assert.equal(firstResponse.status, 202);
});

test("no admin log line captured during a full login+moderation flow ever contains the raw password, session token, or CSRF token", async () => {
  const admin = await seedAdminUser({ email: "admin@example.invalid", password: "correct-horse-battery-staple-super-secret" });
  const { deps, logLines } = createAdminTestDeps({ now: NOW, adminUsers: [admin] });
  const { rawAdminSessionToken, rawAdminCsrfToken } = await loginAsAdmin(deps, "admin@example.invalid", "correct-horse-battery-staple-super-secret");
  await createAdminLogoutHandler(deps)(
    new Request("https://example.invalid/guess/api/admin/logout", { method: "POST", headers: adminHeaders(rawAdminSessionToken!, rawAdminCsrfToken!), body: "{}" }),
    {},
  );

  const joined = logLines.join("\n");
  assert.doesNotMatch(joined, /correct-horse-battery-staple-super-secret/);
  assert.doesNotMatch(joined, new RegExp(rawAdminSessionToken!));
  assert.doesNotMatch(joined, new RegExp(rawAdminCsrfToken!));
});
