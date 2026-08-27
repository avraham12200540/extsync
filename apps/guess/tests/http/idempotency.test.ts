import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IdempotencyConflictError,
  IdempotencyInFlightError,
  computeRequestHash,
  createInMemoryIdempotencyRepository,
  withIdempotency,
} from "../../src/http/idempotency";

const NOW = new Date("2026-01-01T00:00:00Z");

test("computeRequestHash is deterministic and payload-sensitive", () => {
  assert.equal(computeRequestHash({ a: 1 }), computeRequestHash({ a: 1 }));
  assert.notEqual(computeRequestHash({ a: 1 }), computeRequestHash({ a: 2 }));
});

test("a new key runs the mutation exactly once", async () => {
  const repo = createInMemoryIdempotencyRepository();
  let runs = 0;
  const result = await withIdempotency(repo, "key-1", "games.freeplay", { x: 1 }, NOW, async () => {
    runs += 1;
    return { status: 201, body: { gameId: "g-1" } };
  });
  assert.equal(runs, 1);
  assert.equal(result.replayed, false);
  assert.equal(result.status, 201);
});

test("a duplicate retry with the identical payload replays the original response without re-running the mutation", async () => {
  const repo = createInMemoryIdempotencyRepository();
  let runs = 0;
  const run = () => {
    runs += 1;
    return Promise.resolve({ status: 201, body: { gameId: "g-1", createdAtRunNumber: runs } });
  };

  const first = await withIdempotency(repo, "key-1", "games.freeplay", { x: 1 }, NOW, run);
  const second = await withIdempotency(repo, "key-1", "games.freeplay", { x: 1 }, NOW, run);

  assert.equal(runs, 1, "the mutation must not run a second time");
  assert.equal(second.replayed, true);
  assert.deepEqual(second.body, first.body);
});

test("a duplicate key with a DIFFERENT payload is rejected as a conflict, not replayed", async () => {
  const repo = createInMemoryIdempotencyRepository();
  await withIdempotency(repo, "key-1", "games.freeplay", { x: 1 }, NOW, async () => ({ status: 201, body: { ok: true } }));

  await assert.rejects(
    () => withIdempotency(repo, "key-1", "games.freeplay", { x: 2 }, NOW, async () => ({ status: 201, body: { ok: true } })),
    IdempotencyConflictError,
  );
});

test("the same key is independent across different endpoints", async () => {
  const repo = createInMemoryIdempotencyRepository();
  let runsA = 0;
  let runsB = 0;
  await withIdempotency(repo, "shared-key", "games.freeplay", { x: 1 }, NOW, async () => {
    runsA += 1;
    return { status: 201, body: { a: true } };
  });
  await withIdempotency(repo, "shared-key", "games.daily", { x: 1 }, NOW, async () => {
    runsB += 1;
    return { status: 201, body: { b: true } };
  });
  assert.equal(runsA, 1);
  assert.equal(runsB, 1);
});

test("a request that arrives while the same key is still in flight is rejected, not double-run", async () => {
  const repo = createInMemoryIdempotencyRepository();
  let runs = 0;
  let resolveFirst!: () => void;
  const firstRunGate = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });

  const firstPromise = withIdempotency(repo, "key-1", "games.freeplay", { x: 1 }, NOW, async () => {
    runs += 1;
    await firstRunGate;
    return { status: 201, body: { ok: true } };
  });

  // Give the first call a chance to reserve the key before the second one starts.
  await new Promise((resolve) => setTimeout(resolve, 5));

  await assert.rejects(
    () => withIdempotency(repo, "key-1", "games.freeplay", { x: 1 }, NOW, async () => {
      runs += 1;
      return { status: 201, body: { ok: true } };
    }),
    IdempotencyInFlightError,
  );

  resolveFirst();
  await firstPromise;
  assert.equal(runs, 1, "only the first, in-flight call may ever actually run the mutation");
});
