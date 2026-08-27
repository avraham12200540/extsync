import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_APPROVED_POSTS_FOR_ELIGIBILITY } from "../../src/game/config";
import { computeEligibility, resolveEligibility } from "../../src/game/eligibility";
import type { EligibilityInput } from "../../src/game/eligibility";

function baseInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    accountStatus: "active",
    isSystemOrBot: false,
    adminOverride: "none",
    approvedPostCount: MIN_APPROVED_POSTS_FOR_ELIGIBILITY,
    ...overrides,
  };
}

test("a user meeting all criteria is eligible with an explainable reason", () => {
  const result = resolveEligibility(baseInput());
  assert.equal(result.eligible, true);
  assert.ok(result.reasons.some((r) => r.code === "meets_minimum_criteria"));
});

test("below the minimum approved-post count is ineligible", () => {
  const result = resolveEligibility(baseInput({ approvedPostCount: MIN_APPROVED_POSTS_FOR_ELIGIBILITY - 1 }));
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((r) => r.code === "insufficient_approved_posts"));
});

test("exactly at the minimum approved-post count is eligible (boundary)", () => {
  const result = resolveEligibility(baseInput({ approvedPostCount: MIN_APPROVED_POSTS_FOR_ELIGIBILITY }));
  assert.equal(result.eligible, true);
});

test("a system/bot account is always ineligible regardless of post count", () => {
  const result = resolveEligibility(baseInput({ isSystemOrBot: true, approvedPostCount: 1000 }));
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((r) => r.code === "system_or_bot_account"));
});

test("a banned account is ineligible", () => {
  const result = resolveEligibility(baseInput({ accountStatus: "banned" }));
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((r) => r.code === "account_status_banned"));
});

test("a deleted account is ineligible", () => {
  const result = resolveEligibility(baseInput({ accountStatus: "deleted" }));
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((r) => r.code === "account_status_deleted"));
});

test("unknown account status does not by itself disqualify - it's noted, not blocking", () => {
  const result = resolveEligibility(baseInput({ accountStatus: "unknown" }));
  assert.equal(result.eligible, true);
  assert.ok(result.reasons.some((r) => r.code === "account_status_unknown"));
});

test("unknown account status combined with insufficient posts is still ineligible for the post-count reason", () => {
  const result = resolveEligibility(baseInput({ accountStatus: "unknown", approvedPostCount: 0 }));
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((r) => r.code === "insufficient_approved_posts"));
});

test("admin override force_ineligible wins over an otherwise-eligible computed signal", () => {
  const result = resolveEligibility(baseInput({ adminOverride: "force_ineligible" }));
  assert.equal(result.eligible, false);
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["admin_override_ineligible"],
  );
});

test("admin override force_eligible wins over an otherwise-ineligible computed signal (e.g. a bot false-positive correction)", () => {
  const result = resolveEligibility(
    baseInput({ adminOverride: "force_eligible", isSystemOrBot: true, approvedPostCount: 0 }),
  );
  assert.equal(result.eligible, true);
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["admin_override_eligible"],
  );
});

test("admin override force_eligible wins over a banned status", () => {
  const result = resolveEligibility(baseInput({ adminOverride: "force_eligible", accountStatus: "banned" }));
  assert.equal(result.eligible, true);
});

test("computeEligibility (no override) matches resolveEligibility when override is none", () => {
  const input = baseInput({ approvedPostCount: 2 });
  assert.deepEqual(computeEligibility(input), resolveEligibility(input));
});
