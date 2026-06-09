"""Install link creation, resolution, and consumption (§16)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..errors import APIError, ErrorCode, not_found
from ..ids import secret_token
from ..models.enums import ProjectStatus, ReleaseStatus
from ..models.install_link import InstallLink
from ..models.project import Project
from ..models.release import ChannelState, Release, ReleasePermissionSnapshot
from ..models.user import DeveloperProfile, User
from ..schemas.install_link import (
    InstallLinkCreate,
    InstallPagePermissions,
    InstallPageResolve,
)
from .audit import record_audit


def _iso(value) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


async def create_install_link(db: AsyncSession, project: Project, data: InstallLinkCreate,
                              *, user: User) -> InstallLink:
    link = InstallLink(
        project_id=project.id,
        token=secret_token(32),
        label=data.label,
        link_type=data.link_type,
        channel=data.channel,
        max_uses=data.max_uses,
        expires_at=data.expires_at,
        requires_account=data.requires_account,
        allowed_email_domain=data.allowed_email_domain,
        org_team_id=data.org_team_id,
        created_by_user_id=user.id,
    )
    db.add(link)
    await record_audit(db, action="install_link.create", actor_user_id=user.id,
                       target_type="install_link", target_id=link.id, project_id=project.id)
    return link


def install_link_url(token: str) -> str:
    return f"{settings.public_web_url}/install/{token}"


async def _active_release(db: AsyncSession, project_id: str, channel) -> Release | None:
    state = await db.scalar(
        select(ChannelState).where(
            ChannelState.project_id == project_id, ChannelState.channel == channel
        )
    )
    if state is None or state.active_release_id is None:
        return None
    rel = await db.get(Release, state.active_release_id)
    if rel is None or rel.status not in (ReleaseStatus.published,):
        return None
    return rel


async def resolve_install_link(db: AsyncSession, token: str) -> InstallPageResolve:
    link = await db.scalar(select(InstallLink).where(InstallLink.token == token))
    if link is None:
        raise not_found("קישור ההתקנה לא נמצא")
    project = await db.get(Project, link.project_id)
    if project is None or project.deleted_at is not None:
        raise not_found("התוסף לא נמצא")
    if project.status == ProjectStatus.suspended:
        raise APIError(ErrorCode.PROJECT_SUSPENDED, "התוסף מושהה", status_code=403)

    usable, reason = link.is_usable()

    profile = await db.scalar(
        select(DeveloperProfile).where(DeveloperProfile.user_id == project.owner_user_id)
    )
    developer_name = (profile.org_name if profile and profile.org_name else None) or "מפתח ExtSync"

    rel = await _active_release(db, project.id, link.channel)
    perms = InstallPagePermissions()
    version = published_at = None
    has_bridge = False
    if rel is not None:
        version = rel.version
        published_at = _iso(rel.published_at)
        has_bridge = bool((rel.validation_report or {}).get("hasBridge"))
        snap = await db.scalar(
            select(ReleasePermissionSnapshot).where(
                ReleasePermissionSnapshot.release_id == rel.id
            )
        )
        if snap is not None:
            perms = InstallPagePermissions(
                permissions=snap.permissions,
                host_permissions=snap.host_permissions,
                optional_permissions=snap.optional_permissions,
                uses_native_messaging=snap.uses_native_messaging,
            )

    return InstallPageResolve(
        token=token,
        project_id=project.id,
        extension_id=project.extension_id,
        name=project.name,
        icon_url=project.icon_url,
        short_description=project.short_description,
        full_description=project.full_description,
        developer_name=developer_name,
        website=project.website,
        repo_url=project.repo_url,
        privacy_policy_url=project.privacy_policy_url,
        visibility=project.visibility.value,
        channel=link.channel,
        version=version,
        published_at=published_at,
        permissions=perms,
        requires_account=link.requires_account,
        has_bridge=has_bridge,
        install_uri=f"extsync://install?token={token}",
        usable=usable,
        reason=reason,
    )


async def consume_install_link(db: AsyncSession, link: InstallLink, *, user: User | None) -> None:
    """Enforce link constraints at actual install time and increment usage."""
    usable, reason = link.is_usable()
    if not usable:
        code = {
            "expired": ErrorCode.INSTALL_LINK_EXPIRED,
            "limit_reached": ErrorCode.INSTALL_LINK_LIMIT_REACHED,
        }.get(reason or "", ErrorCode.NOT_FOUND)
        raise APIError(code, "קישור ההתקנה אינו זמין יותר", status_code=410)

    if link.requires_account and user is None:
        raise APIError(ErrorCode.FORBIDDEN, "נדרש חשבון משתמש כדי להתקין תוסף זה", status_code=403)
    if link.allowed_email_domain and user is not None:
        domain = user.email.split("@")[-1].lower()
        if domain != link.allowed_email_domain.lower():
            raise APIError(ErrorCode.FORBIDDEN, "כתובת האימייל אינה מורשית לקישור זה", status_code=403)

    link.used_count += 1
