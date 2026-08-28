import type { Page, Route } from "@playwright/test";

/**
 * Synthetic in-memory backend for /guess/api/session and /guess/api/admin/**,
 * mirroring mock-api.ts's approach for the public game API: a real Next.js
 * dev/prod server, real client code, only the network layer is intercepted.
 * Nothing here touches a real database, a real admin account, or the real
 * mitmachim.top importer. All fixture data (usernames, post text, emails) is
 * synthetic.
 */

export const FIXTURE_ADMIN_EMAIL = "admin@example.invalid";
export const FIXTURE_ADMIN_PASSWORD = "correct-horse-battery-staple";

export interface MockModerationPost {
  id: string;
  forumPid: string;
  forumUserId: string;
  forumUsername: string;
  moderationStatus: "pending" | "approved" | "rejected" | "needs_review";
  qualityScore: number;
  potentialLeakScore: number;
  moderationFlags: { code: string; reason: string }[];
  wordCount: number;
  postedAt: string;
  moderationVersion: number;
  sourceDiverged: boolean;
  rawContent: string;
  cleanContent: string | null;
  forumTid: string;
  forumCategoryCid: string;
  sourceUrl: string;
  contentLength: number;
  quoteRatio: number;
  genericResponseScore: number;
  linksCount: number;
  mentionsCount: number;
  sourceDivergedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MockForumUser {
  id: string;
  forumUid: string;
  forumUsername: string;
  forumUserslug: string;
  accountStatus: string;
  isSystemOrBot: boolean;
  adminOverride: string;
  computedEligible: boolean;
  effectiveEligible: boolean;
  approvedPostCount: number;
  totalPostCount: number;
  createdAt: string;
  updatedAt: string;
  effectiveReasons: { code: string; reason: string }[];
  computedReasons: { code: string; reason: string }[];
  avgWordCount: number;
  avgQualityScore: number;
  usernameLength: number;
  firstActiveAt: string | null;
  lastActiveAt: string | null;
}

export interface MockImportRun {
  id: string;
  status: "running" | "success" | "partial_failure" | "failed";
  triggerKind: "admin" | "cron";
  triggeredByAdminId: string | null;
  sourceEndpoint: string;
  cursorUsed: string | null;
  postsFetched: number;
  postsNew: number;
  postsUpdated: number;
  usersTouched: number;
  rateLimitEvents: number;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AdminMockController {
  requestLog: { method: string; pathname: string }[];
  /** Simulates a hard reload landing on an already-valid admin session (no admin CSRF token cached yet). */
  setLoggedIn(loggedIn: boolean): void;
  /** Forces the next moderation mutation (approve/reject/edit) to report a stale-version conflict, regardless of the client's expectedVersion. */
  forceConflictOnce(): void;
  /** Forces the next import trigger to report "already running" instead of executing. */
  setImportOverlap(overlap: boolean): void;
}

export interface AdminMockConfig {
  moderationPosts: MockModerationPost[];
  forumUsers: MockForumUser[];
  importRuns: MockImportRun[];
}

export async function installAdminMockApi(page: Page, config: AdminMockConfig): Promise<AdminMockController> {
  const playerCsrf = "player-csrf-fixture";
  const adminCsrf = "admin-csrf-fixture";
  let loggedIn = false;
  let forceConflict = false;
  let importOverlap = false;
  const requestLog: AdminMockController["requestLog"] = [];

  const posts = new Map(config.moderationPosts.map((p) => [p.id, { ...p }]));
  const users = new Map(config.forumUsers.map((u) => [u.id, { ...u }]));
  const runs = [...config.importRuns];

  async function fulfillJson(route: Route, status: number, body: unknown) {
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  }

  async function fulfillError(route: Route, status: number, code: string) {
    await fulfillJson(route, status, { error: { code, message: code } });
  }

  function requireAdminSession(route: Route): boolean {
    if (!loggedIn) {
      void fulfillError(route, 401, "unauthenticated");
      return false;
    }
    return true;
  }

  function requireAdminCsrf(route: Route): boolean {
    const header = route.request().headers()["x-guess-admin-csrf"];
    if (header !== adminCsrf) {
      void fulfillError(route, 403, "csrf_failed");
      return false;
    }
    return true;
  }

  function moderationView(post: MockModerationPost) {
    return post;
  }

  function queueItemView(post: MockModerationPost) {
    const { rawContent, cleanContent, forumTid, forumCategoryCid, sourceUrl, contentLength, quoteRatio, genericResponseScore, linksCount, mentionsCount, sourceDivergedAt, createdAt, updatedAt, ...rest } =
      post;
    void rawContent;
    void cleanContent;
    void forumTid;
    void forumCategoryCid;
    void sourceUrl;
    void contentLength;
    void quoteRatio;
    void genericResponseScore;
    void linksCount;
    void mentionsCount;
    void sourceDivergedAt;
    void createdAt;
    void updatedAt;
    return rest;
  }

  await page.route("**/guess/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/^\/guess\/api/, "");
    const method = request.method();
    requestLog.push({ method, pathname });

    if (method === "POST" && pathname === "/session") {
      await fulfillJson(route, 200, { csrfToken: playerCsrf, sessionExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
      return;
    }

    if (method === "POST" && pathname === "/admin/login") {
      const body = request.postDataJSON() as { email: string; password: string };
      if (body.email !== FIXTURE_ADMIN_EMAIL || body.password !== FIXTURE_ADMIN_PASSWORD) {
        await fulfillError(route, 401, "invalid_credentials");
        return;
      }
      loggedIn = true;
      await fulfillJson(route, 200, {
        adminUserId: "admin-1",
        email: FIXTURE_ADMIN_EMAIL,
        sessionExpiresAt: new Date(Date.now() + 12 * 60 * 60_000).toISOString(),
        csrfToken: adminCsrf,
      });
      return;
    }

    if (method === "GET" && pathname === "/admin/session") {
      if (!loggedIn) {
        await fulfillError(route, 401, "unauthenticated");
        return;
      }
      await fulfillJson(route, 200, { adminUserId: "admin-1", email: FIXTURE_ADMIN_EMAIL, sessionExpiresAt: new Date(Date.now() + 12 * 60 * 60_000).toISOString() });
      return;
    }

    if (method === "POST" && pathname === "/admin/logout") {
      loggedIn = false;
      await fulfillJson(route, 200, { loggedOut: true });
      return;
    }

    if (method === "POST" && pathname === "/admin/sessions/revoke-others") {
      if (!requireAdminSession(route) || !requireAdminCsrf(route)) return;
      await fulfillJson(route, 200, { revokedCount: 1 });
      return;
    }

    if (method === "GET" && pathname === "/admin/moderation/queue") {
      if (!requireAdminSession(route)) return;
      const status = url.searchParams.get("status");
      const sortField = url.searchParams.get("sortField") ?? "postedAt";
      const sortDirection = url.searchParams.get("sortDirection") ?? "desc";
      const page = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Number(url.searchParams.get("pageSize") ?? "25");

      let items = [...posts.values()];
      if (status) items = items.filter((p) => p.moderationStatus === status);
      items.sort((a, b) => {
        let cmp = 0;
        if (sortField === "postedAt") cmp = new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime();
        else if (sortField === "qualityScore") cmp = a.qualityScore - b.qualityScore;
        else if (sortField === "potentialLeakScore") cmp = a.potentialLeakScore - b.potentialLeakScore;
        else if (sortField === "wordCount") cmp = a.wordCount - b.wordCount;
        return sortDirection === "asc" ? cmp : -cmp;
      });
      const start = (page - 1) * pageSize;
      const pageItems = items.slice(start, start + pageSize).map(queueItemView);
      await fulfillJson(route, 200, { items: pageItems, totalCount: items.length, page, pageSize });
      return;
    }

    const moderationDetailMatch = pathname.match(/^\/admin\/moderation\/([^/]+)$/);
    if (method === "GET" && moderationDetailMatch) {
      if (!requireAdminSession(route)) return;
      const post = posts.get(decodeURIComponent(moderationDetailMatch[1]!));
      if (!post) {
        await fulfillError(route, 404, "not_found");
        return;
      }
      await fulfillJson(route, 200, moderationView(post));
      return;
    }

    const moderationMutationMatch = pathname.match(/^\/admin\/moderation\/([^/]+)\/(approve|reject|edit)$/);
    if (method === "POST" && moderationMutationMatch) {
      if (!requireAdminSession(route) || !requireAdminCsrf(route)) return;
      const postId = decodeURIComponent(moderationMutationMatch[1]!);
      const action = moderationMutationMatch[2]!;
      const post = posts.get(postId);
      if (!post) {
        await fulfillError(route, 404, "not_found");
        return;
      }
      const body = request.postDataJSON() as { expectedVersion: number; reason?: string; cleanContent?: string };
      if (forceConflict || body.expectedVersion !== post.moderationVersion) {
        forceConflict = false;
        await fulfillError(route, 409, "moderation_conflict");
        return;
      }
      post.moderationVersion += 1;
      post.updatedAt = new Date().toISOString();
      if (action === "approve") post.moderationStatus = "approved";
      if (action === "reject") post.moderationStatus = "rejected";
      if (action === "edit") post.cleanContent = body.cleanContent ?? post.cleanContent;
      await fulfillJson(route, 200, moderationView(post));
      return;
    }

    const forumUserDetailMatch = pathname.match(/^\/admin\/forum-users\/([^/]+)$/);
    if (method === "GET" && forumUserDetailMatch) {
      if (!requireAdminSession(route)) return;
      const user = users.get(decodeURIComponent(forumUserDetailMatch[1]!));
      if (!user) {
        await fulfillError(route, 404, "not_found");
        return;
      }
      await fulfillJson(route, 200, user);
      return;
    }

    if (method === "GET" && pathname === "/admin/import-runs") {
      if (!requireAdminSession(route)) return;
      const page = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Number(url.searchParams.get("pageSize") ?? "25");
      const sorted = [...runs].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      const start = (page - 1) * pageSize;
      await fulfillJson(route, 200, { items: sorted.slice(start, start + pageSize), totalCount: sorted.length, page, pageSize });
      return;
    }

    if (method === "POST" && pathname === "/admin/import-runs/trigger") {
      if (!requireAdminSession(route) || !requireAdminCsrf(route)) return;
      if (importOverlap) {
        await fulfillError(route, 409, "import_already_running");
        return;
      }
      const now = new Date().toISOString();
      const newRun: MockImportRun = {
        id: `run-${runs.length + 1}`,
        status: "success",
        triggerKind: "admin",
        triggeredByAdminId: "admin-1",
        sourceEndpoint: "/api/recent",
        cursorUsed: null,
        postsFetched: 3,
        postsNew: 2,
        postsUpdated: 0,
        usersTouched: 2,
        rateLimitEvents: 0,
        errorSummary: null,
        startedAt: now,
        finishedAt: now,
      };
      runs.push(newRun);
      await fulfillJson(route, 202, {
        importRunId: newRun.id,
        status: newRun.status,
        stoppedReason: "completed",
        postsFetched: newRun.postsFetched,
        postsNew: newRun.postsNew,
        postsDiverged: 0,
        usersTouched: newRun.usersTouched,
        pagesFetched: 1,
        errorCount: 0,
      });
      return;
    }

    await fulfillError(route, 404, "not_found");
  });

  return {
    requestLog,
    setLoggedIn(value) {
      loggedIn = value;
    },
    forceConflictOnce() {
      forceConflict = true;
    },
    setImportOverlap(value) {
      importOverlap = value;
    },
  };
}

export function defaultAdminConfig(overrides?: Partial<AdminMockConfig>): AdminMockConfig {
  return {
    forumUsers: [
      {
        id: "user-1",
        forumUid: "501",
        forumUsername: "דניאל_כהן",
        forumUserslug: "daniel-cohen",
        accountStatus: "active",
        isSystemOrBot: false,
        adminOverride: "none",
        computedEligible: true,
        effectiveEligible: true,
        approvedPostCount: 12,
        totalPostCount: 15,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        effectiveReasons: [{ code: "approved_threshold_met", reason: "Cleared the approved-post threshold" }],
        computedReasons: [{ code: "approved_threshold_met", reason: "Cleared the approved-post threshold" }],
        avgWordCount: 42,
        avgQualityScore: 0.71,
        usernameLength: 10,
        firstActiveAt: "2025-06-01T00:00:00.000Z",
        lastActiveAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    moderationPosts: [
      {
        id: "post-1",
        forumPid: "9001",
        forumUserId: "user-1",
        forumUsername: "דניאל_כהן",
        moderationStatus: "pending",
        qualityScore: 0.64,
        potentialLeakScore: 0.12,
        // Codes match the real, closed set src/importer/quality.ts's deriveModerationFlags emits -
        // never a fabricated code, so the UI's code-to-label mapping is exercised against realistic values.
        moderationFlags: [{ code: "mostly_quoted", reason: "quote ratio 0.65 exceeds the maximum of 0.6" }],
        wordCount: 38,
        postedAt: "2026-01-02T10:00:00.000Z",
        moderationVersion: 0,
        sourceDiverged: false,
        // Deliberately contains HTML-looking markup to prove it is rendered as inert text, never parsed.
        rawContent: '<b>נסיון הזרקה</b><script>alert(1)</script> תוכן גולמי לבדיקה עם <i>תגיות</i> שלא אמורות להיות מפורשות.',
        cleanContent: "תוכן מסונן לבדיקה, טקסט רגיל בלבד.",
        forumTid: "701",
        forumCategoryCid: "7",
        sourceUrl: "https://mitmachim.top/post/9001",
        contentLength: 120,
        quoteRatio: 0.4,
        genericResponseScore: 0.1,
        linksCount: 0,
        mentionsCount: 0,
        sourceDivergedAt: null,
        createdAt: "2026-01-02T10:05:00.000Z",
        updatedAt: "2026-01-02T10:05:00.000Z",
      },
      {
        id: "post-2",
        forumPid: "9002",
        forumUserId: "user-1",
        forumUsername: "דניאל_כהן",
        moderationStatus: "needs_review",
        qualityScore: 0.31,
        potentialLeakScore: 0.55,
        moderationFlags: [
          { code: "generic_reply", reason: 'generic-response score 0.80 suggests a low-effort reply (e.g. "thanks"/"works")' },
          { code: "potential_identity_leak", reason: "potential-leak score 0.55 (self-reference and/or signature block detected)" },
        ],
        wordCount: 9,
        postedAt: "2026-01-03T08:00:00.000Z",
        moderationVersion: 0,
        sourceDiverged: true,
        rawContent: "תודה רבה!",
        cleanContent: "תודה רבה",
        forumTid: "702",
        forumCategoryCid: "7",
        sourceUrl: "https://mitmachim.top/post/9002",
        contentLength: 12,
        quoteRatio: 0,
        genericResponseScore: 0.8,
        linksCount: 0,
        mentionsCount: 0,
        sourceDivergedAt: "2026-01-04T00:00:00.000Z",
        createdAt: "2026-01-03T08:05:00.000Z",
        updatedAt: "2026-01-04T00:00:00.000Z",
      },
    ],
    importRuns: [
      {
        id: "run-1",
        status: "success",
        triggerKind: "cron",
        triggeredByAdminId: null,
        sourceEndpoint: "/api/recent",
        cursorUsed: null,
        postsFetched: 12,
        postsNew: 5,
        postsUpdated: 0,
        usersTouched: 4,
        rateLimitEvents: 0,
        errorSummary: null,
        startedAt: "2026-01-01T06:00:00.000Z",
        finishedAt: "2026-01-01T06:02:00.000Z",
      },
      {
        id: "run-2",
        status: "partial_failure",
        triggerKind: "admin",
        triggeredByAdminId: "admin-1",
        sourceEndpoint: "/api/recent",
        cursorUsed: null,
        postsFetched: 8,
        postsNew: 2,
        postsUpdated: 0,
        usersTouched: 2,
        rateLimitEvents: 0,
        errorSummary: "topic tid=44: no fixture topic detail for tid=44",
        startedAt: "2026-01-02T06:00:00.000Z",
        finishedAt: "2026-01-02T06:01:00.000Z",
      },
    ],
    ...overrides,
  };
}
