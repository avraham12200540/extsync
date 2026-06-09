"""Agent-facing domain logic: device registration, updates, reporting (§6, §22)."""
from __future__ import annotations

import datetime as dt

from extsync_release_schema import rollout_bucket
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import APIError, ErrorCode, not_found
from ..ids import device_id as new_device_id
from ..models.device import (
    Device,
    DeviceSession,
    Installation,
    InstallationEvent,
    RolloutAssignment,
    UpdateAttempt,
)
from ..models.enums import (
    Channel,
    DeviceOS,
    InstallationStatus,
    NotificationKind,
    ProjectStatus,
    ReleaseStatus,
    UpdateAttemptStatus,
)
from ..models.install_link import InstallLink
from ..models.project import Project
from ..models.release import ChannelState, Release
from ..models.user import User
from ..security.tokens import new_opaque_token
from ..security.crypto import hash_token
from .audit import record_audit, record_security_event
from .events import emit_event, notify_owner
from .install_link_service import consume_install_link

# Auto-stop thresholds (§22).
AUTO_STOP_MIN_SAMPLE = 8
AUTO_STOP_FAILURE_RATE = 0.4


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _parse_version(v: str | None) -> tuple[int, ...]:
    if not v:
        return (0,)
    try:
        return tuple(int(x) for x in v.split("."))
    except ValueError:
        return (0,)


def version_gte(a: str, b: str) -> bool:
    pa, pb = _parse_version(a), _parse_version(b)
    length = max(len(pa), len(pb))
    pa += (0,) * (length - len(pa))
    pb += (0,) * (length - len(pb))
    return pa >= pb


def _os_enum(value: str | None) -> DeviceOS:
    try:
        return DeviceOS(value) if value else DeviceOS.windows
    except ValueError:
        return DeviceOS.unknown


# --------------------------------------------------------------------------- register
async def register_device(db: AsyncSession, *, anonymous_device_id: str, os: str,
                          os_version: str | None, agent_version: str,
                          agent_public_key: str | None) -> tuple[Device, str]:
    device = await db.scalar(
        select(Device).where(Device.anonymous_device_id == anonymous_device_id)
    )
    if device is None:
        device = Device(id=new_device_id(), anonymous_device_id=anonymous_device_id)
        db.add(device)
    device.os = _os_enum(os)
    device.os_version = os_version
    device.agent_version = agent_version
    if agent_public_key:
        device.agent_public_key_b64 = agent_public_key
    device.last_seen_at = _now()
    await db.flush()

    raw_token = new_opaque_token(40)
    db.add(DeviceSession(
        device_id=device.id, token_hash=hash_token(raw_token),
        expires_at=_now() + dt.timedelta(days=365),
    ))
    await record_audit(db, action="agent.register", actor_type="agent",
                       target_type="device", target_id=device.id)
    return device, raw_token


async def heartbeat(db: AsyncSession, device: Device, agent_version: str) -> None:
    device.last_seen_at = _now()
    device.agent_version = agent_version


# --------------------------------------------------------------------------- install
async def register_extension(db: AsyncSession, device: Device, *, token: str,
                             extension_id: str | None, has_bridge: bool) -> tuple[Installation, dict | None]:
    link = await db.scalar(select(InstallLink).where(InstallLink.token == token))
    if link is None:
        raise not_found("קישור ההתקנה לא נמצא")
    project = await db.get(Project, link.project_id)
    if project is None or project.deleted_at is not None:
        raise not_found("התוסף לא נמצא")
    if project.status == ProjectStatus.suspended:
        raise APIError(ErrorCode.PROJECT_SUSPENDED, "התוסף מושהה", status_code=403)

    user = await db.get(User, device.user_id) if device.user_id else None
    await consume_install_link(db, link, user=user)

    installation = await db.scalar(
        select(Installation).where(
            Installation.device_id == device.id, Installation.project_id == project.id
        )
    )
    if installation is None:
        installation = Installation(
            device_id=device.id, project_id=project.id, channel=link.channel,
            status=InstallationStatus.downloading, install_link_id=link.id,
        )
        db.add(installation)
        await db.flush()
    installation.channel = link.channel
    installation.has_bridge = has_bridge
    installation.extension_id = extension_id or project.extension_id
    installation.status = InstallationStatus.awaiting_manual_load
    installation.last_seen_at = _now()

    metadata = await _active_metadata(db, project.id, link.channel, device)
    db.add(InstallationEvent(installation_id=installation.id, type="register",
                             release_id=(metadata or {}).get("releaseId")))
    await record_audit(db, action="installation.created", actor_type="agent",
                       target_type="installation", target_id=installation.id, project_id=project.id)
    await emit_event(db, project.id, "installation.created",
                     {"installationId": installation.id, "deviceId": device.id})
    await notify_owner(db, project.id, NotificationKind.install_link_used,
                       title="קישור התקנה נוצל",
                       body=f"מכשיר חדש התקין את {project.name}.")
    return installation, metadata


async def unregister_extension(db: AsyncSession, device: Device, *, project_id: str) -> None:
    installation = await db.scalar(
        select(Installation).where(
            Installation.device_id == device.id, Installation.project_id == project_id
        )
    )
    if installation is None:
        return
    installation.status = InstallationStatus.removed
    installation.removed_at = _now()
    db.add(InstallationEvent(installation_id=installation.id, type="unregister"))
    await record_audit(db, action="installation.removed", actor_type="agent",
                       target_type="installation", target_id=installation.id, project_id=project_id)


# --------------------------------------------------------------------------- updates
async def _active_release(db: AsyncSession, project_id: str, channel: Channel) -> tuple[Release | None, ChannelState | None]:
    state = await db.scalar(
        select(ChannelState).where(
            ChannelState.project_id == project_id, ChannelState.channel == channel
        )
    )
    if state is None or state.active_release_id is None or state.is_paused:
        return None, state
    rel = await db.get(Release, state.active_release_id)
    if rel is None or rel.status != ReleaseStatus.published:
        return None, state
    return rel, state


async def _active_metadata(db: AsyncSession, project_id: str, channel: Channel,
                           device: Device) -> dict | None:
    rel, state = await _active_release(db, project_id, channel)
    if rel is None or state is None:
        return None
    if not _eligible(project_id, device.anonymous_device_id, state.rollout_percentage):
        return None
    return rel.signed_metadata


def _eligible(project_id: str, anon_id: str, rollout_pct: int) -> bool:
    return rollout_bucket(project_id, anon_id) < rollout_pct


async def check_updates(db: AsyncSession, device: Device, items: list) -> list[dict]:
    device.last_seen_at = _now()
    updates: list[dict] = []
    for item in items:
        project_id = item.project_id
        channel = item.channel
        rel, state = await _active_release(db, project_id, channel)
        if rel is None or state is None:
            updates.append({"projectId": project_id, "available": False, "reason": "no_active_release"})
            continue

        # Deterministic rollout bucket (stable per project+device).
        bucket = rollout_bucket(project_id, device.anonymous_device_id)
        await _remember_bucket(db, project_id, channel, device.id, bucket)
        if bucket >= state.rollout_percentage:
            updates.append({"projectId": project_id, "available": False, "reason": "rollout"})
            continue

        # Already up to date?
        current_seq = item.current_sequence or 0
        if rel.sequence is not None and rel.sequence <= current_seq:
            updates.append({"projectId": project_id, "available": False, "reason": "up_to_date"})
            continue

        # Agent version gate.
        if not version_gte(device.agent_version, rel.minimum_agent_version):
            updates.append({"projectId": project_id, "available": False,
                            "reason": ErrorCode.AGENT_UPDATE_REQUIRED.value})
            continue

        updates.append({"projectId": project_id, "available": True, "metadata": rel.signed_metadata})
    return updates


async def _remember_bucket(db: AsyncSession, project_id: str, channel: Channel,
                           device_id: str, bucket: int) -> None:
    existing = await db.scalar(
        select(RolloutAssignment).where(
            RolloutAssignment.project_id == project_id,
            RolloutAssignment.channel == channel,
            RolloutAssignment.device_id == device_id,
        )
    )
    if existing is None:
        db.add(RolloutAssignment(project_id=project_id, channel=channel,
                                 device_id=device_id, bucket=bucket))


async def get_release_metadata(db: AsyncSession, release_id: str) -> dict:
    rel = await db.get(Release, release_id)
    if rel is None or rel.signed_metadata is None or rel.status not in (
        ReleaseStatus.published, ReleaseStatus.paused, ReleaseStatus.superseded
    ):
        raise not_found("מטא-דאטה של הגרסה לא נמצאה")
    return rel.signed_metadata


# --------------------------------------------------------------------------- report
async def report_update(db: AsyncSession, device: Device, *, project_id: str, release_id: str,
                        idempotency_key: str, from_version: str | None, to_version: str,
                        status: UpdateAttemptStatus, error_code: str | None,
                        error_detail: str | None, reload_completed: bool,
                        new_status: InstallationStatus | None) -> UpdateAttempt:
    installation = await db.scalar(
        select(Installation).where(
            Installation.device_id == device.id, Installation.project_id == project_id
        )
    )
    if installation is None:
        raise not_found("התקנה לא נמצאה")

    # Idempotent: same (installation, idempotency_key) returns the existing attempt.
    existing = await db.scalar(
        select(UpdateAttempt).where(
            UpdateAttempt.installation_id == installation.id,
            UpdateAttempt.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        return existing

    attempt = UpdateAttempt(
        installation_id=installation.id, release_id=release_id, idempotency_key=idempotency_key,
        from_version=from_version, to_version=to_version, status=status,
        error_code=error_code, error_detail=error_detail, reload_completed=reload_completed,
        started_at=_now(), finished_at=_now(),
    )
    db.add(attempt)
    installation.last_seen_at = _now()

    if status == UpdateAttemptStatus.success:
        installation.current_release_id = release_id
        installation.current_version = to_version
        installation.status = new_status or (
            InstallationStatus.up_to_date if reload_completed else InstallationStatus.reload_required
        )
        await emit_event(db, project_id, "installation.updated",
                         {"installationId": installation.id, "version": to_version})
    elif status in (UpdateAttemptStatus.failed, UpdateAttemptStatus.rolled_back):
        installation.status = new_status or InstallationStatus.broken
        await emit_event(db, project_id, "installation.failed",
                         {"installationId": installation.id, "errorCode": error_code})
        await _check_auto_stop(db, project_id, release_id)

    db.add(InstallationEvent(
        installation_id=installation.id, type="update", release_id=release_id,
        status=status.value, error_code=error_code,
    ))
    return attempt


async def _check_auto_stop(db: AsyncSession, project_id: str, release_id: str) -> None:
    """Pause the channel automatically if the failure rate is too high (§22)."""
    # Ensure the just-added attempt is counted (sessions use autoflush=False).
    await db.flush()
    release = await db.get(Release, release_id)
    if release is None or release.status != ReleaseStatus.published:
        return
    total = await db.scalar(
        select(func.count()).select_from(UpdateAttempt).where(UpdateAttempt.release_id == release_id)
    ) or 0
    if total < AUTO_STOP_MIN_SAMPLE:
        return
    failed = await db.scalar(
        select(func.count()).select_from(UpdateAttempt).where(
            UpdateAttempt.release_id == release_id,
            UpdateAttempt.status.in_([UpdateAttemptStatus.failed, UpdateAttemptStatus.rolled_back]),
        )
    ) or 0
    if failed / total < AUTO_STOP_FAILURE_RATE:
        return

    state = await db.scalar(
        select(ChannelState).where(
            ChannelState.project_id == project_id, ChannelState.channel == release.channel
        )
    )
    if state is not None and state.active_release_id == release_id and not state.is_paused:
        state.is_paused = True
        release.status = ReleaseStatus.paused
        await record_security_event(
            db, type="rollout_auto_stopped", severity="warning", project_id=project_id,
            message=f"Rollout auto-stopped: failure rate {failed}/{total}",
            detail={"releaseId": release_id, "failed": failed, "total": total},
        )
        await record_audit(db, action="rollout.auto_stop", actor_type="system",
                           target_type="release", target_id=release_id, project_id=project_id)
        await notify_owner(db, project_id, NotificationKind.rollout_paused,
                           title="ההפצה נעצרה אוטומטית",
                           body=f"שיעור הכשלים בגרסה גבוה ({failed}/{total}). ההפצה הושהתה.",
                           data={"releaseId": release_id})
        await emit_event(db, project_id, "rollout.paused",
                         {"releaseId": release_id, "failed": failed, "total": total})
