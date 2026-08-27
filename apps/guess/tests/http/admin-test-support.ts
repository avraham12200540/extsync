import { createInMemoryAdminAuditRepository } from "../../src/admin/audit";
import { createInMemoryAdminUserRepository } from "../../src/admin/admin-user-repository";
import type { AdminUserRecord } from "../../src/admin/admin-user-repository";
import { createInMemoryAdminForumUserRepository } from "../../src/admin/forum-user-repository";
import type { SeedForumUser } from "../../src/admin/forum-user-repository";
import { createInMemoryImportLock } from "../../src/admin/import-lock";
import { createInMemoryAdminImportRunRepository } from "../../src/admin/import-run-repository";
import { createInMemoryModerationRepository } from "../../src/admin/moderation-repository";
import type { SeedModerationPost } from "../../src/admin/moderation-repository";
import { createInMemoryAdminSessionRepository } from "../../src/http/admin-session";
import type { AdminHttpDeps } from "../../src/http/deps";
import type { NodebbClient } from "../../src/importer/nodebb-client";
import { createInMemoryForumRepository } from "../importer/in-memory-repository";
import { createTestDeps } from "./test-support";
import type { TestDepsOptions } from "./test-support";

/** A fake NodeBB client that returns an immediately-empty recent-topics page - the admin import-trigger tests only need to observe lock/audit/budget behavior, not re-exercise the importer's own pagination logic (already covered by tests/importer/run-import.test.ts). */
export function emptyNodebbClient(): Pick<NodebbClient, "getRecentTopics" | "getTopicDetail"> {
  return {
    async getRecentTopics() {
      return { nextStart: 0, topicCount: 0, topics: [] };
    },
    async getTopicDetail() {
      throw new Error("emptyNodebbClient: getTopicDetail should never be called - getRecentTopics always returns zero topics");
    },
  };
}

/** A fake NodeBB client whose getRecentTopics call blocks until `gate` resolves - used to hold an import "in flight" so a concurrent trigger can be attempted against it. */
export function gatedNodebbClient(gate: Promise<void>): Pick<NodebbClient, "getRecentTopics" | "getTopicDetail"> {
  return {
    async getRecentTopics() {
      await gate;
      return { nextStart: 0, topicCount: 0, topics: [] };
    },
    async getTopicDetail() {
      throw new Error("gatedNodebbClient: getTopicDetail should never be called");
    },
  };
}

export interface AdminTestDepsOptions extends TestDepsOptions {
  adminUsers?: AdminUserRecord[];
  forumUsers?: SeedForumUser[];
  moderationPosts?: SeedModerationPost[];
  appOrigin?: string;
}

export interface AdminTestDepsBundle {
  deps: AdminHttpDeps;
  logLines: string[];
  advanceClock: (ms: number) => void;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function createAdminTestDeps(opts: AdminTestDepsOptions = {}): AdminTestDepsBundle {
  const base = createTestDeps(opts);

  const adminSessionRepo = createInMemoryAdminSessionRepository({
    generateId: () => nextId("admin-sess"),
    isAdminActive: (adminUserId) => adminUserRepo.users.get(adminUserId)?.isActive ?? false,
  });
  const adminUserRepo = createInMemoryAdminUserRepository(opts.adminUsers ?? []);

  const deps: AdminHttpDeps = {
    ...base.deps,
    adminSessionRepo,
    adminUserRepo,
    adminAuditRepo: createInMemoryAdminAuditRepository({ generateId: () => nextId("audit") }),
    adminForumUserRepo: createInMemoryAdminForumUserRepository(opts.forumUsers ?? []),
    moderationRepo: createInMemoryModerationRepository({ generateId: () => nextId("rev") }, opts.moderationPosts ?? []),
    adminImportRunRepo: createInMemoryAdminImportRunRepository([]),
    forumRepository: createInMemoryForumRepository(),
    nodebbClient: emptyNodebbClient(),
    importLock: createInMemoryImportLock(),
    appOrigin: opts.appOrigin ?? "https://example.invalid",
  };

  return { deps, logLines: base.logLines, advanceClock: base.advanceClock };
}

/** Builds a seed AdminUserRecord with a real Argon2id hash for `password` - callers use this to seed a login-testable account rather than hand-crafting an unusable hash string. */
export async function seedAdminUser(overrides: Partial<Omit<AdminUserRecord, "passwordHash">> & { password: string }): Promise<AdminUserRecord> {
  const { hashAdminPassword } = await import("../../src/admin/password");
  const passwordHash = await hashAdminPassword(overrides.password);
  return {
    id: overrides.id ?? nextId("admin-user"),
    email: overrides.email ?? "admin@example.invalid",
    passwordHash,
    isActive: overrides.isActive ?? true,
    failedLoginCount: overrides.failedLoginCount ?? 0,
    lockedUntil: overrides.lockedUntil ?? null,
    lastLoginAt: overrides.lastLoginAt ?? null,
  };
}
