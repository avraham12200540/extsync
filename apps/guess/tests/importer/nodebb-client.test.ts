import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NodebbRequestFailedError,
  NodebbUnsafeRedirectError,
  NodebbValidationError,
  createNodebbClient,
} from "../../src/importer/nodebb-client";

// All fixtures below are synthetic, hand-written shapes matching the
// field names actually observed live (see nodebb-client.ts header) -
// never real post content.

function fakeRecentBody() {
  return {
    nextStart: 20,
    topicCount: 1,
    topics: [
      {
        tid: 1,
        cid: 2,
        slug: "1/synthetic-topic",
        title: "synthetic topic",
        postcount: 1,
        timestamp: 1700000000000,
        user: { uid: 9, username: "synthetic_user", userslug: "synthetic-user" },
      },
    ],
  };
}

function fakeTopicBody() {
  return {
    tid: 1,
    cid: 2,
    slug: "1/synthetic-topic",
    postcount: 1,
    posts: [
      {
        pid: 55,
        tid: 1,
        uid: 9,
        content: "<p>synthetic post body</p>",
        timestamp: 1700000000000,
        user: {
          uid: 9,
          username: "synthetic_user",
          userslug: "synthetic-user",
          // extra profile fields a real response would carry - must be
          // dropped by schema validation, not just ignored downstream.
          signature: "my signature",
          picture: "/uploads/avatar.png",
          reputation: 42,
        },
      },
    ],
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function noopSleepRecorder() {
  const calls: number[] = [];
  const sleep = async (ms: number) => {
    calls.push(ms);
  };
  return { sleep, calls };
}

test("getRecentTopics returns validated data and drops unknown fields via the schema itself", async () => {
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = input.toString();
    capturedHeaders = new Headers(init?.headers);
    return jsonResponse(200, fakeRecentBody());
  }) as typeof fetch;

  const client = createNodebbClient({ fetchImpl, userAgent: "TestAgent/1.0" });
  const result = await client.getRecentTopics();

  assert.equal(capturedUrl, "https://mitmachim.top/api/recent");
  assert.equal(capturedHeaders?.get("user-agent"), "TestAgent/1.0");
  assert.equal(capturedHeaders?.get("accept"), "application/json");
  assert.equal(result.topics.length, 1);
  assert.equal(result.topics[0]?.slug, "1/synthetic-topic");
});

test("getTopicDetail drops profile fields (signature/picture/reputation) that are not declared in the schema", async () => {
  const fetchImpl = (async () => jsonResponse(200, fakeTopicBody())) as typeof fetch;
  const client = createNodebbClient({ fetchImpl });
  const result = await client.getTopicDetail(1, "1/synthetic-topic");

  const user = result.posts[0]?.user as unknown as Record<string, unknown>;
  assert.equal(user?.username, "synthetic_user");
  assert.equal("signature" in (user ?? {}), false);
  assert.equal("picture" in (user ?? {}), false);
  assert.equal("reputation" in (user ?? {}), false);
});

test("getTopicDetail appends ?page=N only when page > 1", async () => {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(input.toString());
    return jsonResponse(200, fakeTopicBody());
  }) as typeof fetch;
  const client = createNodebbClient({ fetchImpl });

  await client.getTopicDetail(1, "1/synthetic-topic");
  await client.getTopicDetail(1, "1/synthetic-topic", 1);
  await client.getTopicDetail(1, "1/synthetic-topic", 3);

  assert.equal(urls[0], "https://mitmachim.top/api/topic/1/1%2Fsynthetic-topic");
  assert.equal(urls[1], "https://mitmachim.top/api/topic/1/1%2Fsynthetic-topic");
  assert.equal(urls[2], "https://mitmachim.top/api/topic/1/1%2Fsynthetic-topic?page=3");
});

test("getRecentTopics appends ?page=N only when page > 1", async () => {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(input.toString());
    return jsonResponse(200, fakeRecentBody());
  }) as typeof fetch;
  const client = createNodebbClient({ fetchImpl });

  await client.getRecentTopics();
  await client.getRecentTopics(1);
  await client.getRecentTopics(2);

  assert.equal(urls[0], "https://mitmachim.top/api/recent");
  assert.equal(urls[1], "https://mitmachim.top/api/recent");
  assert.equal(urls[2], "https://mitmachim.top/api/recent?page=2");
});

test("retries a 503 with backoff+jitter and succeeds on the next attempt", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return jsonResponse(503, {});
    return jsonResponse(200, fakeRecentBody());
  }) as typeof fetch;
  const { sleep, calls: sleepCalls } = noopSleepRecorder();

  const client = createNodebbClient({ fetchImpl, sleep, random: () => 0.5 });
  const result = await client.getRecentTopics();

  assert.equal(calls, 2);
  assert.equal(sleepCalls.length, 1);
  // backoff = 500 * 2^0 + 0.5*500 = 750
  assert.equal(sleepCalls[0], 750);
  assert.equal(result.topicCount, 1);
});

test("gives up after MAX_RETRIES (3) persistent 500s and throws NodebbRequestFailedError", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse(500, {});
  }) as typeof fetch;
  const { sleep, calls: sleepCalls } = noopSleepRecorder();

  const client = createNodebbClient({ fetchImpl, sleep, random: () => 0 });
  await assert.rejects(() => client.getRecentTopics(), NodebbRequestFailedError);

  // 1 initial attempt + 3 retries = 4 fetch calls, 3 sleeps between them.
  assert.equal(calls, 4);
  assert.equal(sleepCalls.length, 3);
});

test("a 404 is terminal and is never retried", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse(404, {});
  }) as typeof fetch;
  const { sleep, calls: sleepCalls } = noopSleepRecorder();

  const client = createNodebbClient({ fetchImpl, sleep });
  await assert.rejects(() => client.getRecentTopics(), NodebbRequestFailedError);

  assert.equal(calls, 1);
  assert.equal(sleepCalls.length, 0);
});

test("a network-level failure (fetch throws) is retried like a timeout", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls <= 2) throw new Error("simulated ECONNRESET");
    return jsonResponse(200, fakeRecentBody());
  }) as typeof fetch;
  const { sleep, calls: sleepCalls } = noopSleepRecorder();

  const client = createNodebbClient({ fetchImpl, sleep, random: () => 0 });
  const result = await client.getRecentTopics();

  assert.equal(calls, 3);
  assert.equal(sleepCalls.length, 2);
  assert.equal(result.topicCount, 1);
});

test("follows a same-host https redirect", async () => {
  let calls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls += 1;
    if (calls === 1) {
      assert.equal(input.toString(), "https://mitmachim.top/api/recent");
      return jsonResponse(302, {}, { location: "https://mitmachim.top/api/recent/moved" });
    }
    assert.equal(input.toString(), "https://mitmachim.top/api/recent/moved");
    return jsonResponse(200, fakeRecentBody());
  }) as typeof fetch;

  const client = createNodebbClient({ fetchImpl });
  const result = await client.getRecentTopics();
  assert.equal(calls, 2);
  assert.equal(result.topicCount, 1);
});

test("rejects a cross-host redirect immediately, without retrying", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse(302, {}, { location: "https://evil.example.com/steal" });
  }) as typeof fetch;
  const { sleep, calls: sleepCalls } = noopSleepRecorder();

  const client = createNodebbClient({ fetchImpl, sleep });
  await assert.rejects(() => client.getRecentTopics(), NodebbUnsafeRedirectError);

  assert.equal(calls, 1, "must not retry a policy violation");
  assert.equal(sleepCalls.length, 0);
});

test("rejects a same-host redirect to plain http (non-https)", async () => {
  const fetchImpl = (async () => jsonResponse(302, {}, { location: "http://mitmachim.top/api/recent" })) as typeof fetch;
  const client = createNodebbClient({ fetchImpl });
  await assert.rejects(() => client.getRecentTopics(), NodebbUnsafeRedirectError);
});

test("gives up after exceeding the same-host redirect cap", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse(302, {}, { location: `https://mitmachim.top/api/recent?hop=${calls}` });
  }) as typeof fetch;

  const client = createNodebbClient({ fetchImpl });
  await assert.rejects(() => client.getRecentTopics(), NodebbRequestFailedError);
  // MAX_SAME_HOST_REDIRECTS = 2, so: initial + 2 followed redirects, then the 3rd redirect response is rejected.
  assert.equal(calls, 3);
});

test("a timeout (AbortError) is retried like any other transient failure", async () => {
  let calls = 0;
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    if (calls === 1) {
      const abortError = new DOMException("The operation was aborted.", "AbortError");
      throw abortError;
    }
    void init;
    return jsonResponse(200, fakeRecentBody());
  }) as typeof fetch;
  const { sleep } = noopSleepRecorder();

  const client = createNodebbClient({ fetchImpl, sleep, random: () => 0 });
  const result = await client.getRecentTopics();
  assert.equal(calls, 2);
  assert.equal(result.topicCount, 1);
});

test("a response shape that fails schema validation throws NodebbValidationError, not a silent pass-through", async () => {
  const fetchImpl = (async () => jsonResponse(200, { nextStart: "not-a-number", topics: [] })) as typeof fetch;
  const client = createNodebbClient({ fetchImpl });
  await assert.rejects(() => client.getRecentTopics(), NodebbValidationError);
});
