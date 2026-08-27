import { MIN_APPROVED_POSTS_FOR_ELIGIBILITY } from "./config";

/**
 * Pure, deterministic eligibility resolution - no database access. The
 * repository layer is responsible for recomputing this from stored data
 * and persisting the result (forum_user.computed_eligible/
 * eligibility_reasons/eligible_as_of); this module only decides.
 */

export type ForumAccountStatus = "unknown" | "active" | "deleted" | "banned";
export type EligibilityOverride = "none" | "force_eligible" | "force_ineligible";

export interface EligibilityFlag {
  code: string;
  reason: string;
}

export interface EligibilityInput {
  accountStatus: ForumAccountStatus;
  isSystemOrBot: boolean;
  adminOverride: EligibilityOverride;
  approvedPostCount: number;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityFlag[];
}

/**
 * Reconciles the two independent eligibility signals (see forum.ts's
 * schema comment on forum_user): an admin override, when set, always
 * wins in either direction over the computed signal - that IS the
 * override's purpose (e.g. correcting a bot-detection false positive, or
 * immediately disabling a specific user regardless of what the
 * computation would otherwise conclude).
 */
export function resolveEligibility(input: EligibilityInput): EligibilityResult {
  if (input.adminOverride === "force_ineligible") {
    return {
      eligible: false,
      reasons: [{ code: "admin_override_ineligible", reason: "an admin explicitly marked this user ineligible" }],
    };
  }
  if (input.adminOverride === "force_eligible") {
    return {
      eligible: true,
      reasons: [{ code: "admin_override_eligible", reason: "an admin explicitly marked this user eligible" }],
    };
  }
  return computeEligibility(input);
}

/** The computed signal alone, ignoring any admin override - used both by resolveEligibility and directly when recomputing/caching. */
export function computeEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: EligibilityFlag[] = [];

  if (input.isSystemOrBot) {
    reasons.push({ code: "system_or_bot_account", reason: "flagged as a system or bot account, never a valid guessing target" });
    return { eligible: false, reasons };
  }

  if (input.accountStatus === "deleted" || input.accountStatus === "banned") {
    reasons.push({
      code: `account_status_${input.accountStatus}`,
      reason: `forum account status is "${input.accountStatus}"`,
    });
    return { eligible: false, reasons };
  }

  // "Conservative when unknown" does NOT mean "block everyone whose
  // status we can't confirm" - mitmachim.top's public API has no
  // reliable banned/deleted signal for most users, so almost every row
  // would default to 'unknown' and the entire target pool would
  // disappear. Conservative here means: don't pretend to know something
  // we don't, note the uncertainty explicitly, but still let the harder,
  // actually-knowable facts (post count/quality) decide. An admin can
  // always downgrade a specific user via admin_override if this proves
  // too permissive for a particular case.
  if (input.accountStatus === "unknown") {
    reasons.push({
      code: "account_status_unknown",
      reason: "forum account status could not be confirmed publicly; proceeding on approved-post evidence only",
    });
  }

  if (input.approvedPostCount < MIN_APPROVED_POSTS_FOR_ELIGIBILITY) {
    reasons.push({
      code: "insufficient_approved_posts",
      reason: `${input.approvedPostCount} approved posts, below the minimum of ${MIN_APPROVED_POSTS_FOR_ELIGIBILITY}`,
    });
    return { eligible: false, reasons };
  }

  reasons.push({
    code: "meets_minimum_criteria",
    reason: `${input.approvedPostCount} approved posts, at or above the minimum of ${MIN_APPROVED_POSTS_FOR_ELIGIBILITY}`,
  });
  return { eligible: true, reasons };
}
