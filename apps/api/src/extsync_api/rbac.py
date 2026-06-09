"""Role-Based Access Control (§3).

Two layers:
  * Global UserRole (guest, end_user, developer, team_member, team_admin, platform_admin)
  * Per-project authority derived from project ownership OR the user's TeamRole on the
    project's team (viewer, developer, release_manager, admin).

`effective_project_permissions(...)` resolves the set of permissions a user holds for a
specific project, which the API dependencies then check.
"""
from __future__ import annotations

from enum import StrEnum

from .models.enums import TeamRole, UserRole


class Permission(StrEnum):
    PROJECT_CREATE = "project:create"
    PROJECT_READ = "project:read"
    PROJECT_UPDATE = "project:update"
    PROJECT_DELETE = "project:delete"
    RELEASE_CREATE = "release:create"
    RELEASE_PUBLISH = "release:publish"
    # Publishing specifically to the Stable channel is gated more tightly.
    RELEASE_PUBLISH_STABLE = "release:publish_stable"
    RELEASE_ROLLBACK = "release:rollback"
    RELEASE_DELETE_DRAFT = "release:delete_draft"
    INSTALLATION_READ = "installation:read"
    ANALYTICS_READ = "analytics:read"
    INSTALL_LINK_CREATE = "install_link:create"
    INSTALL_LINK_DISABLE = "install_link:disable"
    TEAM_MANAGE = "team:manage"
    API_TOKEN_MANAGE = "api_token:manage"
    WEBHOOK_MANAGE = "webhook:manage"
    AUDIT_READ = "audit:read"


# Team role -> permissions on projects owned by that team.
_VIEWER = {
    Permission.PROJECT_READ,
    Permission.INSTALLATION_READ,
    Permission.ANALYTICS_READ,
    Permission.AUDIT_READ,
}
_DEVELOPER = _VIEWER | {
    Permission.PROJECT_UPDATE,
    Permission.RELEASE_CREATE,
    Permission.INSTALL_LINK_CREATE,
    Permission.WEBHOOK_MANAGE,
}
_RELEASE_MANAGER = _DEVELOPER | {
    Permission.RELEASE_PUBLISH,
    Permission.RELEASE_PUBLISH_STABLE,
    Permission.RELEASE_ROLLBACK,
    Permission.RELEASE_DELETE_DRAFT,
    Permission.INSTALL_LINK_DISABLE,
}
_TEAM_ADMIN = _RELEASE_MANAGER | {
    Permission.PROJECT_CREATE,
    Permission.PROJECT_DELETE,
    Permission.TEAM_MANAGE,
    Permission.API_TOKEN_MANAGE,
}

TEAM_ROLE_PERMISSIONS: dict[TeamRole, set[Permission]] = {
    TeamRole.viewer: _VIEWER,
    TeamRole.developer: _DEVELOPER,
    TeamRole.release_manager: _RELEASE_MANAGER,
    TeamRole.admin: _TEAM_ADMIN,
}

# The owner of a personal (non-team) project has the full project authority set.
OWNER_PERMISSIONS: set[Permission] = set(Permission)

ALL_PERMISSIONS: set[Permission] = set(Permission)


def global_permissions(role: UserRole) -> set[Permission]:
    """Permissions a user holds regardless of a specific project."""
    if role == UserRole.platform_admin:
        return set(ALL_PERMISSIONS)
    if role in (UserRole.developer, UserRole.team_admin, UserRole.team_member):
        # Can create their own projects; per-project authority resolved separately.
        return {Permission.PROJECT_CREATE, Permission.API_TOKEN_MANAGE}
    return set()


def effective_project_permissions(
    *,
    user_role: UserRole,
    is_owner: bool,
    team_role: TeamRole | None,
) -> set[Permission]:
    """Resolve the permission set a user has for one project."""
    if user_role == UserRole.platform_admin:
        return set(ALL_PERMISSIONS)
    perms: set[Permission] = set()
    if is_owner:
        perms |= OWNER_PERMISSIONS
    if team_role is not None:
        perms |= TEAM_ROLE_PERMISSIONS.get(team_role, set())
    return perms


def can_publish_to_channel(perms: set[Permission], channel: str) -> bool:
    """Only release managers / admins / owners publish to Stable (§3)."""
    if channel == "stable":
        return Permission.RELEASE_PUBLISH_STABLE in perms
    return Permission.RELEASE_PUBLISH in perms
