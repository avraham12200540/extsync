"""Release lifecycle: upload, publish, pause, revoke, rollback (§7, §12, §14)."""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import APIError, ErrorCode, conflict, not_found
from ..models.enums import (
    Channel,
    NotificationKind,
    ProjectStatus,
    ReleaseStatus,
    can_transition,
)
from ..models.project import Project
from ..models.release import (
    ChannelAssignment,
    ChannelState,
    Release,
    ReleaseArtifact,
    ReleasePermissionSnapshot,
)
from ..models.user import User
from ..config import settings
from ..ids import release_id as new_release_id
from ..storage import storage, upload_key
from . import signing_client
from .audit import record_audit
from .events import emit_event, notify_owner
from .jobs import enqueue_validation
from .push import notify_project_update


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


# --------------------------------------------------------------------------- upload
async def create_release_with_upload(
    db: AsyncSession, project: Project, *, version: str, channel: Channel,
    release_notes: str | None, minimum_agent_version: str, raw: bytes,
    user: User, ip: str | None,
) -> Release:
    if len(raw) > settings.max_upload_zip_bytes:
        raise APIError(ErrorCode.UPLOAD_TOO_LARGE,
                       "קובץ ה-ZIP גדול מהמותר", status_code=413)

    existing = await db.scalar(
        select(Release).where(
            Release.project_id == project.id,
            Release.version == version,
            Release.channel == channel,
        )
    )
    if existing is not None:
        raise conflict(f"גרסה {version} כבר קיימת בערוץ {channel.value}")

    release = Release(
        id=new_release_id(),
        project_id=project.id,
        version=version,
        channel=channel,
        status=ReleaseStatus.uploaded,
        uploaded_by_user_id=user.id,
        release_notes=release_notes,
        minimum_agent_version=minimum_agent_version,
    )
    db.add(release)
    await db.flush()

    key = upload_key(project.id, release.id)
    sha = hashlib.sha256(raw).hexdigest()
    await asyncio.to_thread(
        storage.put_bytes, settings.s3_bucket_uploads, key, raw, "application/zip"
    )
    db.add(ReleaseArtifact(
        release_id=release.id, kind="original",
        s3_bucket=settings.s3_bucket_uploads, s3_key=key,
        size=len(raw), sha256=sha,
    ))
    await record_audit(db, action="release.uploaded", actor_user_id=user.id,
                       target_type="release", target_id=release.id, project_id=project.id, ip_address=ip)
    await emit_event(db, project.id, "release.uploaded",
                     {"releaseId": release.id, "version": version, "channel": channel.value})

    # Persist before enqueuing so the worker is guaranteed to find the row.
    await db.commit()
    await enqueue_validation(release.id)
    return release


# --------------------------------------------------------------------------- metadata
async def _next_sequence(db: AsyncSession, project_id: str) -> int:
    current = await db.scalar(
        select(func.max(Release.sequence)).where(Release.project_id == project_id)
    )
    return (current or 0) + 1


async def _build_unsigned_metadata(
    db: AsyncSession, project: Project, release: Release, *, rollout: int, rollback: bool,
) -> dict:
    artifact = await db.scalar(
        select(ReleaseArtifact).where(
            ReleaseArtifact.release_id == release.id, ReleaseArtifact.kind == "validated"
        )
    )
    if artifact is None:
        raise APIError(ErrorCode.RELEASE_NOT_READY,
                       "אין artifact מאומת לגרסה הזו", status_code=409)
    meta = {
        "schema": 1,
        "releaseId": release.id,
        "projectId": project.id,
        "extensionId": project.extension_id or "",
        "version": release.version,
        "channel": release.channel.value,
        "minimumAgentVersion": release.minimum_agent_version,
        "artifact": {
            "url": storage.public_url(artifact.s3_bucket, artifact.s3_key),
            "size": artifact.size,
            "sha256": artifact.sha256,
        },
        "sequence": release.sequence,
        "rolloutPercentage": rollout,
        "permissionsChanged": release.permissions_changed,
        "requiresUserApproval": release.requires_user_approval,
        "publishedAt": (release.published_at or _now()).isoformat().replace("+00:00", "Z"),
        "keyId": settings.signing_active_key_id,
    }
    if rollback:
        meta["rollback"] = True
    return meta


async def _set_channel_active(
    db: AsyncSession, project: Project, channel: Channel, release: Release, *,
    rollout: int, user: User,
) -> None:
    state = await db.scalar(
        select(ChannelState).where(
            ChannelState.project_id == project.id, ChannelState.channel == channel
        )
    )
    if state is None:
        state = ChannelState(project_id=project.id, channel=channel)
        db.add(state)
    # Supersede the previously active release in this channel.
    if state.active_release_id and state.active_release_id != release.id:
        prev = await db.get(Release, state.active_release_id)
        if prev is not None and prev.status == ReleaseStatus.published:
            prev.status = ReleaseStatus.superseded
            prev.superseded_by_release_id = release.id
        await db.execute(
            ChannelAssignment.__table__.update()
            .where(
                ChannelAssignment.project_id == project.id,
                ChannelAssignment.channel == channel,
                ChannelAssignment.unassigned_at.is_(None),
            )
            .values(unassigned_at=_now())
        )
    state.active_release_id = release.id
    state.rollout_percentage = rollout
    state.is_paused = False
    db.add(ChannelAssignment(
        project_id=project.id, channel=channel, release_id=release.id,
        assigned_by_user_id=user.id, rollout_percentage=rollout,
    ))


# --------------------------------------------------------------------------- publish
async def publish_release(
    db: AsyncSession, project: Project, release: Release, *, rollout: int, user: User, ip: str | None,
) -> Release:
    if release.status not in (ReleaseStatus.ready, ReleaseStatus.draft,
                              ReleaseStatus.paused, ReleaseStatus.scheduled):
        raise APIError(ErrorCode.RELEASE_NOT_READY,
                       "הגרסה אינה במצב שניתן לפרסם ממנו", status_code=409)

    if release.sequence is None:
        release.sequence = await _next_sequence(db, project.id)
    release.published_at = release.published_at or _now()
    release.rollout_percentage = rollout

    unsigned = await _build_unsigned_metadata(db, project, release, rollout=rollout, rollback=False)
    signed = await signing_client.sign(unsigned)
    release.signed_metadata = signed
    release.signature = signed["signature"]
    release.key_id = signed["keyId"]
    release.status = ReleaseStatus.published

    await _set_channel_active(db, project, release.channel, release, rollout=rollout, user=user)
    if project.status == ProjectStatus.draft:
        project.status = ProjectStatus.active

    await record_audit(db, action="release.publish", actor_user_id=user.id,
                       target_type="release", target_id=release.id, project_id=project.id,
                       ip_address=ip, extra={"channel": release.channel.value, "rollout": rollout})
    await notify_owner(db, project.id, NotificationKind.release_published,
                       title="הגרסה פורסמה",
                       body=f"גרסה {release.version} פורסמה לערוץ {release.channel.value} ({rollout}%).",
                       data={"releaseId": release.id})
    await emit_event(db, project.id, "release.published",
                     {"releaseId": release.id, "version": release.version,
                      "channel": release.channel.value, "rollout": rollout, "sequence": release.sequence})
    await notify_project_update(project.id, release.channel.value)  # nudge connected Agents
    return release


# --------------------------------------------------------------------------- pause
async def pause_release(db: AsyncSession, project: Project, release: Release, *,
                        reason: str | None, user: User, ip: str | None) -> Release:
    if release.status != ReleaseStatus.published:
        raise APIError(ErrorCode.INVALID_STATE_TRANSITION,
                       "ניתן להשהות רק גרסה שפורסמה", status_code=409)
    release.status = ReleaseStatus.paused
    state = await db.scalar(
        select(ChannelState).where(
            ChannelState.project_id == project.id, ChannelState.channel == release.channel
        )
    )
    if state is not None and state.active_release_id == release.id:
        state.is_paused = True
    await record_audit(db, action="release.pause", actor_user_id=user.id,
                       target_type="release", target_id=release.id, project_id=project.id,
                       ip_address=ip, extra={"reason": reason})
    await emit_event(db, project.id, "release.paused",
                     {"releaseId": release.id, "reason": reason})
    return release


# --------------------------------------------------------------------------- revoke
async def revoke_release(db: AsyncSession, project: Project, release: Release, *,
                         reason: str, user: User, ip: str | None) -> Release:
    if release.status in (ReleaseStatus.revoked,):
        return release
    release.status = ReleaseStatus.revoked
    release.revoked_reason = reason
    # If it was the active release, fall back to the previous published one.
    state = await db.scalar(
        select(ChannelState).where(
            ChannelState.project_id == project.id, ChannelState.channel == release.channel
        )
    )
    if state is not None and state.active_release_id == release.id:
        prev = await db.scalar(
            select(Release).where(
                Release.project_id == project.id, Release.channel == release.channel,
                Release.status == ReleaseStatus.superseded, Release.id != release.id,
            ).order_by(Release.sequence.desc()).limit(1)
        )
        state.active_release_id = prev.id if prev else None
    await record_audit(db, action="release.revoke", actor_user_id=user.id,
                       target_type="release", target_id=release.id, project_id=project.id,
                       ip_address=ip, extra={"reason": reason})
    await emit_event(db, project.id, "release.revoked",
                     {"releaseId": release.id, "reason": reason})
    return release


# --------------------------------------------------------------------------- rollback
async def rollback_release(db: AsyncSession, project: Project, channel: Channel, *,
                           target_release_id: str | None, user: User, ip: str | None) -> Release:
    """Re-publish an earlier release as a signed rollback (new, higher sequence,
    rollback=true) so Agents apply it despite its older version (§14)."""
    if target_release_id:
        target = await db.get(Release, target_release_id)
        if target is None or target.project_id != project.id or target.channel != channel:
            raise not_found("גרסת היעד ל-rollback לא נמצאה")
    else:
        target = await db.scalar(
            select(Release).where(
                Release.project_id == project.id, Release.channel == channel,
                Release.status == ReleaseStatus.superseded,
            ).order_by(Release.sequence.desc()).limit(1)
        )
        if target is None:
            raise not_found("אין גרסה קודמת לחזור אליה")

    # Ensure the target still has a validated artifact (signed + intact).
    artifact = await db.scalar(
        select(ReleaseArtifact).where(
            ReleaseArtifact.release_id == target.id, ReleaseArtifact.kind == "validated"
        )
    )
    if artifact is None:
        raise APIError(ErrorCode.ROLLBACK_FAILED,
                       "לגרסת היעד אין artifact תקין", status_code=409)

    # Mark the currently active release superseded.
    state = await db.scalar(
        select(ChannelState).where(
            ChannelState.project_id == project.id, ChannelState.channel == channel
        )
    )
    if state is not None and state.active_release_id and state.active_release_id != target.id:
        cur = await db.get(Release, state.active_release_id)
        if cur is not None and cur.status == ReleaseStatus.published:
            cur.status = ReleaseStatus.superseded
            cur.superseded_by_release_id = target.id

    target.sequence = await _next_sequence(db, project.id)
    target.published_at = _now()
    target.rollout_percentage = 100
    target.status = ReleaseStatus.published
    unsigned = await _build_unsigned_metadata(db, project, target, rollout=100, rollback=True)
    signed = await signing_client.sign(unsigned)
    target.signed_metadata = signed
    target.signature = signed["signature"]
    target.key_id = signed["keyId"]

    await _set_channel_active(db, project, channel, target, rollout=100, user=user)
    await record_audit(db, action="release.rollback", actor_user_id=user.id,
                       target_type="release", target_id=target.id, project_id=project.id,
                       ip_address=ip, extra={"channel": channel.value})
    await notify_owner(db, project.id, NotificationKind.rollback_done,
                       title="בוצע Rollback",
                       body=f"הערוץ {channel.value} הוחזר לגרסה {target.version}.",
                       data={"releaseId": target.id}, email=True)
    await emit_event(db, project.id, "rollback.completed",
                     {"releaseId": target.id, "version": target.version, "channel": channel.value})
    await notify_project_update(project.id, channel.value, event="rollback")
    return target


# --------------------------------------------------------------------------- delete
async def delete_release(db: AsyncSession, project: Project, release: Release, *,
                         user: User, ip: str | None) -> None:
    """Delete a release and its artifacts. Allowed for failed uploads, drafts,
    ready/superseded/revoked/paused versions — anything that is NOT the currently
    live published release (removing that would break active installs)."""
    if release.status == ReleaseStatus.published:
        raise APIError(ErrorCode.INVALID_STATE_TRANSITION,
                       "לא ניתן למחוק גרסה שמפורסמת כעת — השהה או בצע לה Rollback קודם.",
                       status_code=409)

    # If this release is still the channel's active pointer (e.g. paused), clear it.
    state = await db.scalar(
        select(ChannelState).where(
            ChannelState.project_id == project.id, ChannelState.channel == release.channel
        )
    )
    if state is not None and state.active_release_id == release.id:
        state.active_release_id = None
        state.is_paused = False

    # Drop dangling "superseded_by" pointers from other releases (plain string col).
    await db.execute(
        Release.__table__.update()
        .where(Release.superseded_by_release_id == release.id)
        .values(superseded_by_release_id=None)
    )

    # Delete artifacts from object storage (best effort), then DB child rows.
    artifacts = list((await db.scalars(
        select(ReleaseArtifact).where(ReleaseArtifact.release_id == release.id)
    )).all())
    for art in artifacts:
        try:
            await asyncio.to_thread(storage.delete, art.s3_bucket, art.s3_key)
        except Exception:  # noqa: BLE001 — object may already be gone; deletion is best effort
            pass

    for model in (ReleaseArtifact, ReleasePermissionSnapshot, ChannelAssignment):
        await db.execute(model.__table__.delete().where(model.release_id == release.id))

    version, status_ = release.version, release.status.value
    await record_audit(db, action="release.delete", actor_user_id=user.id,
                       target_type="release", target_id=release.id, project_id=project.id,
                       ip_address=ip, extra={"version": version, "status": status_})
    await emit_event(db, project.id, "release.deleted",
                     {"releaseId": release.id, "version": version})
    await db.delete(release)
    await db.commit()


# --------------------------------------------------------------------------- queries
async def list_releases(db: AsyncSession, project_id: str, channel: Channel | None) -> list[Release]:
    stmt = select(Release).where(Release.project_id == project_id)
    if channel is not None:
        stmt = stmt.where(Release.channel == channel)
    stmt = stmt.order_by(Release.created_at.desc())
    return list((await db.scalars(stmt)).all())


async def get_release(db: AsyncSession, project_id: str, release_id: str) -> Release:
    release = await db.get(Release, release_id)
    if release is None or release.project_id != project_id:
        raise not_found("הגרסה לא נמצאה")
    return release
