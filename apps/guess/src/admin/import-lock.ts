/**
 * Prevents two triggered import runs from overlapping. The interface is
 * deliberately callback-shaped (`withLock`), not a separate acquire()/
 * release() pair - a caller cannot forget to release, and cannot run
 * anything "between" acquire and release on a different underlying
 * resource, because the implementation owns the whole lifecycle. See
 * drizzle-import-lock.ts for why that distinction matters for a real
 * PostgreSQL session-level advisory lock.
 */

export type ImportLockOutcome<T> = { acquired: false } | { acquired: true; result: T };

export interface ImportLock {
  /**
   * If the lock is already held elsewhere, resolves immediately to
   * `{acquired:false}` WITHOUT calling `run` - this can never hang
   * waiting for the lock (a "try" acquisition, never a blocking one).
   * Otherwise calls `run` exactly once. If `run` throws, that error
   * propagates from `withLock` (after best-effort unlock/cleanup, which
   * is never allowed to replace or swallow it) - `withLock` never returns
   * an outcome object for a failed `run`. If `run` succeeds, resolves to
   * `{acquired:true, result}`.
   */
  withLock<T>(run: () => Promise<T>): Promise<ImportLockOutcome<T>>;
}

/** In-memory mutex for tests - a single boolean flag, since tests never run truly concurrent Node processes against it. */
export function createInMemoryImportLock(): ImportLock & { locked: boolean } {
  let locked = false;
  return {
    get locked() {
      return locked;
    },
    async withLock(run) {
      if (locked) return { acquired: false };
      locked = true;
      try {
        const result = await run();
        return { acquired: true, result };
      } finally {
        locked = false;
      }
    },
  };
}
