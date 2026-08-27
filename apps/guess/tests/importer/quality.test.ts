import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QUALITY_CONFIG,
  computeGenericResponseScore,
  computeQualityMetrics,
  computeQualityScore,
  computeWordCount,
  decideInitialModerationStatus,
  deriveModerationFlags,
} from "../../src/importer/quality";
import type { SanitizeStats } from "../../src/importer/sanitize";

function stats(overrides: Partial<SanitizeStats> = {}): SanitizeStats {
  return {
    linksCount: 0,
    mentionsCount: 0,
    quoteRatio: 0,
    hadSignatureBlock: false,
    selfReferenceDetected: false,
    ...overrides,
  };
}

test("computeWordCount counts whitespace-separated tokens for Hebrew and English alike", () => {
  assert.equal(computeWordCount("שלום עולם יפה"), 3);
  assert.equal(computeWordCount("hello world"), 2);
  assert.equal(computeWordCount(""), 0);
  assert.equal(computeWordCount("   "), 0);
  assert.equal(computeWordCount("one"), 1);
});

test("computeGenericResponseScore recognizes exact Hebrew generic replies", () => {
  assert.equal(computeGenericResponseScore("תודה", computeWordCount("תודה")), 1);
  assert.equal(computeGenericResponseScore("תודה רבה", computeWordCount("תודה רבה")), 1);
  assert.equal(computeGenericResponseScore("עובד", computeWordCount("עובד")), 1);
});

test("computeGenericResponseScore recognizes exact English generic replies, case-insensitively and with punctuation", () => {
  assert.equal(computeGenericResponseScore("Thanks!", computeWordCount("Thanks!")), 1);
  assert.equal(computeGenericResponseScore("it works", computeWordCount("it works")), 1);
  assert.equal(computeGenericResponseScore("Cool.", computeWordCount("Cool.")), 1);
});

test("computeGenericResponseScore gives a mid-range score for short-but-unmatched text", () => {
  const text = "wow really?";
  const score = computeGenericResponseScore(text, computeWordCount(text));
  assert.equal(score, 0.5);
});

test("computeGenericResponseScore is 0 for an ordinary long sentence", () => {
  const text = "this is a perfectly ordinary sentence with real content in it about a real topic";
  const score = computeGenericResponseScore(text, computeWordCount(text));
  assert.equal(score, 0);
});

test("computeQualityScore penalizes short posts, quoted posts, and generic posts, and stays within [0,1]", () => {
  const good = computeQualityScore({ wordCount: 50, quoteRatio: 0, genericResponseScore: 0 });
  assert.equal(good, 1);

  const short = computeQualityScore({ wordCount: 1, quoteRatio: 0, genericResponseScore: 0 });
  assert.ok(short < good);

  const quoted = computeQualityScore({ wordCount: 50, quoteRatio: 0.9, genericResponseScore: 0 });
  assert.ok(quoted < good);

  const generic = computeQualityScore({ wordCount: 50, quoteRatio: 0, genericResponseScore: 1 });
  assert.ok(generic < good);

  const worst = computeQualityScore({ wordCount: 0, quoteRatio: 1, genericResponseScore: 1 });
  assert.equal(worst, 0);
});

test("computeQualityMetrics: an ordinary long post scores well and has no flags", () => {
  const cleanText =
    "זהו פוסט ארוך וסביר עם תוכן אמיתי שמסביר נושא טכני בצורה מפורטת ומועילה לקוראים אחרים בפורום";
  const metrics = computeQualityMetrics(cleanText, stats());
  assert.ok(metrics.wordCount >= QUALITY_CONFIG.minWordCountForApproval);
  assert.equal(metrics.genericResponseScore, 0);
  assert.ok(metrics.qualityScore > 0.8);
  assert.equal(deriveModerationFlags(metrics).length, 0);
  assert.equal(decideInitialModerationStatus(deriveModerationFlags(metrics)), "pending");
});

test("computeQualityMetrics: a generic short reply is flagged generic_reply and routed to needs_review", () => {
  const metrics = computeQualityMetrics("תודה רבה", stats());
  const flags = deriveModerationFlags(metrics);
  assert.ok(flags.some((f) => f.code === "generic_reply"));
  assert.equal(decideInitialModerationStatus(flags), "needs_review");
});

test("computeQualityMetrics: a mostly-quoted post is flagged mostly_quoted", () => {
  const longText = "word ".repeat(30).trim();
  const metrics = computeQualityMetrics(longText, stats({ quoteRatio: 0.9 }));
  const flags = deriveModerationFlags(metrics);
  assert.ok(flags.some((f) => f.code === "mostly_quoted"));
});

test("computeQualityMetrics: a self-reference is flagged potential_identity_leak with leak score 1", () => {
  const longText = "word ".repeat(30).trim();
  const metrics = computeQualityMetrics(longText, stats({ selfReferenceDetected: true }));
  assert.equal(metrics.potentialLeakScore, 1);
  const flags = deriveModerationFlags(metrics);
  assert.ok(flags.some((f) => f.code === "potential_identity_leak"));
  assert.equal(decideInitialModerationStatus(flags), "needs_review");
});

test("computeQualityMetrics: a signature block alone gives a lower non-zero leak score than a self-reference", () => {
  const longText = "word ".repeat(30).trim();
  const metrics = computeQualityMetrics(longText, stats({ hadSignatureBlock: true }));
  assert.equal(metrics.potentialLeakScore, 0.3);
  assert.ok(metrics.potentialLeakScore < 1);
});

test("decideInitialModerationStatus never returns approved", () => {
  const longText = "word ".repeat(30).trim();
  const cleanFlags = deriveModerationFlags(computeQualityMetrics(longText, stats()));
  const dirtyFlags = deriveModerationFlags(computeQualityMetrics("תודה", stats({ selfReferenceDetected: true })));
  const statuses = [decideInitialModerationStatus(cleanFlags), decideInitialModerationStatus(dirtyFlags)];
  for (const status of statuses) {
    assert.notEqual(status, "approved");
  }
});

test("very short generic replies in both languages all resolve the same way end to end", () => {
  for (const text of ["תודה", "עובד", "thanks", "works", "cool"]) {
    const metrics = computeQualityMetrics(text, stats());
    const flags = deriveModerationFlags(metrics);
    assert.ok(flags.some((f) => f.code === "generic_reply"), `expected "${text}" to be flagged generic_reply`);
    assert.equal(decideInitialModerationStatus(flags), "needs_review");
  }
});
