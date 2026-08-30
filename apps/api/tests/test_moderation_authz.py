"""Who is allowed to moderate - tested against the real app.

The moderation endpoints are the mechanism by which unreviewed content becomes
public. The property that matters most is not that they work, but that nobody
except a platform administrator can reach them - in particular, not a developer
acting on their own extension.

These run against the actual FastAPI app and SQLite, so they exercise the real
dependency chain (AdminUser -> require_admin -> role check), not a mock of it.
"""
from __future__ import annotations

import pytest

from extsync_api.rbac import (
    OWNER_PERMISSIONS,
    PLATFORM_ONLY_PERMISSIONS,
    Permission,
    TEAM_ROLE_PERMISSIONS,
    can_moderate,
    effective_project_permissions,
    global_permissions,
)
from extsync_api.models.enums import TeamRole, UserRole

# Every state-changing moderation route, with a body that would be valid if the
# caller were allowed through. A 422 here would mean we stopped at validation
# rather than at authorization, which would make the test vacuous.
ACTIONS = [
    ("/admin/moderation/releases/rel_x/approve", {}),
    ("/admin/moderation/releases/rel_x/reject", {"reason": "no"}),
    ("/admin/moderation/releases/rel_x/request-changes", {"reason": "fix"}),
    ("/admin/moderation/releases/rel_x/unpublish", {"reason": "remove"}),
    ("/admin/moderation/listings/proj_x/approve", {}),
    ("/admin/moderation/listings/proj_x/reject", {"reason": "no"}),
    # Closing or reopening the entire store is the single most consequential
    # button in the product.
    ("/admin/moderation/safe-mode", {"enabled": True}),
]
READS = [
    "/admin/moderation/counts",
    "/admin/moderation/queue",
    "/admin/moderation/releases/rel_x",
    "/admin/moderation/listings",
    "/admin/moderation/listings/proj_x",
    "/admin/moderation/safe-mode",
    "/admin/moderation/audit",
]


def _register(client, email, account_type="developer"):
    r = client.post("/auth/register", json={
        "email": email, "password": "Sup3r-Secret!", "accountType": account_type,
        "displayName": "Dev", "orgName": "Acme", "acceptTerms": True,
    })
    assert r.status_code == 201, r.text
    r = client.post("/auth/login", json={"email": email, "password": "Sup3r-Secret!"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


# --------------------------------------------------------------- HTTP boundary

@pytest.mark.parametrize("path,body", ACTIONS)
def test_developer_cannot_perform_moderation_actions(client, path, body):
    headers = _register(client, "dev-mod@example.com")
    r = client.post(path, json=body, headers=headers)
    assert r.status_code == 403, f"{path} returned {r.status_code}: {r.text}"


@pytest.mark.parametrize("path", READS)
def test_developer_cannot_read_the_moderation_queue(client, path):
    """The queue exposes other developers' unpublished submissions."""
    headers = _register(client, "dev-read@example.com")
    r = client.get(path, headers=headers)
    assert r.status_code == 403, f"{path} returned {r.status_code}: {r.text}"


@pytest.mark.parametrize("path,body", ACTIONS)
def test_anonymous_cannot_perform_moderation_actions(client, path, body):
    r = client.post(path, json=body)
    assert r.status_code in (401, 403), f"{path} returned {r.status_code}"


@pytest.mark.parametrize("path", READS)
def test_anonymous_cannot_read_the_moderation_queue(client, path):
    r = client.get(path)
    assert r.status_code in (401, 403), f"{path} returned {r.status_code}"


# --------------------------------------------------------- permission algebra

def test_project_owners_do_not_get_moderation_permissions():
    """Owners once received `set(Permission)` - every permission that exists.

    That meant each new permission was granted to project owners automatically,
    which is how an owner would have ended up able to approve their own
    extension. Owner authority is now derived by subtraction instead.
    """
    assert not (OWNER_PERMISSIONS & PLATFORM_ONLY_PERMISSIONS)
    assert not can_moderate(OWNER_PERMISSIONS)
    assert Permission.MODERATION_ACT not in OWNER_PERMISSIONS
    assert Permission.MODERATION_REVIEW not in OWNER_PERMISSIONS


def test_no_team_role_grants_moderation():
    for role, perms in TEAM_ROLE_PERMISSIONS.items():
        assert not (perms & PLATFORM_ONLY_PERMISSIONS), f"team role {role} grants moderation"
        assert not can_moderate(perms)


@pytest.mark.parametrize("team_role", [None, *list(TeamRole)])
@pytest.mark.parametrize("is_owner", [True, False])
def test_no_combination_of_project_authority_grants_moderation(is_owner, team_role):
    """Owner + the highest team role together still must not add up to moderation."""
    perms = effective_project_permissions(
        user_role=UserRole.developer, is_owner=is_owner, team_role=team_role,
    )
    assert not can_moderate(perms)


def test_platform_admin_does_get_moderation():
    """The gate has to actually open for the one role that should hold it."""
    assert can_moderate(global_permissions(UserRole.platform_admin))
    perms = effective_project_permissions(
        user_role=UserRole.platform_admin, is_owner=False, team_role=None,
    )
    assert can_moderate(perms)


@pytest.mark.parametrize(
    "role",
    [UserRole.guest, UserRole.end_user, UserRole.developer,
     UserRole.team_member, UserRole.team_admin],
)
def test_no_other_global_role_grants_moderation(role):
    assert not can_moderate(global_permissions(role))
