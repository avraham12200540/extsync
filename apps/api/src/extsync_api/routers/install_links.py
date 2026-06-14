"""Install link endpoints (§23). The resolve endpoint is public."""
from __future__ import annotations

from fastapi import APIRouter, Request, status

from ..config import settings
from ..deps import CurrentUser, DBSession
from ..models.base import utcnow
from ..rbac import Permission
from ..schemas.common import OkResponse
from ..schemas.install_link import (
    InstallLinkCreate,
    InstallLinkResponse,
    InstallLinkUpdate,
    InstallPageResolve,
)
from ..services import install_link_service as svc
from ..services.authz import load_project_for_user
from ..services.ratelimit import client_ip, enforce_rate_limit
from ..models.install_link import InstallLink

router = APIRouter(tags=["install-links"])


def _response(link: InstallLink) -> InstallLinkResponse:
    return InstallLinkResponse(
        id=link.id, project_id=link.project_id, token=link.token,
        url=svc.install_link_url(link.token), label=link.label, link_type=link.link_type,
        channel=link.channel, max_uses=link.max_uses, used_count=link.used_count,
        expires_at=link.expires_at.isoformat().replace("+00:00", "Z") if link.expires_at else None,
        requires_account=link.requires_account, allowed_email_domain=link.allowed_email_domain,
        disabled=link.disabled_at is not None,
    )


@router.post("/projects/{project_id}/install-links", status_code=status.HTTP_201_CREATED,
             response_model=InstallLinkResponse)
async def create_link(project_id: str, req: InstallLinkCreate, user: CurrentUser, db: DBSession) -> InstallLinkResponse:
    project, _ = await load_project_for_user(db, project_id, user, Permission.INSTALL_LINK_CREATE)
    link = await svc.create_install_link(db, project, req, user=user)
    await db.flush()
    return _response(link)


@router.get("/projects/{project_id}/install-links", response_model=list[InstallLinkResponse])
async def list_links(project_id: str, user: CurrentUser, db: DBSession) -> list[InstallLinkResponse]:
    await load_project_for_user(db, project_id, user, Permission.PROJECT_READ)
    from sqlalchemy import select

    links = (await db.scalars(
        select(InstallLink).where(InstallLink.project_id == project_id).order_by(InstallLink.created_at.desc())
    )).all()
    return [_response(link) for link in links]


@router.patch("/projects/{project_id}/install-links/{link_id}", response_model=InstallLinkResponse)
async def update_link(project_id: str, link_id: str, req: InstallLinkUpdate,
                      user: CurrentUser, db: DBSession) -> InstallLinkResponse:
    await load_project_for_user(db, project_id, user, Permission.INSTALL_LINK_DISABLE)
    link = await db.get(InstallLink, link_id)
    if link is None or link.project_id != project_id:
        from ..errors import not_found
        raise not_found("הקישור לא נמצא")
    if req.label is not None:
        link.label = req.label
    if req.max_uses is not None:
        link.max_uses = req.max_uses
    if req.expires_at is not None:
        link.expires_at = req.expires_at
    if req.disabled is not None:
        link.disabled_at = utcnow() if req.disabled else None
    return _response(link)


@router.delete("/projects/{project_id}/install-links/{link_id}", response_model=OkResponse)
async def delete_link(project_id: str, link_id: str, user: CurrentUser, db: DBSession) -> OkResponse:
    await load_project_for_user(db, project_id, user, Permission.INSTALL_LINK_DISABLE)
    link = await db.get(InstallLink, link_id)
    if link is not None and link.project_id == project_id:
        await db.delete(link)
    return OkResponse()


@router.post("/install-links/{token}/resolve", response_model=InstallPageResolve)
async def resolve_link(token: str, request: Request, db: DBSession) -> InstallPageResolve:
    # Public endpoint — no auth. Powers the install page; capped per-IP so the
    # unauthenticated resolve (several SELECTs each) can't be hammered.
    await enforce_rate_limit(f"install-resolve:{client_ip(request)}",
                             limit=settings.rate_limit_install_resolve_per_min, window_seconds=60)
    return await svc.resolve_install_link(db, token)
