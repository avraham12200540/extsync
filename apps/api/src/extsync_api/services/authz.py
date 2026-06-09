"""Project-scoped authorization: resolve a user's permissions on a project.

Centralizes the ownership/team-role resolution so every router checks access the
same way. Raises NOT_FOUND (not FORBIDDEN) for projects the user cannot see, to
avoid leaking existence (§45 cross-team isolation).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import APIError, ErrorCode, forbidden, not_found
from ..models.enums import ProjectStatus, TeamRole, UserRole
from ..models.project import Project
from ..models.team import TeamMember
from ..models.user import User
from ..rbac import Permission, can_publish_to_channel, effective_project_permissions


async def _team_role(db: AsyncSession, team_id: str | None, user_id: str) -> TeamRole | None:
    if not team_id:
        return None
    member = await db.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team_id, TeamMember.user_id == user_id
        )
    )
    return member.role if member else None


async def load_project_for_user(
    db: AsyncSession, project_id: str, user: User, required: Permission
) -> tuple[Project, set[Permission]]:
    """Load a project, verify `required` permission, return (project, perms).

    Raises NOT_FOUND if the project is missing/soft-deleted or the user has no
    visibility at all; FORBIDDEN if visible but lacking the specific permission.
    """
    project = await db.get(Project, project_id)
    if project is None or project.deleted_at is not None or project.status == ProjectStatus.deleted:
        raise not_found("הפרויקט לא נמצא")

    is_owner = project.owner_user_id == user.id
    team_role = await _team_role(db, project.team_id, user.id)
    perms = effective_project_permissions(
        user_role=user.role, is_owner=is_owner, team_role=team_role
    )
    if not perms:
        # No relationship to this project at all -> hide its existence.
        raise not_found("הפרויקט לא נמצא")
    if required not in perms:
        raise forbidden()
    return project, perms


def ensure_can_publish(perms: set[Permission], channel: str) -> None:
    if not can_publish_to_channel(perms, channel):
        raise forbidden(
            "רק Release Manager או Admin יכולים לפרסם לערוץ Stable"
            if channel == "stable"
            else "אין לך הרשאת פרסום"
        )


def ensure_project_active(project: Project) -> None:
    if project.status == ProjectStatus.suspended:
        raise APIError(ErrorCode.PROJECT_SUSPENDED, "הפרויקט מושהה", status_code=403)
