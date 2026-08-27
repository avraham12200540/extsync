import { hash, verify } from "@node-rs/argon2";
import { ARGON2_PARAMS } from "./config";

/**
 * Explicit-parameter Argon2id wrapper - every call site goes through this
 * module rather than calling @node-rs/argon2 directly, so the algorithm
 * and cost parameters are guaranteed identical everywhere (login
 * verification, the create-admin script) and can never silently drift
 * from the library's own defaults if those defaults ever change.
 *
 * `algorithm: 2` is Argon2id (see @node-rs/argon2's Algorithm const enum) -
 * a literal, not the enum member, because this project's isolatedModules
 * TypeScript setting forbids referencing ambient const enum members across
 * module boundaries. The existing scripts/create-admin.ts already used
 * this same literal-with-comment convention.
 */
const ARGON2_OPTIONS = {
  algorithm: 2 /* Argon2id */,
  memoryCost: ARGON2_PARAMS.memoryCostKib,
  timeCost: ARGON2_PARAMS.timeCost,
  parallelism: ARGON2_PARAMS.parallelism,
};

export async function hashAdminPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyAdminPassword(storedHash: string, password: string): Promise<boolean> {
  return verify(storedHash, password, ARGON2_OPTIONS);
}

let cachedDummyHash: Promise<string> | null = null;

/**
 * A real Argon2id hash of a fixed, never-issued password - computed once
 * per process and cached. Exists only so a login attempt against an
 * unknown email can still perform a genuine Argon2id verify of comparable
 * cost, rather than returning near-instantly - the timing gap between "no
 * such row" and "row found, hash mismatch" is exactly the kind of oracle
 * that turns a login form into an account-enumeration tool.
 */
function getDummyHash(): Promise<string> {
  if (!cachedDummyHash) {
    cachedDummyHash = hashAdminPassword("timing-defense-dummy-password-never-a-real-credential");
  }
  return cachedDummyHash;
}

/** Performs a real Argon2id verify against the dummy hash and discards the (meaningless) result - callers use this purely for timing parity when no real account row exists. */
export async function verifyAgainstDummyHash(password: string): Promise<void> {
  const dummy = await getDummyHash();
  await verify(dummy, password, ARGON2_OPTIONS);
}
