import type { SanitizeStats } from "./sanitize";

/**
 * Central, deterministic thresholds/wordlists for post quality and leak
 * scoring. One source of truth (mirrors the scoring.ts convention for
 * game scoring) - no database-config override table, no AI API call of
 * any kind. Every score here is a pure function of already-computed
 * inputs, so the same post always gets the same score and the reasoning
 * is always inspectable (see deriveModerationFlags).
 */
export const QUALITY_CONFIG = {
  /** Below this word count, a post is flagged as too short to be useful as a hint. */
  minWordCountForApproval: 8,
  /** At or below this word count, the text is checked against GENERIC_PHRASES. */
  genericReplyMaxWords: 6,
  /** Above this fraction of the post being quoted text, it is flagged as mostly-quoted. */
  maxQuoteRatioForApproval: 0.6,
  /**
   * Normalized (lowercase, punctuation-stripped) low-effort replies in
   * Hebrew and English - "thanks", "works", "cool", and their common
   * variants. Not exhaustive; a documented, extensible list rather than
   * an attempt at completeness.
   */
  genericPhrases: [
    // Hebrew
    "תודה", "תודה רבה", "תודה לך", "עובד", "זה עובד", "עובד לי", "עובד מעולה",
    "מעולה", "אחלה", "יפה", "וואו", "כן", "לא", "בסדר", "סבבה", "תודה על העזרה",
    // English
    "thanks", "thank you", "thx", "works", "it works", "nice", "cool", "great",
    "ok", "okay", "same", "me too", "lol", "haha", "+1", "this",
  ],
} as const;

export interface QualityMetrics {
  wordCount: number;
  contentLength: number;
  quoteRatio: number;
  genericResponseScore: number;
  qualityScore: number;
  potentialLeakScore: number;
  linksCount: number;
  mentionsCount: number;
}

export interface ModerationFlag {
  code: string;
  reason: string;
}

function normalizeForGenericCheck(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:"'()[\]{}\-_*~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeWordCount(cleanText: string): number {
  const trimmed = cleanText.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

export function computeGenericResponseScore(cleanText: string, wordCount: number): number {
  if (wordCount === 0) return 1;
  if (wordCount > QUALITY_CONFIG.genericReplyMaxWords) return 0;
  const normalized = normalizeForGenericCheck(cleanText);
  const isKnownGenericPhrase = (QUALITY_CONFIG.genericPhrases as readonly string[]).includes(normalized);
  if (isKnownGenericPhrase) return 1;
  // Short but not an exact known phrase: still worth a lower, non-zero
  // suspicion score rather than either extreme - explainable as "short
  // and unconfirmed", not "confirmed generic".
  return 0.5;
}

export function computeQualityScore(input: {
  wordCount: number;
  quoteRatio: number;
  genericResponseScore: number;
}): number {
  let score = 1;
  if (input.wordCount < QUALITY_CONFIG.minWordCountForApproval) {
    const shortfall = (QUALITY_CONFIG.minWordCountForApproval - input.wordCount) / QUALITY_CONFIG.minWordCountForApproval;
    score -= shortfall * 0.6;
  }
  score -= input.quoteRatio * 0.5;
  score -= input.genericResponseScore * 0.8;
  return Math.max(0, Math.min(1, score));
}

export function computePotentialLeakScore(stats: Pick<SanitizeStats, "selfReferenceDetected" | "hadSignatureBlock">): number {
  if (stats.selfReferenceDetected) return 1;
  if (stats.hadSignatureBlock) return 0.3;
  return 0;
}

export function computeQualityMetrics(cleanText: string, stats: SanitizeStats): QualityMetrics {
  const wordCount = computeWordCount(cleanText);
  const contentLength = cleanText.length;
  const genericResponseScore = computeGenericResponseScore(cleanText, wordCount);
  const qualityScore = computeQualityScore({ wordCount, quoteRatio: stats.quoteRatio, genericResponseScore });
  const potentialLeakScore = computePotentialLeakScore(stats);
  return {
    wordCount,
    contentLength,
    quoteRatio: stats.quoteRatio,
    genericResponseScore,
    qualityScore,
    potentialLeakScore,
    linksCount: stats.linksCount,
    mentionsCount: stats.mentionsCount,
  };
}

/**
 * Explainable, deterministic flags - every entry names the exact rule
 * that fired and the numbers behind it, so a moderator (or a later test)
 * never has to reverse-engineer why a post was routed to needs_review.
 */
export function deriveModerationFlags(metrics: QualityMetrics): ModerationFlag[] {
  const flags: ModerationFlag[] = [];
  if (metrics.wordCount < QUALITY_CONFIG.minWordCountForApproval) {
    flags.push({
      code: "too_short",
      reason: `word count ${metrics.wordCount} is below the minimum of ${QUALITY_CONFIG.minWordCountForApproval}`,
    });
  }
  if (metrics.genericResponseScore >= 0.5) {
    flags.push({
      code: "generic_reply",
      reason: `generic-response score ${metrics.genericResponseScore.toFixed(2)} suggests a low-effort reply (e.g. "thanks"/"works")`,
    });
  }
  if (metrics.quoteRatio > QUALITY_CONFIG.maxQuoteRatioForApproval) {
    flags.push({
      code: "mostly_quoted",
      reason: `quote ratio ${metrics.quoteRatio.toFixed(2)} exceeds the maximum of ${QUALITY_CONFIG.maxQuoteRatioForApproval}`,
    });
  }
  if (metrics.potentialLeakScore > 0) {
    flags.push({
      code: "potential_identity_leak",
      reason: `potential-leak score ${metrics.potentialLeakScore.toFixed(2)} (self-reference and/or signature block detected)`,
    });
  }
  return flags;
}

export type ModerationStatus = "pending" | "needs_review";

/**
 * Never returns "approved" - point 6 of the Stage 2 mission is explicit
 * that nothing auto-approves in this slice. A post with no flags starts
 * "pending" (routine review queue); a post with any flag starts
 * "needs_review" (flagged for a closer look) - both still require a
 * human admin action (a later stage) before a post can ever become
 * eligible for a game round.
 */
export function decideInitialModerationStatus(flags: ModerationFlag[]): ModerationStatus {
  return flags.length > 0 ? "needs_review" : "pending";
}
