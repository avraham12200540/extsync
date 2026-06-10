"""Developer analytics: per-project stats + overview dashboard (§21)."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Query
from sqlalchemy import Date, cast, func, select

from ..deps import CurrentUser, DBSession
from ..models.audit import AuditEvent
from ..models.device import Installation, UpdateAttempt
from ..models.enums import InstallationStatus, UpdateAttemptStatus
from ..rbac import Permission
from ..services.authz import load_project_for_user
from ..services.project_service import list_projects_for_user

router = APIRouter(tags=["analytics"])


def _since_24h() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)


async def _project_stats(db: DBSession, project_id: str) -> dict:
    active = await db.scalar(
        select(func.count()).select_from(Installation).where(
            Installation.project_id == project_id,
            Installation.status != InstallationStatus.removed,
        )
    ) or 0

    # Update attempts in the last 24h, grouped by status.
    rows = (await db.execute(
        select(UpdateAttempt.status, func.count())
        .select_from(UpdateAttempt)
        .join(Installation, UpdateAttempt.installation_id == Installation.id)
        .where(Installation.project_id == project_id, UpdateAttempt.created_at >= _since_24h())
        .group_by(UpdateAttempt.status)
    )).all()
    by_status = {str(s): c for s, c in rows}
    success = by_status.get(UpdateAttemptStatus.success.value, 0)
    failed = by_status.get(UpdateAttemptStatus.failed.value, 0)
    rolled = by_status.get(UpdateAttemptStatus.rolled_back.value, 0)

    # Version distribution.
    ver_rows = (await db.execute(
        select(Installation.current_version, func.count())
        .where(Installation.project_id == project_id,
               Installation.status != InstallationStatus.removed)
        .group_by(Installation.current_version)
    )).all()
    version_distribution = {(v or "unknown"): c for v, c in ver_rows}

    # Channel distribution.
    ch_rows = (await db.execute(
        select(Installation.channel, func.count())
        .where(Installation.project_id == project_id,
               Installation.status != InstallationStatus.removed)
        .group_by(Installation.channel)
    )).all()
    channel_distribution = {str(c): n for c, n in ch_rows}

    return {
        "activeInstallations": active,
        "updates24h": {"success": success, "failed": failed, "rolledBack": rolled},
        "versionDistribution": version_distribution,
        "channelDistribution": channel_distribution,
    }


async def _timeseries(db: DBSession, project_ids: list[str], days: int) -> list[dict]:
    """Per-day counts for the last `days` days: update outcomes + new installs."""
    today = dt.datetime.now(dt.timezone.utc).date()
    start = today - dt.timedelta(days=days - 1)
    empty = {d.isoformat(): {"date": d.isoformat(), "success": 0, "failed": 0, "installs": 0}
             for d in (start + dt.timedelta(days=i) for i in range(days))}
    if not project_ids:
        return list(empty.values())

    upd_day = cast(UpdateAttempt.created_at, Date)
    rows = (await db.execute(
        select(upd_day, UpdateAttempt.status, func.count())
        .join(Installation, UpdateAttempt.installation_id == Installation.id)
        .where(Installation.project_id.in_(project_ids), upd_day >= start)
        .group_by(upd_day, UpdateAttempt.status)
    )).all()
    for day, status, count in rows:
        bucket = empty.get(day.isoformat() if hasattr(day, "isoformat") else str(day))
        if bucket is None:
            continue
        if str(status) == UpdateAttemptStatus.success.value:
            bucket["success"] += count
        elif str(status) in (UpdateAttemptStatus.failed.value, UpdateAttemptStatus.rolled_back.value):
            bucket["failed"] += count

    inst_day = cast(Installation.created_at, Date)
    inst_rows = (await db.execute(
        select(inst_day, func.count())
        .where(Installation.project_id.in_(project_ids), inst_day >= start)
        .group_by(inst_day)
    )).all()
    for day, count in inst_rows:
        bucket = empty.get(day.isoformat() if hasattr(day, "isoformat") else str(day))
        if bucket is not None:
            bucket["installs"] = count

    return list(empty.values())


@router.get("/dashboard/timeseries")
async def dashboard_timeseries(
    user: CurrentUser, db: DBSession, days: int = Query(default=14, ge=7, le=90)
) -> dict:
    projects = await list_projects_for_user(db, user)
    return {"days": await _timeseries(db, [p.id for p in projects], days)}


@router.get("/projects/{project_id}/analytics/timeseries")
async def project_timeseries(
    project_id: str, user: CurrentUser, db: DBSession,
    days: int = Query(default=14, ge=7, le=90),
) -> dict:
    await load_project_for_user(db, project_id, user, Permission.ANALYTICS_READ)
    return {"days": await _timeseries(db, [project_id], days)}


@router.get("/projects/{project_id}/analytics")
async def project_analytics(project_id: str, user: CurrentUser, db: DBSession) -> dict:
    await load_project_for_user(db, project_id, user, Permission.ANALYTICS_READ)
    stats = await _project_stats(db, project_id)
    recent = (await db.scalars(
        select(AuditEvent).where(AuditEvent.project_id == project_id)
        .order_by(AuditEvent.created_at.desc()).limit(20)
    )).all()
    stats["recentEvents"] = [
        {"action": e.action, "actorType": e.actor_type,
         "createdAt": e.created_at.isoformat().replace("+00:00", "Z") if e.created_at else None}
        for e in recent
    ]
    return stats


@router.get("/dashboard")
async def developer_dashboard(user: CurrentUser, db: DBSession) -> dict:
    projects = await list_projects_for_user(db, user)
    project_ids = [p.id for p in projects]
    total_active = 0
    success = failed = rolled = 0
    if project_ids:
        total_active = await db.scalar(
            select(func.count()).select_from(Installation).where(
                Installation.project_id.in_(project_ids),
                Installation.status != InstallationStatus.removed,
            )
        ) or 0
        rows = (await db.execute(
            select(UpdateAttempt.status, func.count())
            .join(Installation, UpdateAttempt.installation_id == Installation.id)
            .where(Installation.project_id.in_(project_ids), UpdateAttempt.created_at >= _since_24h())
            .group_by(UpdateAttempt.status)
        )).all()
        by_status = {str(s): c for s, c in rows}
        success = by_status.get(UpdateAttemptStatus.success.value, 0)
        failed = by_status.get(UpdateAttemptStatus.failed.value, 0)
        rolled = by_status.get(UpdateAttemptStatus.rolled_back.value, 0)

    return {
        "projectCount": len(projects),
        "activeInstallations": total_active,
        "updates24h": {"success": success, "failed": failed, "rolledBack": rolled},
        "projects": [{"id": p.id, "name": p.name, "status": p.status.value,
                      "extensionId": p.extension_id} for p in projects],
    }
