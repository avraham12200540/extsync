"""Project endpoints (§23)."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, File, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..deps import CurrentUser, DBSession
from ..errors import APIError, ErrorCode, not_found
from ..storage import storage
from ..models.project import Project, ProjectScreenshot
from ..rbac import Permission, effective_project_permissions, global_permissions
from ..schemas.common import OkResponse
from ..schemas.project import ProjectCreate, ProjectResponse, ProjectUpdate, ScreenshotItem
from ..services import project_service as svc
from ..services.authz import load_project_for_user
from ..services.ratelimit import client_ip

router = APIRouter(prefix="/projects", tags=["projects"])


def _to_response(project: Project, perms: set[Permission],
                 screenshots: list[ScreenshotItem] | None = None) -> ProjectResponse:
    data = ProjectResponse.model_validate(project)
    data.permissions = sorted(p.value for p in perms)
    if screenshots is not None:
        data.screenshots = screenshots
    return data


async def _load_screenshots(db: AsyncSession, project_id: str) -> list[ScreenshotItem]:
    rows = await db.scalars(
        select(ProjectScreenshot)
        .where(ProjectScreenshot.project_id == project_id)
        .order_by(ProjectScreenshot.position, ProjectScreenshot.created_at)
    )
    return [ScreenshotItem(id=r.id, url=r.url, position=r.position) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ProjectResponse)
async def create_project(req: ProjectCreate, request: Request, user: CurrentUser, db: DBSession) -> ProjectResponse:
    if Permission.PROJECT_CREATE not in global_permissions(user.role):
        from ..errors import forbidden
        raise forbidden("נדרש חשבון מפתח כדי ליצור פרויקט")
    project = await svc.create_project(db, user, req, ip=client_ip(request))
    # Creator is owner -> full permissions.
    perms = effective_project_permissions(user_role=user.role, is_owner=True, team_role=None)
    return _to_response(project, perms)


@router.get("", response_model=list[ProjectResponse])
async def list_projects(user: CurrentUser, db: DBSession) -> list[ProjectResponse]:
    projects = await svc.list_projects_for_user(db, user)
    out: list[ProjectResponse] = []
    for p in projects:
        is_owner = p.owner_user_id == user.id
        perms = effective_project_permissions(user_role=user.role, is_owner=is_owner, team_role=None)
        out.append(_to_response(p, perms))
    return out


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, user: CurrentUser, db: DBSession) -> ProjectResponse:
    project, perms = await load_project_for_user(db, project_id, user, Permission.PROJECT_READ)
    return _to_response(project, perms, await _load_screenshots(db, project.id))


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, req: ProjectUpdate, request: Request,
                         user: CurrentUser, db: DBSession) -> ProjectResponse:
    project, perms = await load_project_for_user(db, project_id, user, Permission.PROJECT_UPDATE)
    project = await svc.update_project(db, project, req, user=user, ip=client_ip(request))
    return _to_response(project, perms)


@router.delete("/{project_id}", response_model=OkResponse)
async def delete_project(project_id: str, request: Request, user: CurrentUser, db: DBSession) -> OkResponse:
    project, _ = await load_project_for_user(db, project_id, user, Permission.PROJECT_DELETE)
    await svc.delete_project(db, project, user=user, ip=client_ip(request))
    return OkResponse()


_ICON_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg"}


@router.post("/{project_id}/icon", response_model=ProjectResponse)
async def upload_icon(project_id: str, user: CurrentUser, db: DBSession,
                      file: UploadFile = File(...)) -> ProjectResponse:
    """Optional store image for the extension (shown on its catalog card)."""
    project, perms = await load_project_for_user(db, project_id, user, Permission.PROJECT_UPDATE)
    ext = _ICON_TYPES.get(file.content_type or "")
    if ext is None:
        raise APIError(ErrorCode.VALIDATION_ERROR, "פורמט תמונה לא נתמך (PNG/JPG/WebP/SVG)", status_code=422)
    data = await file.read()
    if len(data) > 2 * 1024 * 1024:
        raise APIError(ErrorCode.VALIDATION_ERROR, "התמונה גדולה מ-2MB", status_code=413)
    key = f"icons/{project.id}.{ext}"
    await asyncio.to_thread(storage.put_bytes, settings.s3_bucket_artifacts, key, data,
                            file.content_type or "image/png")
    project.icon_url = storage.public_url(settings.s3_bucket_artifacts, key)
    await db.commit()
    return _to_response(project, perms)


_SHOT_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
_MAX_SCREENSHOTS = 10


@router.post("/{project_id}/screenshots", response_model=ProjectResponse)
async def add_screenshot(project_id: str, user: CurrentUser, db: DBSession,
                         file: UploadFile = File(...)) -> ProjectResponse:
    """Add a promo/preview image (shown on the public detail page). Up to 10."""
    project, perms = await load_project_for_user(db, project_id, user, Permission.PROJECT_UPDATE)
    ext = _SHOT_TYPES.get(file.content_type or "")
    if ext is None:
        raise APIError(ErrorCode.VALIDATION_ERROR, "פורמט תמונה לא נתמך (PNG/JPG/WebP)", status_code=422)
    existing = await _load_screenshots(db, project.id)
    if len(existing) >= _MAX_SCREENSHOTS:
        raise APIError(ErrorCode.VALIDATION_ERROR,
                       f"אפשר עד {_MAX_SCREENSHOTS} תמונות לתוסף", status_code=422)
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise APIError(ErrorCode.VALIDATION_ERROR, "התמונה גדולה מ-5MB", status_code=413)
    shot = ProjectScreenshot(project_id=project.id, position=len(existing))
    db.add(shot)
    await db.flush()  # assign shot.id before building the storage key
    key = f"screenshots/{project.id}/{shot.id}.{ext}"
    await asyncio.to_thread(storage.put_bytes, settings.s3_bucket_artifacts, key, data,
                            file.content_type or "image/png")
    shot.url = storage.public_url(settings.s3_bucket_artifacts, key)
    await db.commit()
    return _to_response(project, perms, await _load_screenshots(db, project.id))


@router.delete("/{project_id}/screenshots/{screenshot_id}", response_model=ProjectResponse)
async def delete_screenshot(project_id: str, screenshot_id: str,
                            user: CurrentUser, db: DBSession) -> ProjectResponse:
    project, perms = await load_project_for_user(db, project_id, user, Permission.PROJECT_UPDATE)
    shot = await db.get(ProjectScreenshot, screenshot_id)
    if shot is None or shot.project_id != project.id:
        raise not_found("התמונה לא נמצאה")
    await db.delete(shot)
    await db.commit()
    return _to_response(project, perms, await _load_screenshots(db, project.id))
