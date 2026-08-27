import assert from "node:assert/strict";
import { test } from "node:test";
import { hashAdminPassword, verifyAdminPassword, verifyAgainstDummyHash } from "../../src/admin/password";

test("hashAdminPassword produces a hash that verifyAdminPassword accepts for the same password", async () => {
  const hash = await hashAdminPassword("correct horse battery staple 42");
  assert.equal(await verifyAdminPassword(hash, "correct horse battery staple 42"), true);
});

test("verifyAdminPassword rejects a wrong password against a real hash", async () => {
  const hash = await hashAdminPassword("correct horse battery staple 42");
  assert.equal(await verifyAdminPassword(hash, "wrong password"), false);
});

test("hashAdminPassword is not deterministic (unique salt per call)", async () => {
  const a = await hashAdminPassword("same password");
  const b = await hashAdminPassword("same password");
  assert.notEqual(a, b);
});

test("verifyAgainstDummyHash resolves without throwing for any input - timing-parity helper, not a real credential check", async () => {
  await assert.doesNotReject(verifyAgainstDummyHash("literally anything"));
  await assert.doesNotReject(verifyAgainstDummyHash(""));
});
