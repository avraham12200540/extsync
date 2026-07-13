"""The user's extension library (/me/extensions) + bulk install-batch flow.

Library rows are added automatically by the web when a LOGGED-IN user clicks
install in the store. "Install all on a new computer" mints a short-lived
signed batch token, the site opens extsync://install-batch?token=..., and the
Agent posts it back to /install-batches/resolve to get one public install-link
token per extension - each then flows through the Agent's existing
resolve + register-extension machinery, one item at a time.
"""
from __future__ import annotations

import datetime as dt

import jwt
from fastapi import APIRouter, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..config import settings
from ..deps import CurrentUser, DBSession
from ..errors import APIError, ErrorCode, not_found
from ..ids import secret_token
from ..models.enums import Channel, InstallLinkType, ProjectStatus, ProjectVisibility
from ..models.install_link import InstallLink
from ..models.project import Project
from ..models.user import User
from ..models.user_extension import UserExtension
from ..schemas.common import OkResponse
from ..schemas.user_extensions import (
    InstallBatchItem,
    InstallBatchResolveRequest,
    InstallBatchResolveResponse,
    InstallBatchResponse,
    LibraryAddRequest,
    LibraryItem,
)
from ..services.ratelimit import client_ip, enforce_rate_limit
from .catalog import _developer_name, _latest_release

router = APIRouter(tags=["me-extensions"])

_BATCH_TYP = "install_batch"
_BATCH_TTL_HOURS = 24


def _is_public(project: Project | None) -> bool:
    return (
        project is not None
        and project.visibility == ProjectVisibility.public
        and project.status == ProjectStatus.active
        and project.deleted_at is None
    )


async def _library_projects(db, user_id: str) -> list[Project]:
    """The user's library projects, newest first (missing projects skipped)."""
    rows = (await db.scalars(
        select(UserExtension).where(UserExtension.user_id == user_id)
        .order_by(UserExtension.created_at.desc())
    )).all()
    projects: list[Project] = []
    for row in rows:
        project = await db.get(Project, row.project_id)
        if project is not None:
            projects.append(project)
    return projects


async def _public_install_link(db, project: Project) -> InstallLink | None:
    """A usable PUBLIC install link for a public project, auto-created if the
    developer never made one. Only public+usable links qualify - we must never
    hand a restricted/secret/one-time link (minted for a specific customer) to
    every library user, nor burn its quota; if the only links are restricted or
    exhausted we mint a fresh public one, like the store detail page."""
    if not _is_public(project):
        return None
    links = (await db.scalars(
        select(InstallLink).where(
            InstallLink.project_id == project.id,
            InstallLink.link_type == InstallLinkType.public,
            InstallLink.disabled_at.is_(None),
        ).order_by(InstallLink.created_at.asc())
    )).all()
    link = next((l for l in links if l.is_usable()[0]), None)
    if link is None:
        if await _latest_release(db, project.id) is None:
            return None  # nothing published - not installable
        link = InstallLink(
            project_id=project.id,
            token=secret_token(32),
            label="התקנה מהחנות",
            link_type=InstallLinkType.public,
            channel=Channel.stable,
            created_by_user_id=project.owner_user_id,
        )
        db.add(link)
        await db.flush()
    return link


@router.get("/me/extensions", response_model=list[LibraryItem])
async def list_library(user: CurrentUser, db: DBSession) -> list[LibraryItem]:
    items: list[LibraryItem] = []
    for project in await _library_projects(db, user.id):
        items.append(LibraryItem(
            project_id=project.id, slug=project.slug, name=project.name,
            icon_url=project.icon_url,
            developer_name=await _developer_name(db, project.owner_user_id),
            available=_is_public(project),
        ))
    return items


@router.post("/me/extensions", status_code=status.HTTP_201_CREATED, response_model=OkResponse)
async def add_to_library(req: LibraryAddRequest, user: CurrentUser, db: DBSession) -> OkResponse:
    project = await db.scalar(select(Project).where(Project.slug == req.slug))
    if not _is_public(project):
        raise not_found("התוסף לא נמצא")
    existing = await db.scalar(select(UserExtension).where(
        UserExtension.user_id == user.id, UserExtension.project_id == project.id
    ))
    if existing is None:
        db.add(UserExtension(user_id=user.id, project_id=project.id))
        try:
            await db.commit()
        except IntegrityError:
            # A concurrent request already added this (user, project) - the
            # unique constraint makes the double-add a no-op, not a 500.
            await db.rollback()
    return OkResponse()


@router.delete("/me/extensions/{project_id}", response_model=OkResponse)
async def remove_from_library(project_id: str, user: CurrentUser, db: DBSession) -> OkResponse:
    row = await db.scalar(select(UserExtension).where(
        UserExtension.user_id == user.id, UserExtension.project_id == project_id
    ))
    if row is not None:
        await db.delete(row)
        await db.commit()
    return OkResponse()


@router.post("/me/extensions/install-batch", response_model=InstallBatchResponse)
async def create_install_batch(user: CurrentUser, db: DBSession) -> InstallBatchResponse:
    available = [p for p in await _library_projects(db, user.id) if _is_public(p)]
    if not available:
        raise APIError(ErrorCode.NOT_FOUND, "אין תוספים זמינים בספרייה", status_code=404)
    now = dt.datetime.now(dt.timezone.utc)
    token = jwt.encode(
        {"sub": user.id, "typ": _BATCH_TYP, "iat": int(now.timestamp()),
         "exp": int((now + dt.timedelta(hours=_BATCH_TTL_HOURS)).timestamp())},
        settings.jwt_secret, algorithm="HS256",
    )
    return InstallBatchResponse(uri=f"extsync://install-batch?token={token}", count=len(available))


@router.post("/install-batches/resolve", response_model=InstallBatchResolveResponse)
async def resolve_install_batch(
    req: InstallBatchResolveRequest, request: Request, db: DBSession
) -> InstallBatchResolveResponse:
    # Anonymous (the Agent has no user session) - the signed token IS the auth.
    # Same per-IP cap as the public install-link resolve.
    await enforce_rate_limit(f"batch-resolve:{client_ip(request)}",
                             limit=settings.rate_limit_install_resolve_per_min, window_seconds=60)
    try:
        claims = jwt.decode(req.token, settings.jwt_secret, algorithms=["HS256"],
                            options={"require": ["exp", "sub"]})
    except jwt.PyJWTError as exc:
        raise APIError(ErrorCode.INVALID_TOKEN, "אסימון ההתקנה אינו תקין או שפג תוקפו",
                       status_code=401) from exc
    if claims.get("typ") != _BATCH_TYP:
        raise APIError(ErrorCode.INVALID_TOKEN, "אסימון התקנה שגוי", status_code=401)

    # The token is long-lived (24h) and has no jti, so re-check the account the
    # same way every other auth path does - a deleted/suspended user's batch
    # token must stop working immediately.
    account = await db.get(User, claims["sub"])
    if account is None or not account.is_active or account.is_suspended:
        raise APIError(ErrorCode.INVALID_TOKEN, "החשבון אינו פעיל", status_code=401)

    items: list[InstallBatchItem] = []
    for project in await _library_projects(db, claims["sub"]):
        link = await _public_install_link(db, project)
        if link is not None:
            items.append(InstallBatchItem(project_id=project.id, name=project.name, token=link.token))
    await db.commit()
    return InstallBatchResolveResponse(items=items)
