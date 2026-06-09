"""Developer analytics: per-project stats + overview dashboard (§21)."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter
from sqlalchemy import func, select

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
