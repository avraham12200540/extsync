"""The moderation guarantee, as executable statements.

These are pure-logic tests against services/availability.py - the single authority
on "may the public see this?". They exist because that predicate is the thing
standing between a user's submission and public distribution, and a regression in
it would not necessarily break any other test.
"""
from __future__ import annotations

import datetime as dt

import pytest

from extsync_api.models.enums import (
    ProjectStatus,
    ProjectVisibility,
    ReleaseStatus,
    ReviewStatus,
)
from extsync_api.models.project import Project
from extsync_api.models.release import Release
from extsync_api.services.availability import (
    BLOCKED_REVIEW_STATES,
    PUBLIC_REVIEW_STATES,
    project_is_publicly_listed,
    release_is_agent_servable,
    release_is_publicly_available,
    review_allows_public,
)


def _release(status: ReleaseStatus, review: ReviewStatus) -> Release:
    return Release(status=status, review_status=review)


def _project(
    visibility: ProjectVisibility = ProjectVisibility.public,
    status: ProjectStatus = ProjectStatus.active,
    deleted: bool = False,
) -> Project:
    return Project(
        visibility=visibility,
        status=status,
        deleted_at=dt.datetime(2026, 1, 1) if deleted else None,
    )


# --------------------------------------------------------------- the core rule

def test_approved_and_published_is_public():
    assert release_is_publicly_available(
        _release(ReleaseStatus.published, ReviewStatus.approved)
    )


@pytest.mark.parametrize(
    "review",
    [ReviewStatus.pending, ReviewStatus.rejected, ReviewStatus.changes_requested],
)
def test_submission_is_not_publication(review: ReviewStatus):
    """A developer publishing does NOT make a release public.

    `status=published` is developer-controlled; on its own it must never be
    enough. This is the whole point of the second dimension.
    """
    assert not release_is_publicly_available(_release(ReleaseStatus.published, review))


def test_legacy_releases_stay_live_but_are_not_approved():
    """Grandfathering: extensions that predate moderation do not go dark."""
    assert release_is_publicly_available(
        _release(ReleaseStatus.published, ReviewStatus.legacy_pending)
    )
    # ...but legacy is explicitly NOT the same as reviewed.
    assert ReviewStatus.legacy_pending is not ReviewStatus.approved


def test_approval_alone_is_not_enough_either():
    """Both dimensions have to agree - approval does not publish a draft."""
    for status in (
        ReleaseStatus.uploaded,
        ReleaseStatus.validating,
        ReleaseStatus.validation_failed,
        ReleaseStatus.ready,
        ReleaseStatus.draft,
        ReleaseStatus.scheduled,
        ReleaseStatus.revoked,
    ):
        assert not release_is_publicly_available(_release(status, ReviewStatus.approved))


def test_none_is_not_public():
    assert not release_is_publicly_available(None)
    assert not release_is_agent_servable(None)
    assert not project_is_publicly_listed(None)


# --------------------------------------------------------------- agent surface

@pytest.mark.parametrize(
    "status",
    [ReleaseStatus.published, ReleaseStatus.paused, ReleaseStatus.superseded],
)
def test_agent_may_fetch_metadata_for_approved_in_flight_releases(status):
    """A device can be mid-update or rolling back, so the Agent surface is wider."""
    assert release_is_agent_servable(_release(status, ReviewStatus.approved))


@pytest.mark.parametrize(
    "status",
    [ReleaseStatus.published, ReleaseStatus.paused, ReleaseStatus.superseded],
)
@pytest.mark.parametrize(
    "review",
    [ReviewStatus.pending, ReviewStatus.rejected, ReviewStatus.changes_requested],
)
def test_agent_surface_never_relaxes_the_review_dimension(status, review):
    """Being wider on lifecycle must not become a way around moderation."""
    assert not release_is_agent_servable(_release(status, review))


def test_paused_is_servable_to_agents_but_not_publicly_available():
    rel = _release(ReleaseStatus.paused, ReviewStatus.approved)
    assert release_is_agent_servable(rel)
    assert not release_is_publicly_available(rel)


# --------------------------------------------------------------- fail closed

def test_every_review_state_is_classified():
    """A new ReviewStatus must not silently default to public.

    If someone adds a state and forgets to place it, this fails - which is the
    point. Fail closed, loudly, in CI rather than quietly in production.
    """
    assert PUBLIC_REVIEW_STATES | BLOCKED_REVIEW_STATES == set(ReviewStatus)
    assert not (PUBLIC_REVIEW_STATES & BLOCKED_REVIEW_STATES)


def test_only_approved_and_legacy_are_public():
    assert PUBLIC_REVIEW_STATES == {ReviewStatus.approved, ReviewStatus.legacy_pending}
    for review in ReviewStatus:
        assert review_allows_public(review) is (review in PUBLIC_REVIEW_STATES)


# --------------------------------------------------------------- project listing

def test_project_listing_requires_public_active_and_not_deleted():
    assert project_is_publicly_listed(_project())
    assert not project_is_publicly_listed(_project(visibility=ProjectVisibility.private))
    assert not project_is_publicly_listed(_project(deleted=True))
    for status in (
        ProjectStatus.draft,
        ProjectStatus.suspended,
        ProjectStatus.archived,
        ProjectStatus.deleted,
    ):
        assert not project_is_publicly_listed(_project(status=status))
