// Typed API client. Access token lives in memory (set by the auth context); the
// refresh token is an httpOnly cookie, so we send credentials and auto-refresh on 401.
// API base is HARDCODED to the prod API. NEXT_PUBLIC_API_URL is inlined at BUILD time,
// and on the Next 16 deploy it shipped EMPTY, so the client called a relative path on
// its own origin (extsync.com/catalog -> 404) and the public store could not load.
// Local web dev also targets the prod API by default (see AGENT.md), so a literal is
// both safe and robust. To point at a local API, edit this line.
const API_URL = "https://api.extsync.com";

let accessToken: string | null = null;
let onAuthLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
export function setOnAuthLost(cb: () => void) {
  onAuthLost = cb;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include" });
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const data = await res.json();
    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.message || `HTTP ${res.status}`, err?.code, err?.details);
  }
  return data as T;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  let res = await rawFetch(path, init);
  if (res.status === 401 && path !== "/auth/refresh") {
    if (await tryRefresh()) {
      res = await rawFetch(path, init);
    } else {
      onAuthLost?.();
    }
  }
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  async upload<T>(path: string, formData: FormData): Promise<T> {
    let res = await rawFetch(path, { method: "POST", body: formData });
    if (res.status === 401 && (await tryRefresh())) {
      res = await rawFetch(path, { method: "POST", body: formData });
    }
    return parse<T>(res);
  },
  apiUrl: API_URL,
};

// ---- Shared response types (mirror backend camelCase schemas) ----
export interface Me {
  id: string;
  email: string;
  displayName: string;
  role: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  emailNotifOptout: string[];
}

export interface Screenshot {
  id: string;
  url: string;
  position: number;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  fullDescription?: string | null;
  iconUrl?: string | null;
  website?: string | null;
  repoUrl?: string | null;
  visibility: "public" | "private";
  status: string;
  extensionId?: string | null;
  bridgeMode: string;
  version: number;
  permissions: string[];
  screenshots?: Screenshot[];
}

/** Store moderation state of a release, as the DEVELOPER is allowed to see it.
 *  `reason` is text an administrator deliberately wrote for the developer; the
 *  administrator's internal note is never sent to this client at all. */
export type ReviewStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "legacy_pending";

export interface ReleaseReview {
  status: ReviewStatus;
  reason?: string | null;
  reviewedAt?: string | null;
}

export interface Release {
  id: string;
  projectId: string;
  version: string;
  channel: string;
  status: string;
  sequence?: number | null;
  rolloutPercentage: number;
  permissionsChanged: boolean;
  requiresUserApproval: boolean;
  riskScore: number;
  releaseNotes?: string | null;
  validationReport?: unknown;
  validationError?: string | null;
  warningsCount?: number;
  publishedAt?: string | null;
  createdAt?: string | null;
  review?: ReleaseReview | null;
}

/** Store moderation queue (platform administrators only). */
export interface ModerationQueueItem {
  releaseId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  developerEmail?: string | null;
  version: string;
  channel: string;
  status: string;
  reviewStatus: ReviewStatus;
  riskScore: number;
  permissionsChanged: boolean;
  createdAt?: string | null;
  publishedAt?: string | null;
  /** Currently serving a channel, i.e. what real users get right now. */
  isLive: boolean;
  /** No earlier reviewed release on this project - a brand new extension. */
  isNewExtension: boolean;
  /** Strongest bypass-capability signal from the static scan. Advisory only:
   *  "none" means nothing matched the patterns, NOT that the build is safe. */
  riskLevel: RiskLevel;
}

export type RiskLevel = "critical" | "high" | "medium" | "info" | "none";

/** One piece of evidence from the bypass scan, with the file and an excerpt so
 *  a reviewer can go read the actual code rather than trust a label. */
export interface RiskSignal {
  code: string;
  level: Exclude<RiskLevel, "none">;
  title: string;
  detail: string;
  file?: string | null;
  evidence?: string | null;
}

export interface ListingQueueItem {
  projectId: string;
  projectName: string;
  projectSlug: string;
  developerEmail?: string | null;
  listingReviewStatus: ReviewStatus;
  updatedAt?: string | null;
  /** Fields that differ from the approved snapshot. Empty for a project that
   *  has never been reviewed - there is nothing to diff against yet. */
  changedFields: string[];
}

export interface ListingSnapshot {
  name?: string | null;
  short_description?: string | null;
  full_description?: string | null;
  icon_url?: string | null;
  category?: string | null;
  website?: string | null;
  repo_url?: string | null;
  support_url?: string | null;
  privacy_policy_url?: string | null;
  screenshots?: string[];
  capturedAt?: string;
}

export interface ListingDetail {
  projectId: string;
  projectSlug: string;
  listingReviewStatus: ReviewStatus;
  reviewedAt?: string | null;
  reason?: string | null;
  developerEmail?: string | null;
  /** null = nothing approved yet, so the store is rendering the live fields. */
  approved: ListingSnapshot | null;
  proposed: ListingSnapshot;
}

/** One legacy extension with everything needed to review it in place. */
export interface TriageRow {
  releaseId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  ownerEmail?: string | null;
  version: string;
  channel: string;
  releaseStatus: string;
  reviewStatus: ReviewStatus;
  listingReviewStatus: ReviewStatus;
  isLive: boolean;

  permissions: string[];
  hostPermissions: string[];
  broadHostAccess: boolean;
  usesNativeMessaging: boolean;

  /** "not_scanned" means the report predates the scanner - NOT that it is clean. */
  riskLevel: RiskLevel | "not_scanned";
  findings: {
    code?: string | null; level?: string | null; title?: string | null;
    detail?: string | null; file?: string | null; evidence?: string | null;
  }[];
  endpoints: { host: string; files: string[]; benign: boolean }[];
  nativeHosts: { host: string; files: string[]; isExtsyncBridge: boolean }[];
  scanTruncated: boolean;

  iconUrl?: string | null;
  shortDescription?: string | null;
  screenshotCount: number;

  artifactUrl?: string | null;
  artifactSize?: number | null;
  fileCount?: number | null;

  createdAt?: string | null;
  publishedAt?: string | null;
}

export interface TriageProgress {
  extensionsTotal: number;
  extensionsReviewed: number;
  listingsTotal: number;
  listingsReviewed: number;
  highAttentionRemaining: number;
  notScannedRemaining: number;
}

export interface SafeModeStatus {
  enabled: boolean;
  reason?: string | null;
  updatedAt?: string | null;
  updatedByEmail?: string | null;
}

/** One moderation decision, for the audit trail. */
export interface ModerationAuditEntry {
  id: string;
  action: string;
  at?: string | null;
  adminEmail?: string | null;
  adminName?: string | null;
  /** "snapshot" means the acting account has since been deleted and this is the
   *  immutable identity recorded at the time. */
  adminIdentitySource?: "live" | "snapshot" | null;
  projectName?: string | null;
  projectSlug?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  extra?: Record<string, unknown>;
}

/** A reviewed decision that has NOT been executed. Inert until an administrator
 *  applies it: preparing changes nothing the public can see. */
export interface PreparedDecision {
  id: string;
  batch: string;
  releaseId: string;
  projectId: string;
  extension?: string | null;
  slug?: string | null;
  version?: string | null;
  channel?: string | null;
  currentReviewStatus?: string | null;
  listingReviewStatus?: string | null;
  decision: PreparedVerdict;
  listingDecision?: string | null;
  developerReason?: string | null;
  internalNote?: string | null;
  /** The build the reviewer actually read. */
  reviewedSha256?: string | null;
  /** The build that would ship right now. */
  currentSha256?: string | null;
  /** "changed" means the decision is about code nobody reviewed. */
  checksum: "match" | "changed" | "unknown";
  state: "prepared" | "applied" | "failed" | "skipped";
  appliedAt?: string | null;
  appliedByEmail?: string | null;
  resultMessage?: string | null;
  /** Non-null when this row must not be executed, and why. */
  blockedReason?: string | null;
  /** Whose name goes on the audit row if YOU apply this - always the caller.
   *  Preparing names nobody; the reviewer is whoever authenticates and acts. */
  reviewerToRecord?: string | null;
  /** True when this row must not run until a newer approved release has taken
   *  over the channel. Enforced server-side; the checklist is the UI half. */
  requiresNewerApprovedRelease?: boolean;
  /** Present only for guarded rows. `ready` is the server's answer to "has the
   *  replacement actually taken over yet". */
  successor?: {
    ready: boolean;
    reason?: string | null;
    activeReleaseId?: string | null;
    activeVersion?: string | null;
    activeApproved?: boolean | null;
  } | null;
}

export type PreparedVerdict =
  | "approve" | "approve_with_note" | "request_changes"
  | "unpublish" | "needs_human_review";

export interface ApplyPreparedResult {
  applied: number;
  skipped: number;
  failed: number;
  appliedBy: string;
  items: {
    id: string;
    releaseId: string;
    slug: string;
    decision: string;
    state: "applied" | "skipped" | "failed";
    ok: boolean;
    message: string;
  }[];
}

/** A SaveBridge client credential, as the admin API returns it.
 *  There is no field here from which a token could be reconstructed. */
export interface SaveBridgeCredential {
  id: string;
  label: string;
  /** The non-secret lookup half. Safe to display. */
  tokenId: string;
  policy: "netfree_required" | "unrestricted_private";
  credentialType: "public_distribution" | "private_distribution";
  status: "active" | "revoked";
  createdAt?: string | null;
  createdByEmail?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  revokedByEmail?: string | null;
  revokedReason?: string | null;
  lastUsedAt?: string | null;
  useCount: number;
  notes?: string | null;
}

export interface ModerationCounts {
  pendingNew: number;
  pendingUpdate: number;
  legacyLive: number;
  changesRequested: number;
  rejected: number;
  approved: number;
  listingPending: number;
}

export interface ModerationDetail {
  release: {
    id: string; version: string; channel: string; status: string;
    reviewStatus: ReviewStatus; riskScore: number;
    permissionsChanged: boolean; requiresUserApproval: boolean;
    releaseNotes?: string | null;
    validationReport?: unknown;
    createdAt?: string | null; publishedAt?: string | null;
    isLive: boolean;
    riskLevel: RiskLevel;
  };
  /** `note` is the administrator's internal note - admin API only, never shown
   *  to the developer. */
  review: {
    reason?: string | null; note?: string | null;
    reviewedAt?: string | null; reviewedByEmail?: string | null;
  };
  project: {
    id: string; name: string; slug: string; status: string; visibility: string;
    shortDescription?: string | null; fullDescription?: string | null;
    iconUrl?: string | null; website?: string | null; repoUrl?: string | null;
    category?: string | null; extensionId?: string | null;
  };
  developer: { email?: string | null; id?: string | null };
  artifact: {
    public: boolean; staged: boolean;
    size?: number | null; sha256?: string | null; fileCount?: number | null;
  };
}

export interface InstallLink {
  id: string;
  token: string;
  url: string;
  label: string;
  linkType: string;
  channel: string;
  usedCount: number;
  maxUses?: number | null;
  disabled: boolean;
}

export interface CatalogItem {
  slug: string;
  name: string;
  shortDescription: string;
  iconUrl?: string | null;
  developerName: string;
  extensionId?: string | null;
  latestVersion?: string | null;
  category?: string | null;
  publishedAt?: string | null;
  installs?: number;   // registered installs (via the Agent) only
  downloads?: number;  // every acquisition, incl. the site's ZIP button
  avgRating: number;
  ratingsCount: number;
  myRating?: number | null;
}

export interface CatalogChannelInfo {
  channel: string;
  version: string;
  releaseId: string;
  publishedAt?: string | null;
  downloadUrl?: string | null;
  size?: number | null;
  sha256?: string | null;
  releaseNotes?: string | null;
}

export interface CatalogDetail {
  slug: string;
  name: string;
  shortDescription: string;
  fullDescription?: string | null;
  iconUrl?: string | null;
  developerName: string;
  website?: string | null;
  repoUrl?: string | null;
  privacyPolicyUrl?: string | null;
  extensionId?: string | null;
  category?: string | null;
  installs?: number;   // registered installs (via the Agent) only
  downloads?: number;  // every acquisition, incl. the site's ZIP button
  screenshots?: string[];
  channels: CatalogChannelInfo[];
  permissions: string[];
  hostPermissions: string[];
  usesNativeMessaging: boolean;
  installUri?: string | null;
  avgRating: number;
  ratingsCount: number;
  myRating?: number | null;
}

export interface InstallPage {
  token: string;
  name: string;
  iconUrl?: string | null;
  shortDescription: string;
  developerName: string;
  website?: string | null;
  repoUrl?: string | null;
  privacyPolicyUrl?: string | null;
  visibility: string;
  channel: string;
  version?: string | null;
  publishedAt?: string | null;
  permissions: {
    permissions: string[];
    hostPermissions: string[];
    optionalPermissions: string[];
    usesNativeMessaging: boolean;
  };
  requiresAccount: boolean;
  hasBridge: boolean;
  installUri: string;
  downloadUrl?: string | null;
  usable: boolean;
  reason?: string | null;
}

/** A store extension in the signed-in user's library (installed from the site). */
export interface LibraryItem {
  projectId: string;
  slug: string;
  name: string;
  iconUrl?: string | null;
  developerName: string;
  available: boolean;
}

export interface InstallBatch {
  uri: string;
  count: number;
}

/** A private message a user sent to a developer about one of their extensions. */
export interface FeedbackItem {
  id: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  fromName: string;
  body: string;
  /** Only present when the sender chose to leave a reply address. */
  replyEmail?: string | null;
  read: boolean;
  createdAt: string;
}
