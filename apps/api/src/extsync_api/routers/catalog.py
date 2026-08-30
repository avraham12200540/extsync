"""Public extension catalog ("store") — browse + direct download, no auth (§16, §19).

Only shows PUBLIC projects that have a published release. Returns a direct,
stable artifact URL so end users can download the ZIP manually, plus the
extsync:// install URI for the managed (auto-updating) install path.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import CurrentUser, OptionalUser
from ..errors import not_found
from ..ids import secret_token
from ..models.device import Installation
from ..models.enums import Channel, InstallationStatus, InstallLinkType
from ..models.install_link import InstallLink
from ..models.project import Project, ProjectScreenshot
from ..models.rating import ProjectRating
from ..models.release import ChannelState, Release, ReleasePermissionSnapshot
from ..models.user import User
from ..schemas.common import CamelModel, OkResponse
from ..services.ratelimit import client_ip, enforce_rate_limit
from typing import Annotated
from fastapi import Depends
from ..services.artifact_publication import public_artifact, public_download_url
from ..services.availability import (
    public_project_clause,
    public_release_clause,
    release_is_publicly_available,
)

router = APIRouter(prefix="/catalog", tags=["catalog"])
DBSession = Annotated[AsyncSession, Depends(get_session)]


class CatalogItem(CamelModel):
    slug: str
    name: str
    short_description: str
    icon_url: str | None = None
    developer_name: str
    extension_id: str | None = None
    latest_version: str | None = None
    category: str | None = None
    published_at: str | None = None
    installs: int = 0            # registered installs (Agent) only
    downloads: int = 0          # every acquisition, incl. the site's ZIP button
    avg_rating: float = 0
    ratings_count: int = 0
    my_rating: int | None = None


class RateRequest(CamelModel):
    stars: int = Field(ge=1, le=5)


class CatalogChannelInfo(CamelModel):
    channel: Channel
    version: str
    release_id: str
    published_at: str | None = None
    download_url: str | None = None      # direct ZIP (manual download)
    size: int | None = None
    sha256: str | None = None
    release_notes: str | None = None     # developer's "what's new" line


class CatalogDetail(CamelModel):
    slug: str
    name: str
    short_description: str
    full_description: str | None = None
    icon_url: str | None = None
    developer_name: str
    website: str | None = None
    repo_url: str | None = None
    privacy_policy_url: str | None = None
    extension_id: str | None = None
    category: str | None = None
    installs: int = 0            # registered installs (Agent) only
    downloads: int = 0          # every acquisition, incl. the site's ZIP button
    screenshots: list[str] = []      # promo/preview image URLs, ordered
    channels: list[CatalogChannelInfo] = []
    permissions: list[str] = []
    host_permissions: list[str] = []
    uses_native_messaging: bool = False
    install_uri: str | None = None       # extsync://install?token=... (managed install)
    avg_rating: float = 0
    ratings_count: int = 0
    my_rating: int | None = None


def _iso(v) -> str | None:
    return v.isoformat().replace("+00:00", "Z") if v else None


async def _developer_name(db: AsyncSession, owner_user_id: str) -> str:
    # Public publisher name in the store = the developer's display name.
    # org_name is registration-only metadata and is intentionally NOT shown.
    user = await db.get(User, owner_user_id)
    return (user.display_name.strip() if user and user.display_name else "") or "מפתח ExtSync"


async def _ratings_map(db: AsyncSession, project_ids: list[str]) -> dict[str, tuple[float, int]]:
    if not project_ids:
        return {}
    rows = (await db.execute(
        select(ProjectRating.project_id, func.avg(ProjectRating.stars), func.count())
        .where(ProjectRating.project_id.in_(project_ids))
        .group_by(ProjectRating.project_id)
    )).all()
    return {pid: (round(float(avg), 2), int(cnt)) for pid, avg, cnt in rows}


async def _installs_map(db: AsyncSession, project_ids: list[str]) -> dict[str, int]:
    """Active (non-removed) installation count per project - store social proof."""
    if not project_ids:
        return {}
    rows = (await db.execute(
        select(Installation.project_id, func.count())
        .where(
            Installation.project_id.in_(project_ids),
            Installation.status != InstallationStatus.removed,
        )
        .group_by(Installation.project_id)
    )).all()
    return {pid: int(n) for pid, n in rows}


async def _my_ratings(db: AsyncSession, user_id: str | None, project_ids: list[str]) -> dict[str, int]:
    if not user_id or not project_ids:
        return {}
    rows = (await db.execute(
        select(ProjectRating.project_id, ProjectRating.stars)
        .where(ProjectRating.user_id == user_id, ProjectRating.project_id.in_(project_ids))
    )).all()
    return dict(rows)


@router.get("", response_model=list[CatalogItem])
async def list_catalog(request: Request, db: DBSession, user: OptionalUser, q: str | None = None,
                       category: str | None = None) -> list[CatalogItem]:
    await enforce_rate_limit(f"catalog:{client_ip(request)}", limit=120, window_seconds=60)
    # A project is listed only if it has an active channel pointing at a release
    # that is ACTUALLY publicly available - published AND cleared by an
    # administrator. Listing an extension is itself publication, so a project
    # whose only release is awaiting review does not appear in the store at all.
    stmt = (
        select(Project)
        .join(ChannelState, ChannelState.project_id == Project.id)
        .join(Release, Release.id == ChannelState.active_release_id)
        .where(public_project_clause(), public_release_clause())
        .distinct()
        .order_by(Project.updated_at.desc())
    )
    if category:
        stmt = stmt.where(Project.category == category)
    projects = (await db.scalars(stmt)).all()
    if q:
        ql = q.lower()
        projects = [p for p in projects if ql in p.name.lower() or ql in (p.short_description or "").lower()]

    ids = [p.id for p in projects]
    ratings = await _ratings_map(db, ids)
    installs = await _installs_map(db, ids)
    mine = await _my_ratings(db, user.id if user else None, ids)

    items: list[CatalogItem] = []
    for p in projects:
        # latest stable (or any) published release version
        rel = await _latest_release(db, p.id)
        avg, cnt = ratings.get(p.id, (0.0, 0))
        items.append(CatalogItem(
            slug=p.slug, name=p.name, short_description=p.short_description,
            icon_url=p.icon_url, developer_name=await _developer_name(db, p.owner_user_id),
            extension_id=p.extension_id, latest_version=rel.version if rel else None,
            category=p.category, published_at=_iso(rel.published_at) if rel else None,
            installs=installs.get(p.id, 0),
            downloads=p.download_count or 0,
            avg_rating=avg, ratings_count=cnt, my_rating=mine.get(p.id),
        ))
    # Ranked purely by active install count (the single ranking metric); ties by name.
    items.sort(key=lambda i: (-(i.installs or 0), i.name))
    return items


@router.post("/{slug}/download", response_model=OkResponse)
async def track_download(slug: str, request: Request, db: DBSession) -> OkResponse:
    """Count a manual ZIP download from the store page.

    Deliberately public and unauthenticated - downloading needs no account - so it
    is rate-limited per IP+extension to keep the number honest. The browser starts
    the real download from the artifact URL independently, so this call is purely
    advisory and must never be what makes a download fail.
    """
    await enforce_rate_limit(f"catalog-dl:{client_ip(request)}:{slug}", limit=10, window_seconds=60)
    res = await db.execute(
        update(Project)
        .where(Project.slug == slug, public_project_clause())
        .values(download_count=Project.download_count + 1)
    )
    if res.rowcount == 0:
        raise not_found("התוסף לא נמצא")
    await db.commit()
    return OkResponse()


@router.put("/{slug}/rating", response_model=OkResponse)
async def rate_project(slug: str, req: RateRequest, user: CurrentUser, db: DBSession) -> OkResponse:
    """One rating per signed-in user per extension; calling again updates it."""
    project = await db.scalar(
        select(Project).where(Project.slug == slug, public_project_clause())
    )
    if project is None:
        raise not_found("התוסף לא נמצא")
    existing = await db.scalar(
        select(ProjectRating).where(
            ProjectRating.project_id == project.id, ProjectRating.user_id == user.id
        )
    )
    if existing:
        existing.stars = req.stars
    else:
        db.add(ProjectRating(project_id=project.id, user_id=user.id, stars=req.stars))
    await db.commit()
    return OkResponse()


async def _latest_release(db: AsyncSession, project_id: str) -> Release | None:
    for ch in (Channel.stable, Channel.beta, Channel.nightly):
        state = await db.scalar(
            select(ChannelState).where(
                ChannelState.project_id == project_id, ChannelState.channel == ch
            )
        )
        if state and state.active_release_id:
            rel = await db.get(Release, state.active_release_id)
            if release_is_publicly_available(rel):
                return rel
    return None


@router.get("/{slug}", response_model=CatalogDetail)
async def catalog_detail(slug: str, db: DBSession, user: OptionalUser) -> CatalogDetail:
    project = await db.scalar(
        select(Project).where(Project.slug == slug, public_project_clause())
    )
    if project is None:
        raise not_found("התוסף לא נמצא")

    channels: list[CatalogChannelInfo] = []
    perms: list[str] = []
    host_perms: list[str] = []
    native = False
    for ch in (Channel.stable, Channel.beta, Channel.nightly):
        state = await db.scalar(
            select(ChannelState).where(
                ChannelState.project_id == project.id, ChannelState.channel == ch
            )
        )
        if not state or not state.active_release_id:
            continue
        rel = await db.get(Release, state.active_release_id)
        if not release_is_publicly_available(rel):
            continue
        # Only an APPROVED release has a public artifact, so an unapproved one
        # simply has no download URL to publish here.
        artifact = await public_artifact(db, rel.id)
        download = public_download_url(artifact) if artifact else None
        channels.append(CatalogChannelInfo(
            channel=ch, version=rel.version, release_id=rel.id,
            published_at=_iso(rel.published_at), download_url=download,
            size=artifact.size if artifact else None,
            sha256=artifact.sha256 if artifact else None,
            release_notes=rel.release_notes,
        ))
        if ch == Channel.stable or not perms:
            snap = await db.scalar(
                select(ReleasePermissionSnapshot).where(
                    ReleasePermissionSnapshot.release_id == rel.id
                )
            )
            if snap:
                perms = snap.permissions
                host_perms = snap.host_permissions
                native = snap.uses_native_messaging

    # A public install link (for the managed / auto-updating path). Every public
    # store extension with a publicly available release should be installable via
    # the Agent, so if the developer never created a link, make one automatically
    # (owned by them).
    #
    # `channels` only ever contains releases that passed the availability policy,
    # so an extension with nothing approved neither mints a link nor advertises an
    # existing one. A link that already exists must not become an install button
    # for unreviewed content just because it predates the submission.
    install_uri = None
    if channels:
        link = await db.scalar(
            select(InstallLink).where(
                InstallLink.project_id == project.id, InstallLink.disabled_at.is_(None)
            ).order_by(InstallLink.created_at.asc())
        )
        if link is None:
            link = InstallLink(
                project_id=project.id,
                token=secret_token(32),
                label="התקנה מהחנות",
                link_type=InstallLinkType.public,
                channel=Channel.stable,
                created_by_user_id=project.owner_user_id,
            )
            db.add(link)
            await db.commit()
        install_uri = f"extsync://install?token={link.token}"

    ratings = await _ratings_map(db, [project.id])
    mine = await _my_ratings(db, user.id if user else None, [project.id])
    avg, cnt = ratings.get(project.id, (0.0, 0))

    shots = await db.scalars(
        select(ProjectScreenshot)
        .where(ProjectScreenshot.project_id == project.id)
        .order_by(ProjectScreenshot.position, ProjectScreenshot.created_at)
    )
    screenshots = [s.url for s in shots]

    return CatalogDetail(
        slug=project.slug, name=project.name, short_description=project.short_description,
        full_description=project.full_description, icon_url=project.icon_url,
        developer_name=await _developer_name(db, project.owner_user_id),
        website=project.website, repo_url=project.repo_url,
        privacy_policy_url=project.privacy_policy_url, extension_id=project.extension_id,
        category=project.category,
        installs=(await _installs_map(db, [project.id])).get(project.id, 0),
        downloads=project.download_count or 0,
        screenshots=screenshots,
        channels=channels, permissions=perms,
        host_permissions=host_perms, uses_native_messaging=native, install_uri=install_uri,
        avg_rating=avg, ratings_count=cnt, my_rating=mine.get(project.id),
    )
