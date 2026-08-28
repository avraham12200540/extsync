"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { AdminForumUserDetailView, ModerationPostDetailView } from "@/admin/view-models";
import {
  AdminApiError,
  approveModerationPost,
  editModerationPost,
  getForumUserDetail,
  getModerationPostDetail,
  rejectModerationPost,
} from "@/lib/admin-client";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Dialog } from "@/components/admin/dialog";
import { usePreferences } from "@/lib/preferences-context";
import { useTranslation } from "@/lib/use-translation";

function statusKey(status: string): string {
  switch (status) {
    case "approved":
      return "admin.moderation.statusApproved";
    case "rejected":
      return "admin.moderation.statusRejected";
    case "needs_review":
      return "admin.moderation.statusNeedsReview";
    default:
      return "admin.moderation.statusPending";
  }
}

/**
 * Maps the closed, stable set of flag codes src/importer/quality.ts's deriveModerationFlags can
 * ever emit ("too_short" | "generic_reply" | "mostly_quoted" | "potential_identity_leak") to a
 * localized label - never the backend's own `reason` string, which is English-only, free-form
 * diagnostic prose, not translated/translatable content. See flagReasonForLocale below for how
 * that raw reason is still surfaced, but only as English-locale secondary diagnostic text.
 */
function flagLabelKey(code: string): string {
  switch (code) {
    case "too_short":
      return "admin.moderation.flagTooShort";
    case "generic_reply":
      return "admin.moderation.flagGenericReply";
    case "mostly_quoted":
      return "admin.moderation.flagMostlyQuoted";
    case "potential_identity_leak":
      return "admin.moderation.flagPotentialIdentityLeak";
    default:
      return "admin.moderation.flagUnknown";
  }
}

function accountStatusKey(status: string): string {
  switch (status) {
    case "active":
      return "admin.users.statusActive";
    case "deleted":
      return "admin.users.statusDeleted";
    case "banned":
      return "admin.users.statusBanned";
    default:
      return "admin.users.statusUnknown";
  }
}

const CONFLICT_CODE = "moderation_conflict";

export default function AdminModerationDetailPage() {
  const t = useTranslation();
  const { locale } = usePreferences();
  const params = useParams<{ forumPostId: string }>();
  const forumPostId = params.forumPostId;
  const { withReauth } = useAdminAuth();

  const [post, setPost] = useState<ModerationPostDetailView | null>(null);
  const [forumUser, setForumUser] = useState<AdminForumUserDetailView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [conflict, setConflict] = useState(false);

  const [pending, setPending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");

  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    try {
      const detail = await getModerationPostDetail(forumPostId);
      setPost(detail);
      setConflict(false);
      // Best-effort enrichment - a missing/failed forum-user lookup never blocks the moderation view itself.
      try {
        const user = await getForumUserDetail(detail.forumUserId);
        setForumUser(user);
      } catch {
        setForumUser(null);
      }
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 404) setNotFound(true);
    }
  }, [forumPostId]);

  useEffect(() => {
    // See the equivalent note in admin/moderation/page.tsx - the inline IIFE wrapper (not a bare
    // `void load()`) is what makes this pass react-hooks/set-state-in-effect; behavior is unchanged.
    void (async () => {
      await load();
    })();
  }, [load]);

  function handleMutationError(err: unknown): boolean {
    if (err instanceof AdminApiError && err.code === CONFLICT_CODE) {
      setConflict(true);
      return true;
    }
    return false;
  }

  async function handleApprove() {
    if (!post) return;
    setPending(true);
    try {
      const updated = await withReauth(() => approveModerationPost(post.id, post.moderationVersion));
      setPost(updated);
      setSuccessMessage(t("admin.moderation.approveSuccess"));
      setConfirmApprove(false);
    } catch (err) {
      if (!handleMutationError(err)) throw err;
      setConfirmApprove(false);
    } finally {
      setPending(false);
    }
  }

  async function handleReject() {
    if (!post) return;
    setPending(true);
    try {
      const updated = await withReauth(() => rejectModerationPost(post.id, post.moderationVersion, rejectReason || undefined));
      setPost(updated);
      setSuccessMessage(t("admin.moderation.rejectSuccess"));
      setRejecting(false);
      setRejectReason("");
    } catch (err) {
      if (!handleMutationError(err)) throw err;
      setRejecting(false);
    } finally {
      setPending(false);
    }
  }

  function startEditing() {
    if (!post) return;
    setDraftContent(post.cleanContent ?? "");
    setEditing(true);
  }

  async function handleSaveEdit() {
    if (!post) return;
    setPending(true);
    try {
      const updated = await withReauth(() => editModerationPost(post.id, post.moderationVersion, draftContent));
      setPost(updated);
      setSuccessMessage(t("admin.moderation.editSuccess"));
      setEditing(false);
    } catch (err) {
      if (!handleMutationError(err)) throw err;
      setEditing(false);
    } finally {
      setPending(false);
    }
  }

  if (notFound) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">{t("admin.moderation.notFound")}</p>
        <Link href="/admin/moderation" className="text-sm text-ink underline decoration-line underline-offset-4 hover:text-accent">
          {t("admin.users.backToList")}
        </Link>
      </div>
    );
  }

  if (!post) return null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/admin/moderation" className="text-sm text-ink-muted underline decoration-line underline-offset-4 hover:text-ink">
          {t("admin.users.backToList")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink">{t("admin.moderation.detailTitle")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("admin.moderation.versionLabel", { version: post.moderationVersion })}</p>
      </div>

      {conflict && (
        <div role="alert" className="flex flex-col gap-2 border border-line bg-surface p-4">
          <p className="text-sm font-medium text-ink">{t("admin.moderation.conflictTitle")}</p>
          <p className="text-sm text-ink-muted">{t("admin.moderation.conflictBody")}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="self-start rounded border border-accent bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
          >
            {t("admin.moderation.conflictReload")}
          </button>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-4">
        <dt className="text-ink-muted">{t("admin.moderation.filterStatus")}</dt>
        <dd className="text-ink">{t(statusKey(post.moderationStatus))}</dd>
        <dt className="text-ink-muted">{t("admin.moderation.columnQuality")}</dt>
        <dd className="text-ink">{post.qualityScore.toFixed(2)}</dd>
        <dt className="text-ink-muted">{t("admin.moderation.columnLeak")}</dt>
        <dd className="text-ink">{post.potentialLeakScore.toFixed(2)}</dd>
        <dt className="text-ink-muted">{t("admin.moderation.columnWords")}</dt>
        <dd className="text-ink">{post.wordCount}</dd>
      </dl>

      <section className="border-t border-line pt-4">
        <h2 className="text-sm font-medium text-ink">{t("admin.moderation.columnFlags")}</h2>
        {post.moderationFlags.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">{t("admin.moderation.flagsNone")}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-muted">
            {post.moderationFlags.map((flag) => (
              <li key={flag.code}>
                {t(flagLabelKey(flag.code))}
                {/* The backend's own `reason` is English-only free-form diagnostic prose (see
                    src/importer/quality.ts) - never rendered as primary text, and only ever shown
                    at all, as secondary diagnostic detail, when the UI itself is already in English. */}
                {locale === "en" && flag.reason && <span dir="ltr"> ({flag.reason})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {post.sourceDiverged && (
        <p role="status" className="border-t border-line pt-4 text-sm text-ink-muted">
          {t("admin.moderation.sourceDivergedNotice")}
        </p>
      )}

      <section className="border-t border-line pt-4">
        <h2 className="text-sm font-medium text-ink">{t("admin.moderation.rawTitle")}</h2>
        {/* Untrusted source text - rendered strictly as inert text content, never dangerouslySetInnerHTML. */}
        <pre dir="auto" className="mt-2 whitespace-pre-wrap break-words rounded border border-line bg-surface p-3 text-sm text-ink-muted">
          {post.rawContent}
        </pre>
      </section>

      <section className="border-t border-line pt-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">{t("admin.moderation.cleanTitle")}</h2>
          {!editing && (
            <button type="button" onClick={startEditing} disabled={pending} className="text-sm text-ink-muted underline decoration-line underline-offset-4 hover:text-ink disabled:opacity-50">
              {t("admin.moderation.editAction")}
            </button>
          )}
        </div>

        {editing ? (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-sm text-ink-muted">{t("admin.moderation.editBody")}</p>
            <label htmlFor="moderation-edit-content" className="sr-only">
              {t("admin.moderation.editContentLabel")}
            </label>
            <textarea
              id="moderation-edit-content"
              dir="auto"
              rows={6}
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              maxLength={4000}
              className="w-full rounded border border-line bg-surface p-3 text-sm text-ink outline-none focus-visible:border-accent"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSaveEdit()}
                disabled={pending || draftContent.trim().length === 0}
                className="rounded border border-accent bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
              >
                {pending ? t("admin.moderation.editSaving") : t("admin.moderation.editSave")}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={pending}
                className="text-sm text-ink-muted underline decoration-line underline-offset-4 hover:text-ink disabled:opacity-50"
              >
                {t("admin.moderation.editCancel")}
              </button>
            </div>
          </div>
        ) : (
          <p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">
            {post.cleanContent}
          </p>
        )}
      </section>

      <section className="border-t border-line pt-4">
        <h2 className="text-sm font-medium text-ink">{t("admin.moderation.sourceLink")}</h2>
        <a
          href={post.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          dir="ltr"
          className="mt-2 inline-block break-all text-sm text-ink underline decoration-line underline-offset-4 hover:text-accent"
        >
          {post.sourceUrl}
        </a>
      </section>

      <section className="border-t border-line pt-4">
        <h2 className="text-sm font-medium text-ink">{t("admin.moderation.forumUserSectionTitle")}</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink-muted">{t("admin.moderation.columnAuthor")}</dt>
          <dd dir="auto" className="text-ink">
            {post.forumUsername}
          </dd>
          {forumUser && (
            <>
              <dt className="text-ink-muted">{t("admin.users.columnStatus")}</dt>
              <dd className="text-ink">{t(accountStatusKey(forumUser.accountStatus))}</dd>
              <dt className="text-ink-muted">{t("admin.users.columnEligible")}</dt>
              <dd className="text-ink">{forumUser.effectiveEligible ? t("admin.users.eligibleYes") : t("admin.users.eligibleNo")}</dd>
            </>
          )}
        </dl>
        <Link
          href={`/admin/users/${encodeURIComponent(post.forumUserId)}`}
          className="mt-2 inline-block text-sm text-ink underline decoration-line underline-offset-4 hover:text-accent"
        >
          {t("admin.moderation.viewForumUserProfile")}
        </Link>
      </section>

      <section className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button
          type="button"
          onClick={() => setConfirmApprove(true)}
          disabled={pending || post.moderationStatus === "approved"}
          className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {pending && confirmApprove ? t("admin.moderation.approving") : t("admin.moderation.approve")}
        </button>
        <button
          type="button"
          onClick={() => setRejecting(true)}
          disabled={pending || post.moderationStatus === "rejected"}
          className="rounded border border-ink bg-ink px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
        >
          {t("admin.moderation.reject")}
        </button>
        <p role="status" className="min-h-[1em] text-sm text-ink-muted">
          {successMessage}
        </p>
      </section>

      <ConfirmDialog
        open={confirmApprove}
        title={t("admin.moderation.approveConfirmTitle")}
        body={t("admin.moderation.approveConfirmBody")}
        confirmLabel={t("admin.confirm.confirm")}
        pending={pending}
        tone="neutral"
        onConfirm={() => void handleApprove()}
        onCancel={() => setConfirmApprove(false)}
      />

      <Dialog open={rejecting} titleId="admin-reject-dialog-title" title={t("admin.moderation.rejectConfirmTitle")} onDismiss={() => setRejecting(false)}>
        <p className="mt-2 text-sm text-ink-muted">{t("admin.moderation.rejectConfirmBody")}</p>
        <label htmlFor="moderation-reject-reason" className="mb-1 mt-3 block text-xs text-ink-muted">
          {t("admin.moderation.rejectReasonLabel")}
        </label>
        <textarea
          id="moderation-reject-reason"
          dir="auto"
          rows={3}
          value={rejectReason}
          onChange={(event) => setRejectReason(event.target.value)}
          maxLength={1000}
          className="w-full rounded border border-line bg-bg p-3 text-sm text-ink outline-none focus-visible:border-accent"
        />
        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setRejecting(false)}
            disabled={pending}
            className="text-sm text-ink-muted underline decoration-line underline-offset-4 hover:text-ink disabled:opacity-50"
          >
            {t("admin.confirm.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleReject()}
            disabled={pending}
            className="rounded border border-ink bg-ink px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
          >
            {pending ? t("admin.moderation.rejecting") : t("admin.moderation.reject")}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
