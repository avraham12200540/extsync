import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type GuessDb = ReturnType<typeof drizzle<typeof schema>>;
/** The raw postgres-js client Drizzle wraps - exposed so code that needs a feature Drizzle's query builder doesn't cover (e.g. `sql.reserve()` for pinning one physical connection - see src/admin/drizzle-import-lock.ts) can share the exact same connection pool rather than opening a second one. */
export type GuessSql = ReturnType<typeof postgres>;

let cachedSql: GuessSql | undefined;
let cachedDb: GuessDb | undefined;

/**
 * Lazily creates (and caches) the raw postgres-js client. `GUESS_DATABASE_URL`
 * is only read and validated the first time this is called, not at module
 * import time - so `next build`, `tsc --noEmit`, and pure schema tests can
 * run with no database and no real secret present. Never log the URL
 * itself (it carries credentials); only its presence/absence.
 */
export function getRawSql(): GuessSql {
  if (cachedSql) return cachedSql;

  const connectionString = process.env.GUESS_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "GUESS_DATABASE_URL is not set. It is required to open a database connection, " +
        "but is intentionally not required for build/typecheck/schema tests.",
    );
  }

  cachedSql = postgres(connectionString, { max: 10 });
  return cachedSql;
}

/** Lazily creates (and caches) the Drizzle client, built on the same shared raw client getRawSql() caches. */
export function getDb(): GuessDb {
  if (cachedDb) return cachedDb;
  cachedDb = drizzle(getRawSql(), { schema });
  return cachedDb;
}
