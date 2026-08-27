import assert from "node:assert/strict";
import { test } from "node:test";
import { createInMemoryAdminAuditRepository } from "../../src/admin/audit";
import { createInMemoryImportLock } from "../../src/admin/import-lock";
import { ImportAlreadyRunningError, triggerImportRun } from "../../src/admin/import-service";
import { createInMemoryForumRepository } from "../importer/in-memory-repository";
import type { NodebbClient } from "../../src/importer/nodebb-client";

const NOW = new Date("2026-01-01T12:00:00Z");
let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${(idCounter += 1)}`;

function emptyClient(): Pick<NodebbClient, "getRecentTopics" | "getTopicDetail"> {
  return {
    async getRecentTopics() {
      return { nextStart: 0, topicCount: 0, topics: [] };
    },
    async getTopicDetail() {
      throw new Error("not used");
    },
  };
}

function gatedClient(gate: Promise<void>): Pick<NodebbClient, "getRecentTopics" | "getTopicDetail"> {
  return {
    async getRecentTopics() {
      await gate;
      return { nextStart: 0, topicCount: 0, topics: [] };
    },
    async getTopicDetail() {
      throw new Error("not used");
    },
  };
}

test("a normal trigger runs to completion, releases the lock, and records an audit event", async () => {
  const auditRepo = createInMemoryAdminAuditRepository({ generateId: () => nextId("id") });
  const importLock = createInMemoryImportLock();
  const summary = await triggerImportRun(
    { forumRepository: createInMemoryForumRepository(), nodebbClient: emptyClient(), auditRepo, importLock },
    { adminUserId: "admin-1", now: NOW, requestCorrelationId: "req-1" },
  );
  assert.equal(summary.status, "success");
  assert.equal(importLock.locked, false, "lock must be released after completion");
  const audited = auditRepo.events.at(-1);
  assert.equal(audited?.action, "import.trigger");
  assert.equal(audited?.actorAdminId, "admin-1");
  assert.equal(audited?.targetId, summary.importRunId);
});

test("a second trigger while one is in flight throws ImportAlreadyRunningError and does not start a second run", async () => {
  const auditRepo = createInMemoryAdminAuditRepository({ generateId: () => nextId("id") });
  const importLock = createInMemoryImportLock();
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  const firstRunPromise = triggerImportRun(
    { forumRepository: createInMemoryForumRepository(), nodebbClient: gatedClient(gate), auditRepo, importLock },
    { adminUserId: "admin-1", now: NOW, requestCorrelationId: "req-1" },
  );

  // Give the first call's microtasks a chance to acquire the lock before the second call starts.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(importLock.locked, true, "lock should be held while the first run is in flight");

  await assert.rejects(
    triggerImportRun(
      { forumRepository: createInMemoryForumRepository(), nodebbClient: emptyClient(), auditRepo, importLock },
      { adminUserId: "admin-2", now: NOW, requestCorrelationId: "req-2" },
    ),
    ImportAlreadyRunningError,
  );

  releaseGate();
  const firstSummary = await firstRunPromise;
  assert.equal(firstSummary.status, "success");
  assert.equal(importLock.locked, false, "lock must be released once the first run finishes");

  // Only ONE audit event was recorded (the second trigger never ran the importer at all).
  assert.equal(auditRepo.events.filter((e) => e.action === "import.trigger").length, 1);
});
