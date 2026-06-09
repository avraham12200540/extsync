"""Platform admin area (§30). All actions require platform_admin + audit."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select

from ..deps import AdminUser, DBSession
from ..errors import not_found
from ..models.audit import SecurityEvent
from ..models.enums import ProjectStatus, ReleaseStatus
from ..models.project import Project
from ..models.release import Release
from ..models.user import User
from ..redis_client import redis_health_check
from ..schemas.common import CamelModel, OkResponse
from ..storage import storage
from ..services.audit import record_audit

router = APIRouter(prefix="/admin", tags=["admin"])


class SuspendRequest(BaseModel):
    reason: str
    confirm: bool = False  # sensitive actions require explicit confirmation (§30)


def _iso(v) -> str | None:
    return v.isoformat().replace("+00:00", "Z") if v else None


@router.get("/users")
async def list_users(_: AdminUser, db: DBSession, limit: int = 50, offset: int = 0) -> list[dict]:
    rows = (await db.scalars(
        select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
    )).all()
    return [{"id": u.id, "email": u.email, "role": u.role.value,
             "emailVerified": u.email_verified, "suspended": u.is_suspended,
             "createdAt": _iso(u.created_at)} for u in rows]


@router.post("/users/{user_id}/suspend", response_model=OkResponse)
async def suspend_user(user_id: str, req: SuspendRequest, admin: AdminUser, db: DBSession) -> OkResponse:
    if not req.confirm:
        from ..errors import APIError, ErrorCode
        raise APIError(ErrorCode.BAD_REQUEST, "נדרש אישור מפורש (confirm=true)", status_code=400)
    user = await db.get(User, user_id)
    if user is None:
        raise not_found("המשתמש לא נמצא")
    user.is_suspended = True
    await record_audit(db, action="admin.user_suspend", actor_user_id=admin.id, actor_type="admin",
                       target_type="user", target_id=user_id, extra={"reason": req.reason})
    return OkResponse()


@router.get("/projects")
async def list_projects(_: AdminUser, db: DBSession, limit: int = 50, offset: int = 0) -> list[dict]:
    rows = (await db.scalars(
        select(Project).order_by(Project.created_at.desc()).limit(limit).offset(offset)
    )).all()
    return [{"id": p.id, "name": p.name, "slug": p.slug, "status": p.status.value,
             "visibility": p.visibility.value, "ownerUserId": p.owner_user_id,
             "extensionId": p.extension_id, "createdAt": _iso(p.created_at)} for p in rows]


@router.post("/projects/{project_id}/suspend", response_model=OkResponse)
async def suspend_project(project_id: str, req: SuspendRequest, admin: AdminUser, db: DBSession) -> OkResponse:
    if not req.confirm:
        from ..errors import APIError, ErrorCode
        raise APIError(ErrorCode.BAD_REQUEST, "נדרש אישור מפורש (confirm=true)", status_code=400)
    project = await db.get(Project, project_id)
    if project is None:
        raise not_found("הפרויקט לא נמצא")
    project.status = ProjectStatus.suspended
    await record_audit(db, action="admin.project_suspend", actor_user_id=admin.id, actor_type="admin",
                       target_type="project", target_id=project_id, project_id=project_id,
                       extra={"reason": req.reason})
    return OkResponse()


@router.get("/releases")
async def list_releases(_: AdminUser, db: DBSession, limit: int = 50, offset: int = 0) -> list[dict]:
    rows = (await db.scalars(
        select(Release).order_by(Release.created_at.desc()).limit(limit).offset(offset)
    )).all()
    return [{"id": r.id, "projectId": r.project_id, "version": r.version,
             "channel": r.channel.value, "status": r.status.value, "sequence": r.sequence,
             "riskScore": r.risk_score, "createdAt": _iso(r.created_at)} for r in rows]


@router.post("/releases/{release_id}/revoke", response_model=OkResponse)
async def revoke_release(release_id: str, req: SuspendRequest, admin: AdminUser, db: DBSession) -> OkResponse:
    if not req.confirm:
        from ..errors import APIError, ErrorCode
        raise APIError(ErrorCode.BAD_REQUEST, "נדרש אישור מפורש (confirm=true)", status_code=400)
    release = await db.get(Release, release_id)
    if release is None:
        raise not_found("הגרסה לא נמצאה")
    release.status = ReleaseStatus.revoked
    release.revoked_reason = req.reason
    await record_audit(db, action="admin.release_revoke", actor_user_id=admin.id, actor_type="admin",
                       target_type="release", target_id=release_id, project_id=release.project_id,
                       extra={"reason": req.reason})
    return OkResponse()


class AgentVersionCreate(BaseModel):
    version: str
    channel: str = "stable"
    download_url: str
    sha256: str
    signature: str
    key_id: str
    release_notes: str | None = None
    minimum_supported_version: str = "1.0.0"
    required: bool = False
    make_active: bool = True


@router.post("/agent-versions", response_model=OkResponse)
async def publish_agent_version(req: AgentVersionCreate, admin: AdminUser, db: DBSession) -> OkResponse:
    """Publish a signed Agent build for self-update (§28). Never accepts unsigned."""
    from ..models.agent_version import AgentUpdateChannel, AgentVersion

    av = AgentVersion(
        version=req.version, channel=req.channel, download_url=req.download_url,
        sha256=req.sha256, signature=req.signature, key_id=req.key_id,
        release_notes=req.release_notes, minimum_supported_version=req.minimum_supported_version,
        required=req.required, published_at=dt.datetime.now(dt.timezone.utc),
    )
    db.add(av)
    await db.flush()
    if req.make_active:
        ch = await db.scalar(select(AgentUpdateChannel).where(AgentUpdateChannel.channel == req.channel))
        if ch is None:
            ch = AgentUpdateChannel(channel=req.channel)
            db.add(ch)
        ch.active_version_id = av.id
    await record_audit(db, action="admin.agent_version_publish", actor_user_id=admin.id,
                       actor_type="admin", target_type="agent_version", target_id=av.id,
                       extra={"version": req.version, "channel": req.channel})
    return OkResponse()


@router.get("/security-events")
async def security_events(_: AdminUser, db: DBSession, limit: int = 100) -> list[dict]:
    rows = (await db.scalars(
        select(SecurityEvent).order_by(SecurityEvent.created_at.desc()).limit(limit)
    )).all()
    return [{"id": e.id, "type": e.type, "severity": e.severity, "userId": e.user_id,
             "projectId": e.project_id, "deviceId": e.device_id, "message": e.message,
             "createdAt": _iso(e.created_at)} for e in rows]


@router.get("/system-health")
async def system_health(_: AdminUser, db: DBSession) -> dict:
    counts = {
        "users": await db.scalar(select(func.count()).select_from(User)),
        "projects": await db.scalar(select(func.count()).select_from(Project)),
        "releases": await db.scalar(select(func.count()).select_from(Release)),
    }
    try:
        redis_ok = await redis_health_check()
    except Exception:  # noqa: BLE001
        redis_ok = False
    try:
        storage.health_check()
        storage_ok = True
    except Exception:  # noqa: BLE001
        storage_ok = False
    return {"counts": counts, "redis": redis_ok, "storage": storage_ok,
            "time": dt.datetime.now(dt.timezone.utc).isoformat()}
