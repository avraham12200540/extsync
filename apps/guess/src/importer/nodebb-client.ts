import { z } from "zod";
import { NODEBB_ORIGIN } from "../lib/nodebb-origin";

/**
 * Server-only client for mitmachim.top's public, read-only NodeBB REST
 * API. The origin is a compile-time literal - there is no parameter, env
 * var, or config path that lets any caller point this client at a
 * different host. This is the only module in the importer allowed to make
 * outbound HTTP requests; gameplay code must never import it.
 *
 * Verified live (read-only, polite, single-request-per-endpoint) during
 * the architecture/implementation review that produced this file:
 *   GET /api/recent                      -> 200, {nextStart, topicCount, topics: [...]}
 *   GET /api/topic/{tid}/{slug}           -> 200, {tid, cid, slug, postcount, posts: [...]}
 * Both schemas below only declare the fields this importer actually
 * consumes; Zod's default (non-strict, non-passthrough) object parsing
 * silently drops every other field NodeBB returns - including profile
 * fields observed on `post.user` in the real response (signature,
 * picture, reputation, banned, lastonline, ...) that this app must never
 * store (see repository.ts). That drop happens at validation time, not by
 * later manual filtering, so there is no code path that could
 * accidentally forward them.
 * `?page=N` pagination on the topic-detail endpoint follows NodeBB's
 * documented convention but was NOT independently re-verified live here
 * (only page 1 of a single-post topic was fetched) - noted as an
 * unverified assumption, not a confirmed fact.
 */

const ALLOWED_HOST = "mitmachim.top";
const MAX_SAME_HOST_REDIRECTS = 2;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

export class NodebbUnsafeRedirectError extends Error {}
export class NodebbRequestFailedError extends Error {}
export class NodebbValidationError extends Error {}

const nodebbUserSchema = z.object({
  uid: z.number(),
  username: z.string(),
  userslug: z.string(),
});

const recentTopicSchema = z.object({
  tid: z.number(),
  cid: z.number(),
  slug: z.string(),
  title: z.string(),
  postcount: z.number(),
  timestamp: z.number(),
  user: nodebbUserSchema,
});

export const recentTopicsResponseSchema = z.object({
  nextStart: z.number(),
  topicCount: z.number(),
  topics: z.array(recentTopicSchema),
});
export type RecentTopicsResponse = z.infer<typeof recentTopicsResponseSchema>;
export type RecentTopic = z.infer<typeof recentTopicSchema>;

const topicPostSchema = z.object({
  pid: z.number(),
  tid: z.number(),
  uid: z.number(),
  content: z.string(),
  timestamp: z.number(),
  user: nodebbUserSchema,
});
export type TopicPost = z.infer<typeof topicPostSchema>;

export const topicDetailResponseSchema = z.object({
  tid: z.number(),
  cid: z.number(),
  slug: z.string(),
  postcount: z.number(),
  posts: z.array(topicPostSchema),
});
export type TopicDetailResponse = z.infer<typeof topicDetailResponseSchema>;

export interface NodebbClientDeps {
  /** Defaults to the global `fetch`. Overridable only for tests. */
  fetchImpl: typeof fetch;
  /** Defaults to a real `setTimeout`-based sleep. Overridable for tests so retry/backoff tests run instantly. */
  sleep: (ms: number) => Promise<void>;
  /** Defaults to `Math.random`. Overridable for tests so jitter is deterministic. */
  random: () => number;
  userAgent: string;
}

export function defaultNodebbClientDeps(): NodebbClientDeps {
  return {
    fetchImpl: fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    userAgent: "ExtSyncGuessImporter/0.1 (+https://extsync.com/guess; contact via extsync.com)",
  };
}

function buildAllowedUrl(path: string): URL {
  const url = new URL(path, NODEBB_ORIGIN);
  if (url.hostname !== ALLOWED_HOST || url.protocol !== "https:") {
    throw new NodebbUnsafeRedirectError(
      `refusing to request non-allowlisted URL: ${url.hostname} (only ${ALLOWED_HOST} over https is permitted)`,
    );
  }
  return url;
}

function backoffDelayMs(attempt: number, random: () => number): number {
  const exponential = BASE_BACKOFF_MS * 2 ** attempt;
  const jitter = random() * BASE_BACKOFF_MS;
  return exponential + jitter;
}

/**
 * Performs one logical GET, following same-host HTTPS redirects up to
 * MAX_SAME_HOST_REDIRECTS and retrying 5xx/timeout/network failures up to
 * MAX_RETRIES times with exponential backoff + jitter. 4xx responses are
 * terminal and never retried. A cross-host or non-https redirect target
 * aborts immediately without retrying (it is a policy violation, not a
 * transient failure).
 */
async function fetchWithPolicy(path: string, deps: NodebbClientDeps): Promise<Response> {
  let currentUrl = buildAllowedUrl(path);
  let redirectsFollowed = 0;
  let attempt = 0;

  for (;;) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await deps.fetchImpl(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": deps.userAgent,
        },
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (attempt >= MAX_RETRIES) {
        throw new NodebbRequestFailedError(
          `request to ${currentUrl} failed after ${attempt} retries: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await deps.sleep(backoffDelayMs(attempt, deps.random));
      attempt += 1;
      continue;
    }
    clearTimeout(timeoutHandle);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new NodebbRequestFailedError(`redirect response from ${currentUrl} carried no Location header`);
      }
      if (redirectsFollowed >= MAX_SAME_HOST_REDIRECTS) {
        throw new NodebbRequestFailedError(`exceeded ${MAX_SAME_HOST_REDIRECTS} redirects starting from ${path}`);
      }
      // Throws NodebbUnsafeRedirectError itself if the target is off-host/non-https.
      currentUrl = buildAllowedUrl(new URL(location, currentUrl).toString());
      redirectsFollowed += 1;
      continue;
    }

    if (RETRYABLE_STATUS.has(response.status)) {
      if (attempt >= MAX_RETRIES) {
        throw new NodebbRequestFailedError(`${currentUrl} returned ${response.status} after ${attempt} retries`);
      }
      await deps.sleep(backoffDelayMs(attempt, deps.random));
      attempt += 1;
      continue;
    }

    return response;
  }
}

async function fetchAndValidate<T>(path: string, schema: z.ZodType<T>, deps: NodebbClientDeps): Promise<T> {
  const response = await fetchWithPolicy(path, deps);
  if (!response.ok) {
    throw new NodebbRequestFailedError(`${path} returned ${response.status}`);
  }
  const json: unknown = await response.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new NodebbValidationError(`${path} response failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function createNodebbClient(overrides: Partial<NodebbClientDeps> = {}) {
  const deps: NodebbClientDeps = { ...defaultNodebbClientDeps(), ...overrides };

  return {
    async getRecentTopics(page?: number): Promise<RecentTopicsResponse> {
      // `?page=N` pagination on /api/recent follows the same NodeBB
      // convention as the topic-detail endpoint but, like that endpoint's
      // page>1 case, was not independently re-verified live here (only
      // page 1 was fetched during the read-only verification for this
      // client) - documented as an unverified assumption, not a fact.
      const query = page && page > 1 ? `?page=${page}` : "";
      return fetchAndValidate(`/api/recent${query}`, recentTopicsResponseSchema, deps);
    },
    async getTopicDetail(tid: number, slug: string, page?: number): Promise<TopicDetailResponse> {
      const query = page && page > 1 ? `?page=${page}` : "";
      return fetchAndValidate(`/api/topic/${tid}/${encodeURIComponent(slug)}${query}`, topicDetailResponseSchema, deps);
    },
  };
}

export type NodebbClient = ReturnType<typeof createNodebbClient>;
