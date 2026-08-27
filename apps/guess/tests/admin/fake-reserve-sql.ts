import type { GuessSql } from "../../src/db/client";

/**
 * A minimal fake of postgres-js's `Sql`/`ReservedSql` surface - only the
 * two things src/admin/drizzle-import-lock.ts actually uses: calling a
 * reserved connection as a tagged template, and its synchronous
 * `.release()`. The real `ReservedSql<{}>` type has ~20 unrelated methods
 * (subscribe/listen/largeObject/begin/...) that are meaningless to fake
 * meaningfully; this fake is cast to `GuessSql` at the single boundary
 * where it stands in for the real client, exactly the same pattern this
 * codebase already uses for `Pick<NodebbClient, ...>` fakes elsewhere -
 * the difference is only that postgres-js's own dependency surface here
 * (`reserve()`) is declared on a large interface we don't own, so the
 * narrowing has to happen via a documented cast instead of a `Pick`.
 *
 * Models real PostgreSQL advisory-lock semantics faithfully enough for
 * this adapter's contract: the lock is held by AT MOST one connection
 * at a time (global state, not per-connection), `pg_try_advisory_lock`
 * never blocks (matches the non-blocking TRY variant this code uses),
 * and `pg_advisory_unlock` only succeeds when called from the SAME
 * connection that holds the lock - exactly the bug this correction
 * fixes ever letting happen.
 */

export interface FakeQueryCall {
  connectionId: number;
  kind: "lock" | "unlock" | "other";
}

export interface FakeReserveSqlOptions {
  /** rawSql.reserve() itself rejects - simulates pool exhaustion/connection failure, distinct from "lock unavailable". */
  reserveFails?: boolean;
  /** The pg_advisory_unlock query throws once acquired and running - simulates a network blip on cleanup. */
  unlockFails?: boolean;
}

export interface FakeReserveSql {
  rawSql: Pick<GuessSql, "reserve">;
  calls: FakeQueryCall[];
  releasedConnectionIds: number[];
  isLockHeld(): boolean;
}

export function createFakeReserveSql(options: FakeReserveSqlOptions = {}): FakeReserveSql {
  let nextConnectionId = 1;
  let lockHolder: number | null = null;
  const calls: FakeQueryCall[] = [];
  const releasedConnectionIds: number[] = [];

  function classify(strings: TemplateStringsArray): FakeQueryCall["kind"] {
    const text = strings.join("?");
    if (text.includes("pg_try_advisory_lock")) return "lock";
    if (text.includes("pg_advisory_unlock")) return "unlock";
    return "other";
  }

  const rawSql: Pick<GuessSql, "reserve"> = {
    async reserve() {
      if (options.reserveFails) {
        throw new Error("simulated reserve failure - pool exhausted");
      }

      const connectionId = nextConnectionId++;
      let released = false;

      const tag = async (strings: TemplateStringsArray, ..._values: unknown[]) => {
        if (released) throw new Error(`query issued on connection ${connectionId} after release()`);
        const kind = classify(strings);
        calls.push({ connectionId, kind });

        if (kind === "lock") {
          if (lockHolder === null) {
            lockHolder = connectionId;
            return [{ acquired: true }];
          }
          return [{ acquired: false }];
        }

        if (kind === "unlock") {
          if (options.unlockFails) {
            throw new Error("simulated pg_advisory_unlock failure");
          }
          if (lockHolder === connectionId) {
            lockHolder = null;
            return [{ pg_advisory_unlock: true }];
          }
          return [{ pg_advisory_unlock: false }];
        }

        throw new Error(`fake-reserve-sql: unexpected query kind on connection ${connectionId}`);
      };
      (tag as unknown as { release: () => void }).release = () => {
        released = true;
        releasedConnectionIds.push(connectionId);
      };

      return tag as unknown as Awaited<ReturnType<GuessSql["reserve"]>>;
    },
  };

  return {
    rawSql,
    calls,
    releasedConnectionIds,
    isLockHeld: () => lockHolder !== null,
  };
}
