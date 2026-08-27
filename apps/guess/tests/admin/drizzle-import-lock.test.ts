import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrizzleImportLock } from "../../src/admin/drizzle-import-lock";
import { createFakeReserveSql } from "./fake-reserve-sql";

test("lock unavailable: the callback is never called, and no connection query even runs an unlock", async () => {
  const fake = createFakeReserveSql();
  // Pre-hold the lock via a first, still-open reservation, simulating another session already holding it.
  const holder = await fake.rawSql.reserve();
  await holder`select pg_try_advisory_lock(1) as acquired`;
  assert.equal(fake.isLockHeld(), true);

  const lock = createDrizzleImportLock(fake.rawSql);
  let callbackCalled = false;
  const outcome = await lock.withLock(async () => {
    callbackCalled = true;
    return "should never happen";
  });

  assert.equal(outcome.acquired, false);
  assert.equal(callbackCalled, false, "the protected callback must never run when the lock is unavailable");
  assert.equal(
    fake.calls.some((c) => c.kind === "unlock"),
    false,
    "a failed acquisition must never attempt an unlock",
  );
});

test("import success: acquires, runs the callback exactly once, unlocks, and releases the SAME reserved connection", async () => {
  const fake = createFakeReserveSql();
  const lock = createDrizzleImportLock(fake.rawSql);

  let callCount = 0;
  const outcome = await lock.withLock(async () => {
    callCount += 1;
    return "summary-object";
  });

  assert.deepEqual(outcome, { acquired: true, result: "summary-object" });
  assert.equal(callCount, 1);
  assert.equal(fake.isLockHeld(), false, "the lock must be released by the end of a successful run");

  const lockCalls = fake.calls.filter((c) => c.kind === "lock");
  const unlockCalls = fake.calls.filter((c) => c.kind === "unlock");
  assert.equal(lockCalls.length, 1);
  assert.equal(unlockCalls.length, 1);
  assert.equal(
    lockCalls[0]!.connectionId,
    unlockCalls[0]!.connectionId,
    "pg_try_advisory_lock and pg_advisory_unlock must run on the exact same reserved connection",
  );
  assert.deepEqual(fake.releasedConnectionIds, [lockCalls[0]!.connectionId], "the reserved connection must be released back to the pool exactly once");
});

test("import failure: the callback's error propagates, the lock is still unlocked, and the connection is still released", async () => {
  const fake = createFakeReserveSql();
  const lock = createDrizzleImportLock(fake.rawSql);

  await assert.rejects(
    lock.withLock(async () => {
      throw new Error("importer blew up");
    }),
    /importer blew up/,
  );

  assert.equal(fake.isLockHeld(), false, "unlock must still run after a failed callback");
  assert.equal(fake.calls.filter((c) => c.kind === "unlock").length, 1);
  assert.equal(fake.releasedConnectionIds.length, 1, "the connection must still be released after a failed callback");
});

test("unlock failure: the ORIGINAL callback error wins, not the unlock error - and the connection is still released", async () => {
  const fake = createFakeReserveSql({ unlockFails: true });
  const warnings: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  const logger = { warn: (event: string, fields?: Record<string, unknown>) => warnings.push({ event, fields }) };
  const lock = createDrizzleImportLock(fake.rawSql, logger);

  await assert.rejects(
    lock.withLock(async () => {
      throw new Error("importer blew up first");
    }),
    /importer blew up first/,
    "the callback's own error must win over the unlock failure, never be replaced by it",
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]!.event, "import_lock.unlock_failed");
  const warningText = JSON.stringify(warnings[0]);
  assert.doesNotMatch(warningText, /importer blew up first/, "the cleanup-failure log must not carry the original error's message/content");

  assert.equal(fake.releasedConnectionIds.length, 1, "the connection must still be released even when both the callback and unlock fail");
});

test("unlock failure on an otherwise-successful callback still surfaces the unlock failure without losing the result silently", async () => {
  const fake = createFakeReserveSql({ unlockFails: true });
  const warnings: Array<{ event: string }> = [];
  const lock = createDrizzleImportLock(fake.rawSql, { warn: (event) => warnings.push({ event }) });

  const outcome = await lock.withLock(async () => "ok-result");
  assert.deepEqual(outcome, { acquired: true, result: "ok-result" });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]!.event, "import_lock.unlock_failed");
  assert.equal(fake.releasedConnectionIds.length, 1);
});

test("reserve/acquire failure: rawSql.reserve() rejecting propagates directly, the callback never runs, and there is nothing to release", async () => {
  const fake = createFakeReserveSql({ reserveFails: true });
  const lock = createDrizzleImportLock(fake.rawSql);

  let callbackCalled = false;
  await assert.rejects(
    lock.withLock(async () => {
      callbackCalled = true;
      return "unreachable";
    }),
    /simulated reserve failure/,
  );
  assert.equal(callbackCalled, false);
  assert.equal(fake.calls.length, 0, "no SQL was ever issued - reserve() itself failed before any query");
  assert.equal(fake.releasedConnectionIds.length, 0, "nothing was reserved, so nothing should be released");
});

test("concurrent requests: only one withLock call acquires; the loser never runs its callback; each uses its own reserved connection", async () => {
  const fake = createFakeReserveSql();
  const lock = createDrizzleImportLock(fake.rawSql);

  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const firstCallbackStarted = new Promise<void>((resolveStarted) => {
    void lock
      .withLock(async () => {
        resolveStarted();
        await gate;
        return "first-result";
      })
      .then((outcome) => {
        firstOutcome = outcome;
      });
  });
  let firstOutcome: unknown;

  await firstCallbackStarted;

  let secondCallbackCalled = false;
  const secondOutcome = await lock.withLock(async () => {
    secondCallbackCalled = true;
    return "second-result";
  });

  assert.equal(secondOutcome.acquired, false, "a concurrent second call must not acquire while the first is still running");
  assert.equal(secondCallbackCalled, false);

  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(firstOutcome, { acquired: true, result: "first-result" });

  const lockCalls = fake.calls.filter((c) => c.kind === "lock");
  assert.equal(lockCalls.length, 2, "both attempts issue a pg_try_advisory_lock call, only one succeeds");
  assert.notEqual(lockCalls[0]!.connectionId, lockCalls[1]!.connectionId, "concurrent requests reserve distinct physical connections");
});
