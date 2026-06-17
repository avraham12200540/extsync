"""Public extension catalog ("store") — browse + direct download, no auth (§16, §19).

Only shows PUBLIC projects that have a published release. Returns a direct,
stable artifact URL so end users can download the ZIP manually, plus the
extsync:// install URI for the managed (auto-updating) install path.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import CurrentUser, OptionalUser
from ..errors import not_found
from ..ids import secret_token
from ..models.device import Installation
from ..models.enums import Channel, InstallationStatus, InstallLinkType, ProjectStatus, ProjectVisibility, ReleaseStatus
from ..models.install_link import InstallLink
from ..models.project import Project, ProjectScreenshot
from ..models.rating import ProjectRating
from ..models.release import ChannelState, Release, ReleaseArtifact, ReleasePermissionSnapshot
from ..models.user import User
from ..schemas.common import CamelModel, OkResponse
from ..storage import storage
from typing import Annotated
from fastapi import Depends

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
    installs: int = 0
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
    installs: int = 0
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
async def list_catalog(db: DBSession, user: OptionalUser, q: str | None = None,
                       category: str | None = None) -> list[CatalogItem]:
    # Public projects that have at least one published release (an active channel).
    stmt = (
        select(Project)
        .join(ChannelState, ChannelState.project_id == Project.id)
        .where(
            Project.visibility == ProjectVisibility.public,
            Project.deleted_at.is_(None),
            Project.status == ProjectStatus.active,
            ChannelState.active_release_id.is_not(None),
        )
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
            avg_rating=avg, ratings_count=cnt, my_rating=mine.get(p.id),
        ))
    # Highest-rated first; ties broken by number of ratings, then name.
    items.sort(key=lambda i: (-i.avg_rating, -i.ratings_count, i.name))
    return items


@router.put("/{slug}/rating", response_model=OkResponse)
async def rate_project(slug: str, req: RateRequest, user: CurrentUser, db: DBSession) -> OkResponse:
    """One rating per signed-in user per extension; calling again updates it."""
    project = await db.scalar(
        select(Project).where(
            Project.slug == slug,
            Project.visibility == ProjectVisibility.public,
            Project.deleted_at.is_(None),
        )
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
            if rel and rel.status == ReleaseStatus.published:
                return rel
    return None


@router.get("/{slug}", response_model=CatalogDetail)
async def catalog_detail(slug: str, db: DBSession, user: OptionalUser) -> CatalogDetail:
    project = await db.scalar(
        select(Project).where(
            Project.slug == slug,
            Project.visibility == ProjectVisibility.public,
            Project.deleted_at.is_(None),
        )
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
        if rel is None or rel.status != ReleaseStatus.published:
            continue
        artifact = await db.scalar(
            select(ReleaseArtifact).where(
                ReleaseArtifact.release_id == rel.id, ReleaseArtifact.kind == "validated"
            )
        )
        download = storage.public_url(artifact.s3_bucket, artifact.s3_key) if artifact else None
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
    # store extension with a published release should be installable via the Agent,
    # so if the developer never created a link, make one automatically (owned by them).
    link = await db.scalar(
        select(InstallLink).where(
            InstallLink.project_id == project.id, InstallLink.disabled_at.is_(None)
        ).order_by(InstallLink.created_at.asc())
    )
    if link is None and channels:
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
    install_uri = f"extsync://install?token={link.token}" if link else None

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
        screenshots=screenshots,
        channels=channels, permissions=perms,
        host_permissions=host_perms, uses_native_messaging=native, install_uri=install_uri,
        avg_rating=avg, ratings_count=cnt, my_rating=mine.get(project.id),
    )
