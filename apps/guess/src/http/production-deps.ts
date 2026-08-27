import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { forumPost, forumUser } from "../db/schema";
import { createDrizzleCuratedPoolRepository } from "../game/drizzle-curated-pool-repository";
import { createDrizzleGameUnitOfWork } from "../game/drizzle-unit-of-work";
import type { ForumContentLookup } from "../game/unit-of-work";
import type { HttpDeps } from "./deps";
import { createDrizzleIdempotencyRepository } from "./drizzle-idempotency-repository";
import { createDrizzleRateLimitRepository } from "./drizzle-rate-limit-repository";
import { createDrizzleSessionRepository } from "./drizzle-session-repository";
import { DEFAULT_TRUSTED_PROXY_CONFIG } from "./rate-limit";
import { generateRawToken } from "./session";

let cachedDeps: HttpDeps | undefined;

function createContentLookup(): ForumContentLookup {
  return {
    async getCleanContent(forumPostId: string) {
      const db = getDb();
      const [row] = await db.select({ cleanContent: forumPost.cleanContent }).from(forumPost).where(eq(forumPost.id, forumPostId));
      return row?.cleanContent ?? "";
    },
    async getUsername(forumUserId: string) {
      const db = getDb();
      const [row] = await db.select({ forumUsername: forumUser.forumUsername }).from(forumUser).where(eq(forumUser.id, forumUserId));
      return row?.forumUsername ?? "";
    },
  };
}

/**
 * Lazily builds the real, Postgres-backed HttpDeps - env vars and the
 * database connection are only touched the first time a request actually
 * needs them (mirrors db/client.ts's getDb() laziness), so `next build`
 * and `tsc` never require GUESS_DATABASE_URL or any secret to succeed.
 * Cached after first build, matching getDb()'s singleton pattern.
 */
export function getProductionHttpDeps(): HttpDeps {
  if (cachedDeps) return cachedDeps;

  const rateLimitPepper = process.env.GUESS_RATE_LIMIT_PEPPER;
  const dailySeedSecret = process.env.GUESS_DAILY_SEED_SECRET;
  if (!rateLimitPepper || !dailySeedSecret) {
    throw new Error(
      "GUESS_RATE_LIMIT_PEPPER and GUESS_DAILY_SEED_SECRET must be set in the environment to serve real traffic " +
        "(intentionally not required for build/typecheck/tests).",
    );
  }

  const trustedHopCountRaw = process.env.GUESS_TRUSTED_PROXY_HOP_COUNT;
  const trustedHopCount = trustedHopCountRaw !== undefined ? Number(trustedHopCountRaw) : DEFAULT_TRUSTED_PROXY_CONFIG.trustedHopCount;

  const db = getDb();
  cachedDeps = {
    sessionRepo: createDrizzleSessionRepository(db),
    gameUow: createDrizzleGameUnitOfWork(db),
    curatedPool: createDrizzleCuratedPoolRepository(db),
    contentLookup: createContentLookup(),
    rateLimitRepo: createDrizzleRateLimitRepository(db),
    idempotencyRepo: createDrizzleIdempotencyRepository(db),
    clock: () => new Date(),
    randomToken: generateRawToken,
    generateId: () => crypto.randomUUID(),
    isProduction: process.env.NODE_ENV === "production",
    rateLimitPepper,
    dailySeedSecret,
    trustedProxyConfig: { trustedHopCount },
    // Never log the raw line anywhere but stdout - the Logger built on
    // top of this sink already redacts every sensitive field before this
    // is ever called (see logger.ts).
    logSink: (line: string) => {
      console.log(line);
    },
  };
  return cachedDeps;
}
