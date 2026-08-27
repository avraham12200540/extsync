import type { AdminAuditRepository } from "../admin/audit";
import type { AdminForumUserRepository } from "../admin/forum-user-repository";
import type { AdminImportRunRepository } from "../admin/import-run-repository";
import type { ImportLock } from "../admin/import-lock";
import type { AdminUserRepository } from "../admin/admin-user-repository";
import type { ModerationRepository } from "../admin/moderation-repository";
import type { CuratedPoolRepository } from "../game/curated-pool-repository";
import type { ForumContentLookup, GameUnitOfWork } from "../game/unit-of-work";
import type { NodebbClient } from "../importer/nodebb-client";
import type { ForumRepository } from "../importer/repository";
import type { AdminSessionRepository } from "./admin-session";
import type { IdempotencyRepository } from "./idempotency";
import type { RateLimitRepository, TrustedProxyConfig } from "./rate-limit";
import type { SessionRepository } from "./session";

/**
 * Everything a route handler factory needs, gathered in one place so
 * tests can construct a fully in-memory HttpDeps and exercise real
 * Request/Response handling with zero PostgreSQL. The production
 * factory (wired in src/app/api/**\/route.ts) builds the same shape from
 * real, lazily-constructed Drizzle-backed services - see the app-local
 * README for exactly which pieces remain unverified without a real
 * database.
 */
export interface HttpDeps {
  sessionRepo: SessionRepository;
  gameUow: GameUnitOfWork;
  curatedPool: CuratedPoolRepository;
  contentLookup: ForumContentLookup;
  rateLimitRepo: RateLimitRepository;
  idempotencyRepo: IdempotencyRepository;
  clock: () => Date;
  randomToken: () => string;
  generateId: () => string;
  isProduction: boolean;
  /** Server-only key material for IP-hash rate-limit buckets - injected, never hardcoded. */
  rateLimitPepper: string;
  /** Server-only key material for the daily-challenge seed - injected, never hardcoded, never sent to a client. */
  dailySeedSecret: string;
  trustedProxyConfig: TrustedProxyConfig;
  logSink: (line: string) => void;
}

export type RouteParams = Record<string, string>;
export type RouteHandler = (request: Request, params: RouteParams) => Promise<Response>;

/**
 * Additive-only admin dependencies - never merged into HttpDeps itself, so
 * every existing gameplay handler/test/route.ts is untouched by this
 * stage. AdminHttpDeps (below) is a strict superset of HttpDeps, which
 * TypeScript's structural typing accepts anywhere a plain HttpDeps is
 * expected - see invokeWithDeps in http-utils.ts, made generic for exactly
 * this reason.
 */
export interface AdminDeps {
  adminSessionRepo: AdminSessionRepository;
  adminUserRepo: AdminUserRepository;
  adminAuditRepo: AdminAuditRepository;
  adminForumUserRepo: AdminForumUserRepository;
  moderationRepo: ModerationRepository;
  adminImportRunRepo: AdminImportRunRepository;
  /** The importer's own write-repository (src/importer/repository.ts) - only ever reached via the bounded import-trigger endpoint, never from any gameplay code path. */
  forumRepository: ForumRepository;
  /** Only ever reached via the bounded import-trigger endpoint - see the module doc on importer/nodebb-client.ts for why gameplay code must never import this. */
  nodebbClient: Pick<NodebbClient, "getRecentTopics" | "getTopicDetail">;
  importLock: ImportLock;
  /** The exact scheme+host admin login must match via Origin/Sec-Fetch-Site validation (see origin-check.ts) - e.g. "https://extsync.com". Injected, never guessed from a request header. */
  appOrigin: string;
}

export type AdminHttpDeps = HttpDeps & AdminDeps;
