import crypto from "node:crypto";

/**
 * Client-supplied idempotency keys for mutations where a retry must never
 * repeat an effect. A single mechanism used uniformly by every mutating
 * route, backed by the idempotency_key table (src/db/schema/idempotency.ts).
 *
 * Contract: the SAME (key, endpoint) with the SAME request payload always
 * replays the original response, never re-running the mutation. The SAME
 * (key, endpoint) with a DIFFERENT payload is a conflict (409) - a client
 * reusing a key for a different request is a bug, not a retry, and must
 * be told so rather than silently served a mismatched cached response.
 */

export function computeRequestHash(payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload ?? null), "utf8").digest("hex");
}

export interface IdempotencyRecord {
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
}

export interface IdempotencyRepository {
  /** Atomically creates a pending record if (key, endpoint) is unseen; otherwise returns the existing one (pending or completed) without modifying it. */
  reserveOrGet(
    key: string,
    endpoint: string,
    requestHash: string,
    now: Date,
    expiresAt: Date,
  ): Promise<{ created: boolean; record: IdempotencyRecord }>;
  completeResponse(key: string, endpoint: string, status: number, body: unknown): Promise<void>;
}

export function createInMemoryIdempotencyRepository(): IdempotencyRepository & { records: Map<string, IdempotencyRecord> } {
  const records = new Map<string, IdempotencyRecord>();
  return {
    records,
    async reserveOrGet(key, endpoint, requestHash, _now, _expiresAt) {
      const mapKey = `${key}:${endpoint}`;
      const existing = records.get(mapKey);
      if (existing) return { created: false, record: existing };
      const record: IdempotencyRecord = { requestHash, responseStatus: null, responseBody: null };
      records.set(mapKey, record);
      return { created: true, record };
    },
    async completeResponse(key, endpoint, status, body) {
      const record = records.get(`${key}:${endpoint}`);
      if (record) {
        record.responseStatus = status;
        record.responseBody = body;
      }
    },
  };
}

export class IdempotencyConflictError extends Error {}
export class IdempotencyInFlightError extends Error {}

export interface IdempotencyOutcome<T> {
  status: number;
  body: T | unknown;
  replayed: boolean;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Runs `run()` at most once per (key, endpoint, payload). A second call
 * with the same key+endpoint+payload replays the first call's result
 * without invoking `run()` again. A second call with the same key+endpoint
 * but a different payload throws IdempotencyConflictError. A second call
 * that arrives while the first is still in flight (no PostgreSQL to
 * serialize against in this environment - the in-memory fake reproduces
 * this race honestly rather than hiding it) throws IdempotencyInFlightError,
 * so a client must retry rather than risk a double effect.
 */
export async function withIdempotency<T>(
  repo: IdempotencyRepository,
  key: string,
  endpoint: string,
  requestPayload: unknown,
  now: Date,
  run: () => Promise<{ status: number; body: T }>,
): Promise<IdempotencyOutcome<T>> {
  const requestHash = computeRequestHash(requestPayload);
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);
  const { created, record } = await repo.reserveOrGet(key, endpoint, requestHash, now, expiresAt);

  if (!created) {
    if (record.requestHash !== requestHash) {
      throw new IdempotencyConflictError(`idempotency key already used with a different request payload`);
    }
    if (record.responseStatus !== null) {
      return { status: record.responseStatus, body: record.responseBody, replayed: true };
    }
    throw new IdempotencyInFlightError(`idempotency key is already being processed`);
  }

  const result = await run();
  await repo.completeResponse(key, endpoint, result.status, result.body);
  return { status: result.status, body: result.body, replayed: false };
}
