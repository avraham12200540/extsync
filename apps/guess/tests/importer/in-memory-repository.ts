import type {
  CreateImportRunInput,
  FinishImportRunInput,
  ForumPostRecord,
  ForumRepository,
  ForumUserRecord,
  ImportRunCountersDelta,
  InsertForumPostInput,
  UpsertForumUserInput,
} from "../../src/importer/repository";

/**
 * In-memory fake implementing the exact same ForumRepository interface
 * the real Drizzle-backed repository does - the test seam referenced by
 * the Stage 2 mission. Lets run-import.test.ts exercise real paging,
 * budget, dedup and ImportRun-lifecycle logic with zero database.
 */
export interface ImportRunRecord {
  id: string;
  triggerKind: "admin" | "cron";
  triggeredByAdminId: string | null;
  sourceEndpoint: string;
  status: "running" | "success" | "partial_failure" | "failed";
  cursorUsed: string | null;
  postsFetched: number;
  postsNew: number;
  postsUpdated: number;
  usersTouched: number;
  rateLimitEvents: number;
  errorSummary: string | null;
  finishedAt: Date | null;
}

/**
 * Keeps every InsertForumPostInput field (not just ForumPostRecord's narrow subset) so an in-memory
 * ForumUserStatsRepository fake (see in-memory-stats-repository.ts) can read real
 * wordCount/qualityScore/forumCategoryCid/postedAt directly off this same store. `moderationStatus`
 * is taken from ForumPostRecord (typed as `string`, not the insert-time-only "pending"|"needs_review"
 * union) because a stored row's status can move to "approved"/"rejected" after insert - markSourceDiverged
 * below relies on being able to observe that.
 */
export type StoredForumPost = ForumPostRecord & Omit<InsertForumPostInput, "moderationStatus">;

export interface InMemoryForumRepository extends ForumRepository {
  users: Map<string, ForumUserRecord>; // keyed by forumUid
  posts: Map<string, StoredForumPost>; // keyed by forumPid
  importRuns: Map<string, ImportRunRecord>;
}

let nextId = 1;
function freshId(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

export function createInMemoryForumRepository(): InMemoryForumRepository {
  const users = new Map<string, ForumUserRecord>();
  const posts = new Map<string, StoredForumPost>();
  const importRuns = new Map<string, ImportRunRecord>();

  return {
    users,
    posts,
    importRuns,

    async upsertForumUser(input: UpsertForumUserInput): Promise<ForumUserRecord> {
      const existing = users.get(input.forumUid);
      if (existing) {
        const updated: ForumUserRecord = {
          ...existing,
          forumUsername: input.forumUsername,
          forumUserslug: input.forumUserslug,
        };
        users.set(input.forumUid, updated);
        return updated;
      }
      const created: ForumUserRecord = {
        id: freshId("user"),
        forumUid: input.forumUid,
        forumUsername: input.forumUsername,
        forumUserslug: input.forumUserslug,
      };
      users.set(input.forumUid, created);
      return created;
    },

    async findForumPostByForumPid(forumPid: string): Promise<ForumPostRecord | null> {
      const found = posts.get(forumPid);
      return found ? { ...found } : null;
    },

    async insertForumPost(input: InsertForumPostInput): Promise<ForumPostRecord> {
      if (posts.has(input.forumPid)) {
        throw new Error(`insertForumPost called for an already-known forum_pid ${input.forumPid} - caller must dedup first`);
      }
      const record: StoredForumPost = {
        ...input,
        id: freshId("post"),
        sourceDiverged: false,
      };
      posts.set(input.forumPid, record);
      return { ...record };
    },

    async markSourceDiverged(forumPostId: string, when: Date): Promise<void> {
      for (const [pid, record] of posts) {
        if (record.id === forumPostId) {
          posts.set(pid, {
            ...record,
            sourceDiverged: true,
            moderationStatus: record.moderationStatus === "approved" ? "needs_review" : record.moderationStatus,
          });
          void when;
          return;
        }
      }
    },

    async createImportRun(input: CreateImportRunInput): Promise<{ id: string }> {
      const id = freshId("run");
      importRuns.set(id, {
        id,
        triggerKind: input.triggerKind,
        triggeredByAdminId: input.triggeredByAdminId ?? null,
        sourceEndpoint: input.sourceEndpoint,
        status: "running",
        cursorUsed: null,
        postsFetched: 0,
        postsNew: 0,
        postsUpdated: 0,
        usersTouched: 0,
        rateLimitEvents: 0,
        errorSummary: null,
        finishedAt: null,
      });
      return { id };
    },

    async incrementImportRunCounters(importRunId: string, delta: ImportRunCountersDelta): Promise<void> {
      const run = importRuns.get(importRunId);
      if (!run) throw new Error(`unknown importRunId ${importRunId}`);
      run.postsFetched += delta.postsFetched ?? 0;
      run.postsNew += delta.postsNew ?? 0;
      run.postsUpdated += delta.postsUpdated ?? 0;
      run.usersTouched += delta.usersTouched ?? 0;
      run.rateLimitEvents += delta.rateLimitEvents ?? 0;
    },

    async setImportRunCursor(importRunId: string, cursor: string | null): Promise<void> {
      const run = importRuns.get(importRunId);
      if (!run) throw new Error(`unknown importRunId ${importRunId}`);
      run.cursorUsed = cursor;
    },

    async finishImportRun(importRunId: string, input: FinishImportRunInput): Promise<void> {
      const run = importRuns.get(importRunId);
      if (!run) throw new Error(`unknown importRunId ${importRunId}`);
      run.status = input.status;
      run.errorSummary = input.errorSummary ?? null;
      run.finishedAt = new Date();
    },
  };
}
