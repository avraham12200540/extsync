"""Release validation pipeline (§8, §25). Runs in the worker, off the API path.

Idempotent: re-processing a release that is already `ready`/`published` is a
no-op. Never deletes the original upload.
"""
from __future__ import annotations

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from extsync_api.config import settings
from extsync_api.logging import get_logger
from extsync_api.models.enums import NotificationKind, ReleaseStatus
from extsync_api.models.project import ProjectKey
from extsync_api.models.release import (
    Release,
    ReleaseArtifact,
    ReleasePermissionSnapshot,
)
from extsync_api.services.events import emit_event, notify_owner
from extsync_api.storage import artifact_key, storage

from .artifact import inject_manifest_key
from .permissions_diff import diff_permissions, permissions_changed
from .validation import Limits, validate_extension_zip

logger = get_logger("extsync.worker.pipeline")


def _limits() -> Limits:
    return Limits(
        max_extracted_bytes=settings.max_extracted_bytes,
        max_file_count=settings.max_file_count,
        max_dir_depth=settings.max_dir_depth,
    )


async def _previous_permissions(db: AsyncSession, release: Release) -> dict | None:
    prev = await db.scalar(
        select(Release)
        .where(
            Release.project_id == release.project_id,
            Release.channel == release.channel,
            Release.status == ReleaseStatus.published,
            Release.id != release.id,
        )
        .order_by(Release.sequence.desc())
        .limit(1)
    )
    if prev is None:
        return None
    snap = await db.scalar(
        select(ReleasePermissionSnapshot).where(
            ReleasePermissionSnapshot.release_id == prev.id
        )
    )
    if snap is None:
        return None
    return {
        "permissions": snap.permissions,
        "hostPermissions": snap.host_permissions,
        "optionalPermissions": snap.optional_permissions,
    }


async def _fail(db: AsyncSession, release: Release, code: str, message: str) -> None:
    release.status = ReleaseStatus.validation_failed
    report = release.validation_report or {}
    report.setdefault("errors", []).append({"code": code, "severity": "error", "message": message})
    release.validation_report = report
    await notify_owner(
        db, release.project_id, NotificationKind.release_validation_failed,
        title="הבדיקה נכשלה",
        body=f"גרסה {release.version} לא עברה את הבדיקה: {message}",
        data={"releaseId": release.id},
    )
    await emit_event(db, release.project_id, "release.validation_failed",
                     {"releaseId": release.id, "version": release.version, "error": code})


async def process_validation_job(db: AsyncSession, release_id: str) -> str:
    """Validate an uploaded release and produce the immutable artifact.

    Returns the resulting status string. Safe to call more than once.
    """
    release = await db.get(Release, release_id)
    if release is None:
        logger.warning("validation job for unknown release %s", release_id)
        return "missing"
    if release.status not in (ReleaseStatus.uploaded, ReleaseStatus.validating):
        return release.status.value  # already processed -> idempotent no-op

    release.status = ReleaseStatus.validating
    await db.flush()

    original = await db.scalar(
        select(ReleaseArtifact).where(
            ReleaseArtifact.release_id == release.id, ReleaseArtifact.kind == "original"
        )
    )
    if original is None:
        await _fail(db, release, "INVALID_ARCHIVE", "לא נמצאה חבילת מקור")
        return release.status.value

    raw = await asyncio.to_thread(storage.get_bytes, original.s3_bucket, original.s3_key)

    result = validate_extension_zip(raw, _limits())
    release.validation_report = result.to_report()
    release.risk_score = result.risk_score

    if not result.ok:
        await _fail(db, release, "INVALID_MANIFEST", "החבילה לא עברה את בדיקות האבטחה")
        return release.status.value

    if result.manifest.version and result.manifest.version != release.version:
        await _fail(
            db, release, "VERSION_MISMATCH",
            f"גרסת ה-manifest ({result.manifest.version}) שונה מגרסת ההפצה ({release.version})",
        )
        return release.status.value

    # Permission diff vs the previous published release in this channel.
    current_perms = result.permissions.to_dict()
    previous_perms = await _previous_permissions(db, release)
    pdiff = diff_permissions(previous_perms, current_perms)

    snapshot = ReleasePermissionSnapshot(
        release_id=release.id,
        permissions=result.permissions.permissions,
        optional_permissions=result.permissions.optional_permissions,
        host_permissions=result.permissions.host_permissions,
        optional_host_permissions=result.permissions.optional_host_permissions,
        content_scripts_matches=result.permissions.content_scripts_matches,
        externally_connectable=result.permissions.externally_connectable,
        uses_native_messaging=result.permissions.uses_native_messaging,
        web_accessible_resources=result.permissions.web_accessible_resources,
        diff_added={
            "permissions": pdiff.added_permissions,
            "hosts": pdiff.added_hosts,
            "nativeMessaging": pdiff.added_native_messaging,
        },
        diff_removed={
            "permissions": pdiff.removed_permissions,
            "hosts": pdiff.removed_hosts,
        },
        risk_level=pdiff.risk_level,
    )
    db.add(snapshot)
    release.permissions_changed = permissions_changed(previous_perms, current_perms)
    release.requires_user_approval = pdiff.requires_user_approval

    # Build the immutable, signed-key-injected artifact.
    project_key = await db.scalar(
        select(ProjectKey).where(ProjectKey.project_id == release.project_id)
    )
    if project_key is None:
        await _fail(db, release, "INTERNAL", "חסר מפתח פרויקט")
        return release.status.value

    artifact_bytes, artifact_sha = inject_manifest_key(raw, project_key.public_key_b64)
    key = artifact_key(release.project_id, release.id)
    await asyncio.to_thread(
        storage.put_bytes, settings.s3_bucket_artifacts, key, artifact_bytes, "application/zip"
    )
    db.add(ReleaseArtifact(
        release_id=release.id, kind="validated",
        s3_bucket=settings.s3_bucket_artifacts, s3_key=key,
        size=len(artifact_bytes), sha256=artifact_sha,
        file_count=result.file_count,
    ))

    release.status = ReleaseStatus.ready
    await notify_owner(
        db, release.project_id, NotificationKind.release_validated,
        title="הגרסה עברה בדיקה",
        body=f"גרסה {release.version} מוכנה לפרסום.",
        data={"releaseId": release.id, "requiresApproval": pdiff.requires_user_approval},
    )
    await emit_event(db, release.project_id, "release.validated",
                     {"releaseId": release.id, "version": release.version,
                      "permissionsChanged": release.permissions_changed})
    logger.info("release %s validated -> ready (risk=%s)", release.id, result.risk_score)
    return release.status.value
