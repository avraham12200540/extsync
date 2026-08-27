import assert from "node:assert/strict";
import { test } from "node:test";
import { ModerationConflictError, ModerationPostNotFoundError, createInMemoryModerationRepository } from "../../src/admin/moderation-repository";
import type { SeedModerationPost } from "../../src/admin/moderation-repository";

const NOW = new Date("2026-01-01T12:00:00Z");
let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${(idCounter += 1)}`;

function seedPost(overrides: Partial<SeedModerationPost> = {}): SeedModerationPost {
  return {
    id: "post-1",
    forumPid: "12345",
    forumTid: "999",
    forumCategoryCid: "3",
    forumUserId: "user-1",
    forumUsername: "synthetic_user",
    rawContent: "<p>raw html content never shown to gameplay</p>",
    cleanContent: "clean plain text",
    moderationStatus: "pending",
    moderationVersion: 0,
    qualityScore: 0.8,
    potentialLeakScore: 0,
    moderationFlags: [],
    wordCount: 10,
    contentLength: 40,
    quoteRatio: 0,
    genericResponseScore: 0,
    linksCount: 0,
    mentionsCount: 0,
    sourceDiverged: false,
    sourceDivergedAt: null,
    postedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test("approvePost with the correct expectedVersion succeeds and bumps the version", async () => {
  const repo = createInMemoryModerationRepository({ generateId: () => nextId("id") }, [seedPost()]);
  const result = await repo.approvePost("post-1", 0, NOW);
  assert.equal(result.moderationStatus, "approved");
  assert.equal(result.moderationVersion, 1);
});

test("approvePost with a stale expectedVersion throws ModerationConflictError and does not change status", async () => {
  const repo = createInMemoryModerationRepository({ generateId: () => nextId("id") }, [seedPost()]);
  await repo.approvePost("post-1", 0, NOW); // version is now 1
  await assert.rejects(repo.approvePost("post-1", 0, NOW), ModerationConflictError);
  const detail = await repo.getPostDetail("post-1");
  assert.equal(detail?.moderationStatus, "approved");
  assert.equal(detail?.moderationVersion, 1);
});

test("approvePost on an unknown id throws ModerationPostNotFoundError", async () => {
  const repo = createInMemoryModerationRepository({ generateId: () => nextId("id") }, []);
  await assert.rejects(repo.approvePost("does-not-exist", 0, NOW), ModerationPostNotFoundError);
});

test("rejectPost with the correct version succeeds", async () => {
  const repo = createInMemoryModerationRepository({ generateId: () => nextId("id") }, [seedPost()]);
  const result = await repo.rejectPost("post-1", 0, NOW);
  assert.equal(result.moderationStatus, "rejected");
});

test("editCleanContent creates a ForumPostRevision capturing the PREVIOUS clean_content, and never touches raw_content", async () => {
  const repo = createInMemoryModerationRepository({ generateId: () => nextId("id") }, [seedPost({ cleanContent: "original text" })]);
  const result = await repo.editCleanContent("post-1", "edited text", 0, "admin-1", NOW);

  assert.equal(result.cleanContent, "edited text");
  assert.equal(result.rawContent, "<p>raw html content never shown to gameplay</p>", "raw_content must be untouched by an edit");
  assert.equal(result.moderationVersion, 1);

  assert.equal(repo.revisions.length, 1);
  assert.equal(repo.revisions[0]?.previousCleanContent, "original text");
  assert.equal(repo.revisions[0]?.editedByAdminId, "admin-1");
});

test("editCleanContent with a stale version throws ModerationConflictError and creates no revision", async () => {
  const repo = createInMemoryModerationRepository({ generateId: () => nextId("id") }, [seedPost()]);
  await repo.editCleanContent("post-1", "first edit", 0, "admin-1", NOW);
  await assert.rejects(repo.editCleanContent("post-1", "second edit", 0, "admin-1", NOW), ModerationConflictError);
  assert.equal(repo.revisions.length, 1, "the conflicting edit must not have created a second revision");
});

test("getPostDetail exposes rawContent and a reconstructed sourceUrl; listQueue items never carry rawContent", async () => {
  const repo = createInMemoryModerationRepository({ generateId: () => nextId("id") }, [seedPost()]);
  const detail = await repo.getPostDetail("post-1");
  assert.equal(detail?.rawContent, "<p>raw html content never shown to gameplay</p>");
  assert.equal(detail?.sourceUrl, "https://mitmachim.top/post/12345");

  const queue = await repo.listQueue({ sortField: "postedAt", sortDirection: "desc", page: 1, pageSize: 25 });
  assert.equal(Object.prototype.hasOwnProperty.call(queue.items[0], "rawContent"), false);
});

test("listQueue filters by status and paginates", async () => {
  const repo = createInMemoryModerationRepository(
    { generateId: () => nextId("id") },
    [
      seedPost({ id: "p1", forumPid: "1", moderationStatus: "pending" }),
      seedPost({ id: "p2", forumPid: "2", moderationStatus: "approved" }),
      seedPost({ id: "p3", forumPid: "3", moderationStatus: "pending" }),
    ],
  );
  const pending = await repo.listQueue({ status: "pending", sortField: "postedAt", sortDirection: "desc", page: 1, pageSize: 25 });
  assert.equal(pending.totalCount, 2);
  assert.ok(pending.items.every((i) => i.moderationStatus === "pending"));

  const page1 = await repo.listQueue({ sortField: "postedAt", sortDirection: "desc", page: 1, pageSize: 2 });
  assert.equal(page1.items.length, 2);
  assert.equal(page1.totalCount, 3);
});
