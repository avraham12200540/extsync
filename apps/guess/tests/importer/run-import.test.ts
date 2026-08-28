import assert from "node:assert/strict";
import { test } from "node:test";
import type { ForumUserStatsRepository } from "../../src/importer/forum-user-stats-repository";
import type { NodebbClient, RecentTopicsResponse, TopicDetailResponse } from "../../src/importer/nodebb-client";
import { DEFAULT_IMPORT_BUDGETS, defaultImportRunDeps, runImport } from "../../src/importer/run-import";
import type { InMemoryForumRepository } from "./in-memory-repository";
import { createInMemoryForumRepository } from "./in-memory-repository";
import type { InMemoryForumUserStatsRepository } from "./in-memory-stats-repository";
import { createInMemoryForumUserStatsRepository } from "./in-memory-stats-repository";

// All fixtures are synthetic - never real forum content.

function makeTopic(tid: number, postcount = 1) {
  return {
    tid,
    cid: 7,
    slug: `${tid}/synthetic-topic-${tid}`,
    title: `synthetic topic ${tid}`,
    postcount,
    timestamp: 1700000000000,
    user: { uid: 900 + tid, username: `topicStarter${tid}`, userslug: `topic-starter-${tid}` },
  };
}

function makePost(pid: number, tid: number, uid: number, content: string) {
  return {
    pid,
    tid,
    uid,
    content,
    timestamp: 1700000000000,
    user: { uid, username: `user${uid}`, userslug: `user-${uid}` },
  };
}

/** A fake NodebbClient over an in-memory map of "pages" - no HTTP, no real client involved. */
function fakeClient(opts: {
  recentPages: RecentTopicsResponse[];
  topicDetails: Map<number, TopicDetailResponse>;
  onCall?: (kind: "recent" | "topic") => void;
}): Pick<NodebbClient, "getRecentTopics" | "getTopicDetail"> {
  let inFlight = 0;
  let maxConcurrent = 0;
  return {
    async getRecentTopics(page?: number) {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      opts.onCall?.("recent");
      const index = (page ?? 1) - 1;
      const result = opts.recentPages[index] ?? { nextStart: 0, topicCount: 0, topics: [] };
      await Promise.resolve();
      inFlight -= 1;
      return result;
    },
    async getTopicDetail(tid: number) {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      opts.onCall?.("topic");
      const detail = opts.topicDetails.get(tid);
      await Promise.resolve();
      inFlight -= 1;
      if (!detail) throw new Error(`no fixture topic detail for tid=${tid}`);
      return detail;
    },
    __getMaxConcurrent: () => maxConcurrent,
  } as unknown as Pick<NodebbClient, "getRecentTopics" | "getTopicDetail"> & { __getMaxConcurrent: () => number };
}

function testDeps(
  overrides: Omit<Parameters<typeof defaultImportRunDeps>[0], "repository" | "statsRepository"> & {
    repository: InMemoryForumRepository;
    // Optional here (unlike ImportRunDeps itself) precisely because this helper always supplies a
    // working default below - callers only need to override it when a test wants to inspect the
    // stats repository's own recorded calls directly (see the first test in this file).
    statsRepository?: ForumUserStatsRepository;
  },
) {
  return defaultImportRunDeps({
    pacingMs: 0,
    sleep: async () => {},
    clock: Date.now,
    // Defaulted from the same repository fixture the test supplies, so it
    // sees the same posts/users the run actually persisted - a test that
    // wants to inspect stats output directly can still override this.
    statsRepository: createInMemoryForumUserStatsRepository(overrides.repository),
    ...overrides,
  });
}

test("imports new posts from a single small run end to end", async () => {
  const topics = [makeTopic(1, 1)];
  const recentPages: RecentTopicsResponse[] = [{ nextStart: 20, topicCount: 1, topics }];
  const topicDetails = new Map<number, TopicDetailResponse>([
    [1, { tid: 1, cid: 7, slug: topics[0]!.slug, postcount: 1, posts: [makePost(101, 1, 55, "<p>a perfectly ordinary long enough synthetic post about something</p>")] }],
  ]);
  const client = fakeClient({ recentPages, topicDetails });
  const repository = createInMemoryForumRepository();
  const statsRepository: InMemoryForumUserStatsRepository = createInMemoryForumUserStatsRepository(repository);

  const summary = await runImport(testDeps({ client, repository, statsRepository }));

  assert.equal(summary.status, "success");
  assert.equal(summary.stoppedReason, "completed");
  assert.equal(summary.postsNew, 1);
  assert.equal(summary.postsFetched, 1);
  assert.equal(summary.postsDiverged, 0);
  assert.equal(summary.usersTouched, 1);
  // Proves the stats dependency is genuinely wired and invoked (not just type-satisfied) -
  // a regression here previously went undetected because a missing/undefined statsRepository
  // fails inside refreshTouchedStats' own try/catch and only ever surfaces via summary.errors.
  assert.equal(statsRepository.recomputeCalls.length, 1);
  assert.equal(summary.errors.length, 0);
  assert.equal(repository.posts.size, 1);
  const run = repository.importRuns.get(summary.importRunId);
  assert.equal(run?.status, "success");
  assert.equal(run?.postsNew, 1);
});

test("never auto-approves: a newly imported post starts pending or needs_review, never approved", async () => {
  const topics = [makeTopic(1, 1)];
  const recentPages: RecentTopicsResponse[] = [{ nextStart: 20, topicCount: 1, topics }];
  const topicDetails = new Map<number, TopicDetailResponse>([
    [1, { tid: 1, cid: 7, slug: topics[0]!.slug, postcount: 1, posts: [makePost(101, 1, 55, "<p>תודה</p>")] }],
  ]);
  const client = fakeClient({ recentPages, topicDetails });
  const repository = createInMemoryForumRepository();

  await runImport(testDeps({ client, repository }));

  const [post] = [...repository.posts.values()];
  assert.notEqual(post?.moderationStatus, "approved");
  assert.ok(["pending", "needs_review"].includes(post?.moderationStatus ?? ""));
});

test("dedup: re-importing the same forum_pid with identical content does not create a second row", async () => {
  const topics = [makeTopic(1, 1)];
  const recentPages: RecentTopicsResponse[] = [{ nextStart: 20, topicCount: 1, topics }];
  const content = "<p>identical content across two import runs of this same post</p>";
  const topicDetails = new Map<number, TopicDetailResponse>([
    [1, { tid: 1, cid: 7, slug: topics[0]!.slug, postcount: 1, posts: [makePost(101, 1, 55, content)] }],
  ]);
  const client = fakeClient({ recentPages, topicDetails });
  const repository = createInMemoryForumRepository();

  await runImport(testDeps({ client, repository }));
  const secondSummary = await runImport(testDeps({ client, repository }));

  assert.equal(repository.posts.size, 1, "must still be exactly one post row after a second identical import");
  assert.equal(secondSummary.postsNew, 0);
  assert.equal(secondSummary.postsDiverged, 0);
});

test("re-import immutability: divergent upstream content is flagged, never overwrites raw_content", async () => {
  const topics = [makeTopic(1, 1)];
  const originalContent = "<p>the original wording that must never change</p>";
  const changedContent = "<p>a completely different edited wording upstream</p>";

  const client1 = fakeClient({
    recentPages: [{ nextStart: 20, topicCount: 1, topics }],
    topicDetails: new Map([[1, { tid: 1, cid: 7, slug: topics[0]!.slug, postcount: 1, posts: [makePost(101, 1, 55, originalContent)] }]]),
  });
  const repository = createInMemoryForumRepository();
  await runImport(testDeps({ client: client1, repository }));

  const client2 = fakeClient({
    recentPages: [{ nextStart: 20, topicCount: 1, topics }],
    topicDetails: new Map([[1, { tid: 1, cid: 7, slug: topics[0]!.slug, postcount: 1, posts: [makePost(101, 1, 55, changedContent)] }]]),
  });
  const secondSummary = await runImport(testDeps({ client: client2, repository }));

  assert.equal(repository.posts.size, 1);
  const [stored] = [...repository.posts.values()];
  assert.equal(stored?.rawContent, originalContent, "raw_content must remain the original, never the changed upstream content");
  assert.equal(stored?.sourceDiverged, true);
  assert.equal(secondSummary.postsDiverged, 1);
  assert.equal(secondSummary.postsNew, 0);
});

test("stops at the maxTopics budget and records the reason", async () => {
  const topics = [makeTopic(1), makeTopic(2), makeTopic(3)];
  const topicDetails = new Map<number, TopicDetailResponse>(
    topics.map((t) => [t.tid, { tid: t.tid, cid: 7, slug: t.slug, postcount: 1, posts: [makePost(t.tid * 100, t.tid, t.tid * 100, "<p>ordinary content here that is long enough to pass quality checks easily</p>")] }]),
  );
  const client = fakeClient({ recentPages: [{ nextStart: 20, topicCount: 3, topics }], topicDetails });
  const repository = createInMemoryForumRepository();

  const summary = await runImport(
    testDeps({ client, repository, budgets: { ...DEFAULT_IMPORT_BUDGETS, maxTopics: 2 } }),
  );

  assert.equal(summary.stoppedReason, "budget_topics");
  assert.equal(summary.topicsProcessed, 2);
});

test("stops at the maxPosts budget and records the reason", async () => {
  const topic = makeTopic(1, 5);
  const posts = Array.from({ length: 5 }, (_, i) => makePost(100 + i, 1, 200 + i, "<p>ordinary content here that is long enough to pass quality checks easily</p>"));
  const client = fakeClient({
    recentPages: [{ nextStart: 20, topicCount: 1, topics: [topic] }],
    topicDetails: new Map([[1, { tid: 1, cid: 7, slug: topic.slug, postcount: 5, posts }]]),
  });
  const repository = createInMemoryForumRepository();

  const summary = await runImport(testDeps({ client, repository, budgets: { ...DEFAULT_IMPORT_BUDGETS, maxPosts: 3 } }));

  assert.equal(summary.stoppedReason, "budget_posts");
  assert.equal(summary.postsFetched, 3);
});

test("stops at the maxPages budget and records the reason", async () => {
  const topics = [makeTopic(1), makeTopic(2)];
  const topicDetails = new Map<number, TopicDetailResponse>(
    topics.map((t) => [t.tid, { tid: t.tid, cid: 7, slug: t.slug, postcount: 1, posts: [makePost(t.tid * 100, t.tid, t.tid * 100, "<p>ordinary content here that is long enough to pass quality checks easily</p>")] }]),
  );
  const client = fakeClient({ recentPages: [{ nextStart: 20, topicCount: 2, topics }], topicDetails });
  const repository = createInMemoryForumRepository();

  // 1 recent-topics page + at most 1 topic-detail page allowed.
  const summary = await runImport(testDeps({ client, repository, budgets: { ...DEFAULT_IMPORT_BUDGETS, maxPages: 2 } }));

  assert.equal(summary.stoppedReason, "budget_pages");
  assert.equal(summary.pagesFetched, 2);
});

test("stops at the maxDurationMs budget using the injected clock, without needing real wall-clock time", async () => {
  const topics = [makeTopic(1), makeTopic(2), makeTopic(3)];
  const topicDetails = new Map<number, TopicDetailResponse>(
    topics.map((t) => [t.tid, { tid: t.tid, cid: 7, slug: t.slug, postcount: 1, posts: [makePost(t.tid * 100, t.tid, t.tid * 100, "<p>ordinary content here that is long enough to pass quality checks easily</p>")] }]),
  );
  let now = 0;
  const client = fakeClient({
    recentPages: [{ nextStart: 20, topicCount: 3, topics }],
    topicDetails,
    onCall: () => {
      now += 1000; // each call "takes" 1 second on the fake clock
    },
  });
  const repository = createInMemoryForumRepository();

  const summary = await runImport(
    testDeps({ client, repository, clock: () => now, budgets: { ...DEFAULT_IMPORT_BUDGETS, maxDurationMs: 2500 } }),
  );

  assert.equal(summary.stoppedReason, "budget_duration");
  assert.ok(summary.topicsProcessed < 3, "must stop before processing every topic");
});

test("paces between requests using the injected sleep with the configured pacingMs", async () => {
  const topics = [makeTopic(1), makeTopic(2)];
  const topicDetails = new Map<number, TopicDetailResponse>(
    topics.map((t) => [t.tid, { tid: t.tid, cid: 7, slug: t.slug, postcount: 1, posts: [makePost(t.tid * 100, t.tid, t.tid * 100, "<p>ordinary content here that is long enough to pass quality checks easily</p>")] }]),
  );
  const client = fakeClient({ recentPages: [{ nextStart: 20, topicCount: 2, topics }], topicDetails });
  const repository = createInMemoryForumRepository();
  const sleepCalls: number[] = [];

  await runImport(
    testDeps({
      client,
      repository,
      pacingMs: 1500,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    }),
  );

  // 1 recent-topics call + 2 topic-detail calls = 3 requests total, so 2 paced gaps (no sleep before the very first request).
  assert.equal(sleepCalls.length, 2);
  assert.ok(sleepCalls.every((ms) => ms === 1500));
});

test("issues never more than one request in flight at a time", async () => {
  const topics = [makeTopic(1), makeTopic(2), makeTopic(3)];
  const topicDetails = new Map<number, TopicDetailResponse>(
    topics.map((t) => [t.tid, { tid: t.tid, cid: 7, slug: t.slug, postcount: 1, posts: [makePost(t.tid * 100, t.tid, t.tid * 100, "<p>ordinary content here that is long enough to pass quality checks easily</p>")] }]),
  );
  const client = fakeClient({ recentPages: [{ nextStart: 20, topicCount: 3, topics }], topicDetails }) as ReturnType<typeof fakeClient> & {
    __getMaxConcurrent: () => number;
  };
  const repository = createInMemoryForumRepository();

  await runImport(testDeps({ client, repository }));

  assert.equal(client.__getMaxConcurrent(), 1);
});

test("failure isolation: one topic that fails to fetch does not abort the run, and is recorded in errors", async () => {
  const topics = [makeTopic(1), makeTopic(2)];
  const topicDetails = new Map<number, TopicDetailResponse>([
    // tid=1 deliberately has no fixture, so getTopicDetail throws for it.
    [2, { tid: 2, cid: 7, slug: topics[1]!.slug, postcount: 1, posts: [makePost(200, 2, 555, "<p>this second topic must still be imported despite the first failing</p>")] }],
  ]);
  const client = fakeClient({ recentPages: [{ nextStart: 20, topicCount: 2, topics }], topicDetails });
  const repository = createInMemoryForumRepository();

  const summary = await runImport(testDeps({ client, repository }));

  assert.equal(summary.status, "partial_failure");
  assert.equal(summary.postsNew, 1, "the second, healthy topic must still have been imported");
  assert.ok(summary.errors.some((e) => e.includes("tid=1")));
  const run = repository.importRuns.get(summary.importRunId);
  assert.equal(run?.status, "partial_failure");
});

test("fatal failure: the very first request failing marks the run failed, not silently empty-success", async () => {
  const client: Pick<NodebbClient, "getRecentTopics" | "getTopicDetail"> = {
    getRecentTopics: async () => {
      throw new Error("simulated total outage");
    },
    getTopicDetail: async () => {
      throw new Error("unreachable");
    },
  };
  const repository = createInMemoryForumRepository();

  const summary = await runImport(testDeps({ client, repository }));

  assert.equal(summary.status, "failed");
  assert.equal(summary.stoppedReason, "fatal_error");
  const run = repository.importRuns.get(summary.importRunId);
  assert.equal(run?.status, "failed");
  assert.ok(run?.errorSummary?.includes("simulated total outage"));
});

test("ImportRun trigger metadata is recorded as given (admin vs cron)", async () => {
  const client = fakeClient({ recentPages: [{ nextStart: 0, topicCount: 0, topics: [] }], topicDetails: new Map() });
  const repository = createInMemoryForumRepository();

  const summary = await runImport(testDeps({ client, repository, triggerKind: "cron", triggeredByAdminId: null }));

  const run = repository.importRuns.get(summary.importRunId);
  assert.equal(run?.triggerKind, "cron");
  assert.equal(run?.triggeredByAdminId, null);
});
