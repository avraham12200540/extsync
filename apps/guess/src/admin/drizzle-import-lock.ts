import type { GuessSql } from "../db/client";
import type { Logger } from "../http/logger";
import type { ImportLock, ImportLockOutcome } from "./import-lock";

/**
 * Real transaction-safe overlap guard using a PostgreSQL session-level
 * advisory lock (pg_try_advisory_lock/pg_advisory_unlock) keyed by a
 * fixed, hardcoded bigint - genuinely atomic at the database level, unlike
 * a read-then-write "is anything running" check (see
 * AdminImportRunRepository.hasRunningImport, which is an observability
 * signal only, not this guarantee).
 *
 * Connection pinning: session-level advisory locks are tied to the
 * underlying Postgres connection/session, not the logical request - a
 * lock acquired on one pooled connection is invisible (and cannot be
 * released) from another. This implementation uses `rawSql.reserve()` to
 * pull ONE physical connection out of the shared pool and holds it for
 * the entire acquire -> run(callback) -> unlock -> release lifecycle, so
 * both `pg_try_advisory_lock` and `pg_advisory_unlock` always run on the
 * exact same session. `pg_try_advisory_lock` (not the blocking
 * `pg_advisory_lock`) is non-blocking by design - this can never leave a
 * caller waiting indefinitely for the lock itself; only the initial
 * `reserve()` connection checkout could theoretically wait if the pool
 * (max 10) were fully exhausted, which is a distinct, expected form of
 * backpressure, not a lock-specific hang.
 *
 * This is a session-level advisory lock, not a database transaction -
 * nothing here holds a transaction open, so the importer's outbound
 * pacing/network waits never block a transaction from committing or hold
 * row/table locks.
 *
 * UNVERIFIED: there is no PostgreSQL available in this environment, so
 * this has never run against a real database. Its correctness at the
 * *code* level rests on: (a) `reserve()` genuinely pinning one physical
 * connection for every query issued through the returned handle (proven
 * against a fake reserve-capable client in
 * tests/admin/drizzle-import-lock.test.ts, which asserts both SQL calls
 * used the identical connection identity), and (b)
 * pg_try_advisory_lock/pg_advisory_unlock being exactly the
 * well-documented PostgreSQL primitives they are. What remains genuinely
 * unverified until a real database exists: that real PostgreSQL's
 * advisory-lock semantics behave as documented under real concurrent
 * load, and that a process crash mid-hold releases the lock when its
 * connection closes (both are documented PostgreSQL behavior, not
 * assumptions specific to this code, but neither has been executed here).
 */
// Arbitrary fixed key, hardcoded in code (never caller/request input), unique to this
// app's import-run lock. A plain `number`, not a `bigint` literal: postgres-js's
// TypeScript definitions do not include `bigint` in their serializable-parameter
// union (a gap between its type declarations and its actual runtime support - see
// types.js's inferType), and this value is comfortably within Number.MAX_SAFE_INTEGER,
// so a plain number loses no precision. PostgreSQL resolves the untyped numeric
// parameter against pg_try_advisory_lock/pg_advisory_unlock's `bigint` parameter via
// its normal implicit numeric-literal coercion - standard behavior for any client
// library, not something specific to this code.
const IMPORT_LOCK_KEY = 847_362_910_142;

export function createDrizzleImportLock(rawSql: Pick<GuessSql, "reserve">, logger?: Pick<Logger, "warn">): ImportLock {
  return {
    async withLock<T>(run: () => Promise<T>): Promise<ImportLockOutcome<T>> {
      // Not wrapped in the lifecycle try/finally below: if reserving a
      // connection itself fails, there is nothing to unlock or release -
      // the failure propagates directly as a distinct infrastructure
      // error, never mistaken for "someone else holds the lock."
      const reserved = await rawSql.reserve();

      try {
        const lockRows = await reserved`select pg_try_advisory_lock(${IMPORT_LOCK_KEY}) as acquired`;
        const acquired = lockRows[0]?.acquired === true;
        if (!acquired) {
          return { acquired: false };
        }

        let runError: unknown;
        let result: T | undefined;
        let ranSuccessfully = false;
        try {
          result = await run();
          ranSuccessfully = true;
        } catch (err) {
          runError = err;
        }

        // Attempt unlock exactly once, on this same reserved connection,
        // regardless of whether `run` succeeded or threw. A cleanup
        // failure here is logged (safely - no tokens/content, just an
        // error type/name) and NEVER allowed to replace or mask the
        // original `run` error, which always wins if both failed.
        try {
          await reserved`select pg_advisory_unlock(${IMPORT_LOCK_KEY})`;
        } catch (unlockErr) {
          logger?.warn("import_lock.unlock_failed", {
            errorType: unlockErr instanceof Error ? unlockErr.constructor.name : "unknown",
          });
        }

        if (!ranSuccessfully) throw runError;
        return { acquired: true, result: result as T };
      } finally {
        // Always release the reserved connection back to the pool -
        // whether the lock was never acquired, `run` threw, or unlock
        // itself threw. `release()` is synchronous and does not itself
        // throw in normal postgres-js operation, but this is the last
        // line of defense for the connection resource regardless.
        reserved.release();
      }
    },
  };
}
