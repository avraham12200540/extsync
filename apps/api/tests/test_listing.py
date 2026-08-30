"""Listing moderation: the public sees approved content, not the latest edit.

The bypass this closes is simple and would otherwise be trivial to perform: get
an extension approved with an innocuous name and description, then rename it to
anything at all. The listing is published content, so it gets the same rule as
the build.
"""
from __future__ import annotations

import asyncio

import pytest

from extsync_api.models.enums import (
    ProjectStatus,
    ProjectVisibility,
    ReviewStatus,
    UserRole,
)
from extsync_api.models.project import Project, ProjectScreenshot
from extsync_api.models.user import User
from extsync_api.services.listing import (
    LISTING_FIELDS,
    approve_listing,
    build_snapshot,
    current_listing,
    listing_differs,
    mark_listing_dirty,
    reject_listing,
)


# The reviewer is passed as the User rather than an id so the durable identity
# snapshot can be taken from it - see Project.listing_reviewed_by_email_snapshot.
ADMIN = User(id="admin_1", email="admin@extsync.test", display_name="Admin",
             role=UserRole.platform_admin, password_hash="x")


def _project(**over) -> Project:
    base = dict(
        id="proj_test", slug="test", name="Original Name",
        short_description="Original description", full_description=None,
        icon_url=None, category="tools", website=None, repo_url=None,
        support_url=None, privacy_policy_url=None,
        visibility=ProjectVisibility.public, status=ProjectStatus.active,
        owner_user_id="user_1",
        listing_review_status=ReviewStatus.pending,
    )
    base.update(over)
    return Project(**base)


class _FakeScalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeUser:
    def __init__(self, display_name: str):
        self.id = "user_1"
        self.display_name = display_name


class _FakeDB:
    """Just enough session to run the listing service: it selects screenshots
    and loads the owning user (for the public developer name)."""

    def __init__(self, screenshots: list[str] | None = None,
                 developer_name: str = "Original Dev"):
        self.screenshots = screenshots or []
        self.developer_name = developer_name

    async def get(self, model, pk):  # noqa: ARG002 - only ever the owner
        return _FakeUser(self.developer_name)

    async def scalars(self, stmt):  # noqa: ARG002 - the service only asks for shots
        rows = [
            ProjectScreenshot(id=f"s{i}", project_id="proj_test", url=u, position=i)
            for i, u in enumerate(self.screenshots)
        ]
        # build_snapshot selects the model; mark_listing_dirty selects the url.
        col = str(getattr(stmt, "_raw_columns", [""])[0])
        return _FakeScalars(self.screenshots if "url" in col.lower() else rows)


def run(coro):
    return asyncio.run(coro)


# --------------------------------------------------------- what the public sees

def test_public_sees_the_approved_snapshot_not_the_latest_edit():
    """The core of it. Approve, then rename - the store must not follow."""
    project = _project()
    db = _FakeDB()
    run(approve_listing(db, project, admin=ADMIN))

    project.name = "Something Completely Different"
    project.short_description = "and a different description"

    shown = run(current_listing(db, project))
    assert shown["name"] == "Original Name"
    assert shown["short_description"] == "Original description"


def test_grandfathered_project_renders_its_live_fields():
    """A NULL snapshot means 'show the live fields', so nothing went dark when
    listing moderation shipped."""
    project = _project(approved_listing=None)
    shown = run(current_listing(_FakeDB(), project))
    assert shown["name"] == "Original Name"


def test_snapshot_captures_every_public_field():
    project = _project()
    snap = run(build_snapshot(_FakeDB(["https://x/1.png"]), project))
    for field in LISTING_FIELDS:
        assert field in snap, field
    assert snap["screenshots"] == ["https://x/1.png"]


# ------------------------------------------------------------- dirty detection

def test_editing_an_approved_listing_sends_it_back_for_review():
    project = _project()
    db = _FakeDB()
    run(approve_listing(db, project, admin=ADMIN))
    assert project.listing_review_status == ReviewStatus.approved

    project.name = "Renamed"
    assert run(mark_listing_dirty(db, project)) is True
    assert project.listing_review_status == ReviewStatus.pending


def test_a_save_that_changes_nothing_does_not_queue_work():
    project = _project()
    db = _FakeDB()
    run(approve_listing(db, project, admin=ADMIN))
    assert run(mark_listing_dirty(db, project)) is False
    assert project.listing_review_status == ReviewStatus.approved


def test_restoring_the_approved_text_clears_the_difference():
    project = _project()
    db = _FakeDB()
    run(approve_listing(db, project, admin=ADMIN))
    project.name = "Renamed"
    assert run(mark_listing_dirty(db, project)) is True
    project.name = "Original Name"
    # Back to the approved text: no longer a difference to review.
    assert listing_differs(project, project.approved_listing, []) is False


def test_changing_screenshots_counts_as_a_listing_change():
    project = _project()
    db = _FakeDB(["https://x/1.png"])
    run(approve_listing(db, project, admin=ADMIN))
    db.screenshots = ["https://x/1.png", "https://x/2.png"]
    assert run(mark_listing_dirty(db, project)) is True


def test_legacy_listing_is_not_moved_to_pending():
    """legacy_pending records that a listing predates moderation. Overwriting it
    with `pending` would lose that, and it is already queued anyway."""
    project = _project(listing_review_status=ReviewStatus.legacy_pending)
    project.name = "Renamed"
    assert run(mark_listing_dirty(_FakeDB(), project)) is False
    assert project.listing_review_status == ReviewStatus.legacy_pending


# -------------------------------------------------------------------- decisions

def test_approving_captures_the_developers_current_text():
    project = _project()
    db = _FakeDB()
    project.name = "New Name"
    run(approve_listing(db, project, admin=ADMIN))
    assert project.approved_listing["name"] == "New Name"
    assert project.listing_reviewed_by_user_id == "admin_1"
    assert project.listing_reviewed_at is not None


def test_rejecting_leaves_the_public_listing_untouched():
    """A refused edit must have no public effect at all."""
    project = _project()
    db = _FakeDB()
    run(approve_listing(db, project, admin=ADMIN))
    approved_before = dict(project.approved_listing)

    project.name = "Prohibited Name"
    run(mark_listing_dirty(db, project))
    run(reject_listing(db, project, admin=ADMIN, reason="not allowed"))

    assert project.approved_listing == approved_before
    assert project.listing_review_status == ReviewStatus.rejected
    assert run(current_listing(db, project))["name"] == "Original Name"
    # The developer's own copy is left as they wrote it, so they can see what
    # was refused and fix it.
    assert project.name == "Prohibited Name"


@pytest.mark.parametrize("field", LISTING_FIELDS)
def test_every_public_field_is_diffed(field):
    """If a field is public but not compared, editing it would silently reach
    the store."""
    project = _project()
    db = _FakeDB()
    run(approve_listing(db, project, admin=ADMIN))
    setattr(project, field, "changed-value")
    assert listing_differs(project, project.approved_listing, []) is True, field


# --------------------------------------------------- the public developer name

def test_developer_name_is_part_of_the_approved_listing():
    """`user.display_name` is freely editable through PATCH /auth/me and renders
    as "by <name>" on every store page, so it has to be snapshotted too."""
    project = _project()
    db = _FakeDB(developer_name="Honest Dev")
    run(approve_listing(db, project, admin=ADMIN))
    assert project.approved_listing["developer_name"] == "Honest Dev"

    db.developer_name = "Something Else Entirely"
    assert run(current_listing(db, project))["developer_name"] == "Honest Dev"


def test_renaming_yourself_sends_the_listing_back_for_review():
    project = _project()
    db = _FakeDB(developer_name="Honest Dev")
    run(approve_listing(db, project, admin=ADMIN))
    db.developer_name = "Prohibited Name"
    assert run(mark_listing_dirty(db, project)) is True
    assert project.listing_review_status == ReviewStatus.pending
