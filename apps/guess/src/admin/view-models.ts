import type { AdminForumUserDetail, AdminForumUserSummary } from "./forum-user-repository";
import type { ModerationPostDetail, ModerationQueueItem } from "./moderation-repository";
import type { ImportRunSummaryView } from "./import-run-repository";
import type { AdminAuditEventRecord } from "./audit";

/**
 * Pure mappers from internal admin-domain records to what the admin HTTP
 * layer is allowed to serialize - mirrors src/game/view-models.ts's
 * discipline exactly: every field is listed explicitly, nothing here ever
 * spreads a domain record, so a field added to a repository type later
 * cannot silently leak through a view model without a deliberate edit
 * here. ModerationPostDetailView is the ONLY view model in this file that
 * carries raw_content - it must never be reachable from any public/
 * gameplay-facing route, and no other view model in this file (or in
 * src/game/view-models.ts) may ever include it.
 */

export interface AdminSessionView {
  adminUserId: string;
  email: string;
  sessionExpiresAt: string;
}

export function toAdminSessionView(input: { adminUserId: string; email: string; sessionExpiresAt: Date }): AdminSessionView {
  return { adminUserId: input.adminUserId, email: input.email, sessionExpiresAt: input.sessionExpiresAt.toISOString() };
}

export interface EligibilityFlagView {
  code: string;
  reason: string;
}

export interface AdminForumUserView {
  id: string;
  forumUid: string;
  forumUsername: string;
  forumUserslug: string;
  accountStatus: string;
  isSystemOrBot: boolean;
  adminOverride: string;
  computedEligible: boolean;
  effectiveEligible: boolean;
  approvedPostCount: number;
  totalPostCount: number;
  createdAt: string;
  updatedAt: string;
}

export function toAdminForumUserView(row: AdminForumUserSummary): AdminForumUserView {
  return {
    id: row.id,
    forumUid: row.forumUid,
    forumUsername: row.forumUsername,
    forumUserslug: row.forumUserslug,
    accountStatus: row.accountStatus,
    isSystemOrBot: row.isSystemOrBot,
    adminOverride: row.adminOverride,
    computedEligible: row.computedEligible,
    effectiveEligible: row.effectiveEligible,
    approvedPostCount: row.approvedPostCount,
    totalPostCount: row.totalPostCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface AdminForumUserDetailView extends AdminForumUserView {
  effectiveReasons: EligibilityFlagView[];
  computedReasons: EligibilityFlagView[];
  avgWordCount: number;
  avgQualityScore: number;
  usernameLength: number;
  firstActiveAt: string | null;
  lastActiveAt: string | null;
}

export function toAdminForumUserDetailView(row: AdminForumUserDetail): AdminForumUserDetailView {
  return {
    ...toAdminForumUserView(row),
    effectiveReasons: row.effectiveReasons,
    computedReasons: row.computedReasons,
    avgWordCount: row.avgWordCount,
    avgQualityScore: row.avgQualityScore,
    usernameLength: row.usernameLength,
    firstActiveAt: row.firstActiveAt ? row.firstActiveAt.toISOString() : null,
    lastActiveAt: row.lastActiveAt ? row.lastActiveAt.toISOString() : null,
  };
}

export interface ModerationFlagView {
  code: string;
  reason: string;
}

export interface ModerationQueueItemView {
  id: string;
  forumPid: string;
  forumUserId: string;
  forumUsername: string;
  moderationStatus: string;
  qualityScore: number;
  potentialLeakScore: number;
  moderationFlags: ModerationFlagView[];
  wordCount: number;
  postedAt: string;
  moderationVersion: number;
  sourceDiverged: boolean;
}

export function toModerationQueueItemView(row: ModerationQueueItem): ModerationQueueItemView {
  return {
    id: row.id,
    forumPid: row.forumPid,
    forumUserId: row.forumUserId,
    forumUsername: row.forumUsername,
    moderationStatus: row.moderationStatus,
    qualityScore: row.qualityScore,
    potentialLeakScore: row.potentialLeakScore,
    moderationFlags: row.moderationFlags,
    wordCount: row.wordCount,
    postedAt: row.postedAt.toISOString(),
    moderationVersion: row.moderationVersion,
    sourceDiverged: row.sourceDiverged,
  };
}

/**
 * The only view model anywhere in this app that carries raw_content.
 * Reachable ONLY from the authenticated single-post admin detail
 * endpoint - see the cross-boundary tests in tests/admin/leak.test.ts
 * that assert this shape never appears from any public/gameplay route.
 */
export interface ModerationPostDetailView extends ModerationQueueItemView {
  rawContent: string;
  cleanContent: string | null;
  forumTid: string;
  forumCategoryCid: string;
  sourceUrl: string;
  contentLength: number;
  quoteRatio: number;
  genericResponseScore: number;
  linksCount: number;
  mentionsCount: number;
  sourceDivergedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toModerationPostDetailView(row: ModerationPostDetail): ModerationPostDetailView {
  return {
    ...toModerationQueueItemView(row),
    rawContent: row.rawContent,
    cleanContent: row.cleanContent,
    forumTid: row.forumTid,
    forumCategoryCid: row.forumCategoryCid,
    sourceUrl: row.sourceUrl,
    contentLength: row.contentLength,
    quoteRatio: row.quoteRatio,
    genericResponseScore: row.genericResponseScore,
    linksCount: row.linksCount,
    mentionsCount: row.mentionsCount,
    sourceDivergedAt: row.sourceDivergedAt ? row.sourceDivergedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ImportRunView {
  id: string;
  status: string;
  triggerKind: string;
  triggeredByAdminId: string | null;
  sourceEndpoint: string;
  cursorUsed: string | null;
  postsFetched: number;
  postsNew: number;
  postsUpdated: number;
  usersTouched: number;
  rateLimitEvents: number;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export function toImportRunView(row: ImportRunSummaryView): ImportRunView {
  return {
    id: row.id,
    status: row.status,
    triggerKind: row.triggerKind,
    triggeredByAdminId: row.triggeredByAdminId,
    sourceEndpoint: row.sourceEndpoint,
    cursorUsed: row.cursorUsed,
    postsFetched: row.postsFetched,
    postsNew: row.postsNew,
    postsUpdated: row.postsUpdated,
    usersTouched: row.usersTouched,
    rateLimitEvents: row.rateLimitEvents,
    errorSummary: row.errorSummary,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

export interface AdminAuditEventView {
  id: string;
  actorAdminId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function toAdminAuditEventView(row: AdminAuditEventRecord): AdminAuditEventView {
  return {
    id: row.id,
    actorAdminId: row.actorAdminId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface PaginatedView<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
}
