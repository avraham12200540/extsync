"""THE authority on "may the public see this?".

Every endpoint that exposes an extension, a version, a download link or signed
metadata to someone outside the owning team asks this module - and nothing else.
Ad-hoc `status == published` checks scattered across routers are exactly how a
moderation guarantee rots: one of them gets missed, and unreviewed content is
live. If you are adding a public surface, call into here.

The rule this encodes:

    USER SUBMISSION != PUBLICATION.

A release becomes publicly available only when BOTH dimensions agree - the
delivery lifecycle says it is published, AND an administrator has cleared it.
`ReleaseStatus` alone is developer-controlled and therefore never sufficient.

Grandfathering: `legacy_pending` marks releases that were already live before
moderation existed. They stay available so the store does not go dark, but they
are NOT approved - they sit in the administrator's legacy queue. The moment an
administrator decides on one, it leaves `legacy_pending` for good; if that
decision was to reject it, it becomes permanently non-public and no developer
action can bring it back.
"""
from __future__ import annotations

from sqlalchemy import and_
from sqlalchemy.sql.elements import ColumnElement

from ..models.enums import (
    ProjectStatus,
    ProjectVisibility,
    ReleaseStatus,
    ReviewStatus,
)
from ..models.project import Project
from ..models.release import Release

# --------------------------------------------------------------------------- review

#: Review states under which content may reach the public.
#: `approved`      - an administrator said yes.
#: `legacy_pending`- predates moderation, temporarily grandfathered (see above).
PUBLIC_REVIEW_STATES: frozenset[ReviewStatus] = frozenset({
    ReviewStatus.approved,
    ReviewStatus.legacy_pending,
})

#: Everything else. Listed explicitly so that adding a new ReviewStatus without
#: thinking about it fails closed rather than silently becoming public.
BLOCKED_REVIEW_STATES: frozenset[ReviewStatus] = frozenset(ReviewStatus) - PUBLIC_REVIEW_STATES

#: Lifecycle states in which a release is actively distributed to the public.
PUBLIC_RELEASE_STATES: frozenset[ReleaseStatus] = frozenset({ReleaseStatus.published})

#: Lifecycle states for which an ENROLLED Agent may still fetch signed metadata.
#: Wider than the public set on purpose: a device can be mid-update, or applying
#: a rollback to a version that has since been superseded. It is still gated on
#: the review dimension, so a rejected release is unreachable here too.
AGENT_SERVABLE_RELEASE_STATES: frozenset[ReleaseStatus] = frozenset({
    ReleaseStatus.published,
    ReleaseStatus.paused,
    ReleaseStatus.superseded,
})


def review_allows_public(review_status: ReviewStatus) -> bool:
    """Has an administrator cleared this for distribution (or grandfathered it)?"""
    return review_status in PUBLIC_REVIEW_STATES


# --------------------------------------------------------------------------- releases

def release_is_publicly_available(release: Release | None) -> bool:
    """May anyone at all download / see this specific version?

    Both dimensions must agree. This is the question behind every public download
    link, catalog channel entry and install page.
    """
    if release is None:
        return False
    return (
        release.status in PUBLIC_RELEASE_STATES
        and review_allows_public(release.review_status)
    )


def release_is_agent_servable(release: Release | None) -> bool:
    """May an enrolled Agent fetch this release's signed metadata?

    Deliberately allows paused/superseded (a device may be mid-update or rolling
    back) but never relaxes the review dimension.
    """
    if release is None:
        return False
    return (
        release.status in AGENT_SERVABLE_RELEASE_STATES
        and review_allows_public(release.review_status)
    )


def public_release_clause() -> ColumnElement[bool]:
    """SQL form of release_is_publicly_available, for use in queries."""
    return and_(
        Release.status.in_(PUBLIC_RELEASE_STATES),
        Release.review_status.in_(PUBLIC_REVIEW_STATES),
    )


# --------------------------------------------------------------------------- projects

def project_is_publicly_listed(project: Project | None) -> bool:
    """May this extension appear in the store at all?

    Note this is about the LISTING. A project can pass this and still have
    nothing downloadable, if none of its releases are approved yet - which is
    exactly the state of a brand-new submission.
    """
    if project is None:
        return False
    return (
        project.visibility == ProjectVisibility.public
        and project.status == ProjectStatus.active
        and project.deleted_at is None
    )


def public_project_clause() -> ColumnElement[bool]:
    """SQL form of project_is_publicly_listed, for use in queries."""
    return and_(
        Project.visibility == ProjectVisibility.public,
        Project.status == ProjectStatus.active,
        Project.deleted_at.is_(None),
    )
