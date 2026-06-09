"""Public extension catalog ("store") — browse + direct download, no auth (§16, §19).

Only shows PUBLIC projects that have a published release. Returns a direct,
stable artifact URL so end users can download the ZIP manually, plus the
extsync:// install URI for the managed (auto-updating) install path.
"""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..errors import not_found
from ..models.enums import Channel, ProjectStatus, ProjectVisibility, ReleaseStatus
from ..models.install_link import InstallLink
from ..models.project import Project
from ..models.release import ChannelState, Release, ReleaseArtifact, ReleasePermissionSnapshot
from ..models.user import DeveloperProfile
from ..schemas.common import CamelModel
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


class CatalogChannelInfo(CamelModel):
    channel: Channel
    version: str
    release_id: str
    published_at: str | None = None
    download_url: str | None = None      # direct ZIP (manual download)
    size: int | None = None
    sha256: str | None = None


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
    channels: list[CatalogChannelInfo] = []
    permissions: list[str] = []
    host_permissions: list[str] = []
    uses_native_messaging: bool = False
    install_uri: str | None = None       # extsync://install?token=... (managed install)


def _iso(v) -> str | None:
    return v.isoformat().replace("+00:00", "Z") if v else None


async def _developer_name(db: AsyncSession, owner_user_id: str) -> str:
    profile = await db.scalar(
        select(DeveloperProfile).where(DeveloperProfile.user_id == owner_user_id)
    )
    return (profile.org_name if profile and profile.org_name else None) or "מפתח ExtSync"


@router.get("", response_model=list[CatalogItem])
async def list_catalog(db: DBSession, q: str | None = None, category: str | None = None) -> list[CatalogItem]:
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

    items: list[CatalogItem] = []
    for p in projects:
        # latest stable (or any) published release version
        rel = await _latest_release(db, p.id)
        items.append(CatalogItem(
            slug=p.slug, name=p.name, short_description=p.short_description,
            icon_url=p.icon_url, developer_name=await _developer_name(db, p.owner_user_id),
            extension_id=p.extension_id, latest_version=rel.version if rel else None,
            category=p.category,
        ))
    return items


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
async def catalog_detail(slug: str, db: DBSession) -> CatalogDetail:
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

    # A public install link (for the managed / auto-updating path).
    link = await db.scalar(
        select(InstallLink).where(
            InstallLink.project_id == project.id, InstallLink.disabled_at.is_(None)
        ).order_by(InstallLink.created_at.asc())
    )
    install_uri = f"extsync://install?token={link.token}" if link else None

    return CatalogDetail(
        slug=project.slug, name=project.name, short_description=project.short_description,
        full_description=project.full_description, icon_url=project.icon_url,
        developer_name=await _developer_name(db, project.owner_user_id),
        website=project.website, repo_url=project.repo_url,
        privacy_policy_url=project.privacy_policy_url, extension_id=project.extension_id,
        category=project.category, channels=channels, permissions=perms,
        host_permissions=host_perms, uses_native_messaging=native, install_uri=install_uri,
    )
