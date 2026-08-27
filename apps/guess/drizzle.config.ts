import type { Config } from "drizzle-kit";

// Only used by `drizzle-kit generate`/`check` to read the TS schema and
// emit SQL migration files. `dbCredentials` is a placeholder - Stage 1
// never runs `drizzle-kit migrate`/`push` against a real database, so no
// real connection string is required here.
export default {
  schema: "./src/db/schema/index.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.GUESS_DATABASE_URL ?? "postgres://placeholder:placeholder@localhost:5432/placeholder",
  },
} satisfies Config;
