"""Store Safe Mode: the switch that closes the store, and what it does not do.

Two properties matter and they pull in opposite directions:

  * when thrown, the store really does stop serving the public;
  * when the flags table is unreadable, the store stays OPEN.

The second is not a compromise, it is the correct trade. A database hiccup is
enormously more likely than an actual incident, and having a transient DB error
silently take the whole store offline would be a worse failure than being a few
seconds late to notice a safe-mode flip.
"""
from __future__ import annotations

import asyncio

import pytest

from extsync_api.models.platform_flag import STORE_SAFE_MODE, PlatformFlag
from extsync_api.services import safe_mode


class _FakeDB:
    def __init__(self, flag: PlatformFlag | None = None, raises: bool = False):
        self.flag = flag
        self.raises = raises
        self.added: list = []

    async def scalar(self, stmt):  # noqa: ARG002 - only ever the flag lookup
        if self.raises:
            raise RuntimeError("database is unavailable")
        return self.flag

    def add(self, obj):
        self.added.append(obj)


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _clear_cache():
    """The cache is process-global, so each test starts from a clean read."""
    safe_mode.invalidate_cache()
    yield
    safe_mode.invalidate_cache()


# ------------------------------------------------------------------- the switch

def test_store_is_open_when_no_flag_row_exists():
    """Deploying the table must not close the store. An absent flag = open."""
    assert run(safe_mode.store_is_closed(_FakeDB(flag=None))) is False


def test_store_is_open_when_the_flag_is_disabled():
    flag = PlatformFlag(key=STORE_SAFE_MODE, enabled=False)
    assert run(safe_mode.store_is_closed(_FakeDB(flag))) is False


def test_store_is_closed_when_the_flag_is_enabled():
    flag = PlatformFlag(key=STORE_SAFE_MODE, enabled=True)
    assert run(safe_mode.store_is_closed(_FakeDB(flag))) is True


# --------------------------------------------------------------------- failure

def test_a_database_error_leaves_the_store_open():
    """Fail OPEN, deliberately. A flags-table outage taking the entire store
    down would be a far worse and far likelier failure than a delayed flip."""
    assert run(safe_mode.store_is_closed(_FakeDB(raises=True))) is False


def test_a_database_error_is_not_cached():
    """Otherwise one hiccup would pin the answer for the whole cache window."""
    db_broken = _FakeDB(raises=True)
    assert run(safe_mode.store_is_closed(db_broken)) is False
    db_ok = _FakeDB(PlatformFlag(key=STORE_SAFE_MODE, enabled=True))
    assert run(safe_mode.store_is_closed(db_ok)) is True


# ----------------------------------------------------------------------- cache

def test_the_answer_is_cached_between_reads():
    db = _FakeDB(PlatformFlag(key=STORE_SAFE_MODE, enabled=True))
    assert run(safe_mode.store_is_closed(db)) is True
    # Flip the underlying row; the cached answer should still stand.
    db.flag = PlatformFlag(key=STORE_SAFE_MODE, enabled=False)
    assert run(safe_mode.store_is_closed(db)) is True


def test_flipping_the_switch_takes_effect_immediately():
    """The person who threw the switch must see it work, not wait out a TTL."""
    db = _FakeDB(PlatformFlag(key=STORE_SAFE_MODE, enabled=False))
    assert run(safe_mode.store_is_closed(db)) is False

    run(safe_mode.set_safe_mode(db, enabled=True, admin_user_id="admin_1",
                                reason="incident"))
    # set_safe_mode invalidates the cache, so the next read is fresh.
    assert run(safe_mode.store_is_closed(db)) is True


def test_the_cache_window_is_short_enough_to_be_an_emergency_control():
    assert safe_mode.SAFE_MODE_CACHE_SECONDS <= 10


# ------------------------------------------------------------------- recording

def test_flipping_records_who_why_and_when():
    db = _FakeDB(flag=None)
    flag = run(safe_mode.set_safe_mode(db, enabled=True, admin_user_id="admin_7",
                                       reason="prohibited extension reported"))
    assert flag.enabled is True
    assert flag.updated_by_user_id == "admin_7"
    assert flag.reason == "prohibited extension reported"
    assert flag.updated_at_utc is not None
    assert db.added == [flag]  # a missing row is created rather than lost


def test_reopening_records_the_reason_too():
    db = _FakeDB(PlatformFlag(key=STORE_SAFE_MODE, enabled=True))
    flag = run(safe_mode.set_safe_mode(db, enabled=False, admin_user_id="admin_7",
                                       reason="resolved"))
    assert flag.enabled is False
    assert flag.reason == "resolved"
