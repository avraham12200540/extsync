"""Store Safe Mode - the switch that closes the store.

WHAT IT DOES
While on, the public surfaces serve nothing: the catalog is empty, extension
pages 404, install links stop resolving, and Agents are told there is no update.
It takes effect within SAFE_MODE_CACHE_SECONDS everywhere, without a deploy or a
restart, which is the point - an emergency control has to work at 3am without
SSH access to the droplet.

WHAT IT DOES NOT DO, AND THIS MATTERS
It does not remove bytes from public storage. Someone who already holds a direct
artifact URL can still fetch that file while safe mode is on. Safe mode stops the
store from HANDING OUT anything; removing a specific file is what the per-release
takedown does (services/moderation.unpublish_release deletes the public object).

So the two controls are different tools and neither replaces the other:

    safe mode      stop the whole store, instantly, reversibly
    takedown       remove one extension's bytes, permanently

Anyone reasoning about an incident needs to know which one they just used, so
this distinction is stated in the admin UI too rather than left implicit.

CACHING
Every public request would otherwise hit the flags table. The value is cached in
process for a few seconds - long enough to keep the read cost negligible, short
enough that flipping the switch is effectively immediate. It FAILS OPEN on a
database error: an outage of the flags table must not take the store down, since
the far more common case by orders of magnitude is "the DB hiccuped", not "we are
mid-incident and the switch was just thrown".
"""
from __future__ import annotations

import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..logging import get_logger
from ..models.platform_flag import STORE_SAFE_MODE, PlatformFlag

logger = get_logger("extsync.safe_mode")

#: How stale the cached answer may be. Short: this is an emergency switch.
SAFE_MODE_CACHE_SECONDS = 5.0

_cached: tuple[float, bool] | None = None


def _now() -> float:
    return time.monotonic()


def invalidate_cache() -> None:
    """Drop the cache so the next read hits the database.

    Called right after an administrator flips the switch, so the person who threw
    it sees the effect immediately rather than wondering whether it worked.
    """
    global _cached
    _cached = None


async def store_is_closed(db: AsyncSession) -> bool:
    """True when Store Safe Mode is on and the public should be served nothing."""
    global _cached
    if _cached is not None:
        cached_at, value = _cached
        if _now() - cached_at < SAFE_MODE_CACHE_SECONDS:
            return value

    try:
        flag = await db.scalar(
            select(PlatformFlag).where(PlatformFlag.key == STORE_SAFE_MODE)
        )
        value = bool(flag and flag.enabled)
    except Exception:  # noqa: BLE001
        # Fail OPEN. A flags-table outage taking the entire store offline would
        # be a far worse and far more likely failure than missing a safe-mode
        # flip for a few seconds.
        logger.warning("safe mode: could not read the flag; assuming store open",
                       exc_info=True)
        return False

    _cached = (_now(), value)
    return value


async def set_safe_mode(db: AsyncSession, *, enabled: bool, admin_user_id: str,
                        reason: str | None = None) -> PlatformFlag:
    """Flip the switch. Caller commits."""
    import datetime as dt

    flag = await db.scalar(
        select(PlatformFlag).where(PlatformFlag.key == STORE_SAFE_MODE)
    )
    if flag is None:
        flag = PlatformFlag(key=STORE_SAFE_MODE)
        db.add(flag)
    flag.enabled = enabled
    flag.reason = reason
    flag.updated_by_user_id = admin_user_id
    flag.updated_at_utc = dt.datetime.now(dt.timezone.utc)
    invalidate_cache()
    logger.warning("safe mode %s by %s (%s)",
                   "ENABLED" if enabled else "disabled", admin_user_id, reason or "-")
    return flag
