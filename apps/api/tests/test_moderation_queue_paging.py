"""The legacy queue must not lose live releases to pagination.

`liveOnly=true` used to be applied in Python, to the page SQL had already
returned. LIMIT was therefore spent on rows that were then thrown away, so any
live release sorting past the limit disappeared from the queue entirely - while
/counts, which counts in SQL, kept reporting the true number. In production that
meant 7 of 46 live legacy extensions were invisible to the reviewing admin and
the badge disagreed with the list.

Silent under-reporting is the dangerous shape here: a short queue looks exactly
like a finished one.
"""
from __future__ import annotations

import asyncio
import datetime as dt

import pytest


from extsync_api.models.enums import (
    Channel,
    ProjectStatus,
    ProjectVisibility,
    ReleaseStatus,
    ReviewStatus,
)
from extsync_api.models.project import Project
from extsync_api.models.release import ChannelState, Release
from extsync_api.routers.moderation import queue

# More non-live rows than the endpoint's default page size, so a live release
# placed after them is only reachable if the filter runs inside the query.
NOISE = 120

# Explicit timestamps: ORDER BY created_at DESC is only meaningful if the rows
# actually differ, and the live one has to be provably last.
BASE = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)


def _seed(session) -> str:
    """One live release, buried behind NOISE non-live ones. Returns its id."""
    project = Project(
        id="ext_live", name="Live", slug="live", owner_user_id="usr_x",
        status=ProjectStatus.active, visibility=ProjectVisibility.public,
    )
    session.add(project)

    # Oldest, so it sorts last under `ORDER BY created_at DESC`.
    live = Release(
        id="rel_live", project_id="ext_live", version="1.0",
        uploaded_by_user_id="usr_x", sequence=0, created_at=BASE,
        channel=Channel.stable, status=ReleaseStatus.published,
        review_status=ReviewStatus.legacy_pending,
    )
    session.add(live)
    session.add(ChannelState(
        id="chn_live", project_id="ext_live", channel=Channel.stable,
        active_release_id="rel_live", rollout_percentage=100, is_paused=False,
    ))

    # Superseded rows on the same project: legacy_pending, but not channel-active.
    for i in range(NOISE):
        session.add(Release(
            id=f"rel_noise_{i:03d}", project_id="ext_live", version=f"0.{i}",
            uploaded_by_user_id="usr_x", sequence=i + 1,
            created_at=BASE + dt.timedelta(days=i + 1),
            channel=Channel.stable, status=ReleaseStatus.superseded,
            review_status=ReviewStatus.legacy_pending,
        ))
    return "rel_live"


@pytest.fixture()
def seeded(client, sessionmaker_factory):
    async def _run() -> None:
        async with sessionmaker_factory() as session:
            _seed(session)
            await session.commit()

    asyncio.run(_run())
    return sessionmaker_factory


def _queue(sessionmaker_factory, **kw) -> list:
    async def _run() -> list:
        async with sessionmaker_factory() as session:
            return await queue(None, session, state=ReviewStatus.legacy_pending, **kw)

    return asyncio.run(_run())


def test_live_release_survives_the_default_page_size(seeded):
    """The regression: the one live release sorts last, well past limit=100."""
    items = _queue(seeded, live_only=True)
    assert [i.release_id for i in items] == ["rel_live"]


def test_live_only_returns_every_live_row_not_just_the_first_page(seeded):
    items = _queue(seeded, live_only=True, limit=10)
    assert len(items) == 1, (
        "liveOnly must select live rows in SQL; filtering the returned page "
        f"instead yields {len(items)} because LIMIT is spent on non-live rows"
    )


def test_live_only_agrees_with_an_unpaginated_count(seeded):
    """The list and the /counts badge must not be able to disagree."""
    paged = _queue(seeded, live_only=True, limit=5)
    everything = _queue(seeded, live_only=True, limit=500)
    assert len(paged) == len(everything) == 1


def test_without_live_only_the_page_is_still_capped(seeded):
    """The fix must not turn the limit off for ordinary queue browsing."""
    items = _queue(seeded, live_only=False, limit=10)
    assert len(items) == 10


def test_every_returned_item_is_flagged_live(seeded):
    for item in _queue(seeded, live_only=True):
        assert item.is_live
