"""Business logic for the mitmachim.top daily likes meter.

Invariants enforced here (server is the source of truth):
  * the "today" date is computed in Asia/Jerusalem (config), not the client clock;
  * likes_today is clamped to [0, daily_limit];
  * a client_event_id is processed at most once (idempotent retries);
  * a post can be counted at most once per day (per-post dedup);
  * a decrement only fires for a post that was actually counted.
"""
from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..errors import APIError, ErrorCode
from ..models.likes_quota import LikesQuotaDaily, LikesQuotaEvent
from ..schemas.likes_quota import ForumUser

_UNKNOWN = "unknown"


def _israel_tz() -> dt.tzinfo:
    """The configured tz, with a degraded fallback if the IANA db is missing.

    Production pins `tzdata`, so ZoneInfo resolves exactly (DST-aware). On a
    minimal host without the tz database we approximate Israel time (UTC+2 IST /
    UTC+3 IDT) so the daily reset boundary stays close rather than crashing.
    """
    try:
        return ZoneInfo(settings.likes_quota_timezone)
    except Exception:  # noqa: BLE001 - never let a missing tz db break the meter
        now = dt.datetime.now(dt.timezone.utc)
        offset = 3 if 3 < now.month < 11 else 2  # rough Apr-Oct DST window
        return dt.timezone(dt.timedelta(hours=offset))


def israel_today() -> dt.date:
    """Current calendar date in the configured (Israel) timezone."""
    return dt.datetime.now(_israel_tz()).date()


def _iso(value: dt.datetime | None) -> str:
    if value is None:
        return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    return value.isoformat().replace("+00:00", "Z")


def _target_key(target_user_id: str | None, target_username: str | None) -> str:
    """Stable key for the per-user (6/user) tally. Prefer the numeric forum uid;
    fall back to username/slug when the DOM only exposed a name."""
    return target_user_id or target_username or _UNKNOWN


# ---- read ------------------------------------------------------------------

async def _get_row(db: AsyncSession, principal_id: str, day: dt.date) -> LikesQuotaDaily | None:
    return await db.scalar(
        select(LikesQuotaDaily).where(
            LikesQuotaDaily.user_id == principal_id,
            LikesQuotaDaily.date == day,
        )
    )


def build_state(row: LikesQuotaDaily | None, day: dt.date) -> dict:
    """Serialize a row (or a virtual empty day) to the camelCase response shape."""
    if row is None:
        return {
            "ok": True,
            "date": day.isoformat(),
            "likesToday": 0,
            "dailyLimit": settings.likes_quota_daily_limit,
            "perUserLimit": settings.likes_quota_per_user_limit,
            "targetUsers": {},
            "updatedAt": _iso(None),
        }
    return {
        "ok": True,
        "date": row.date.isoformat(),
        "likesToday": row.likes_today,
        "dailyLimit": row.daily_limit,
        "perUserLimit": row.per_user_limit,
        "targetUsers": row.target_users or {},
        "updatedAt": _iso(row.updated_at),
    }


async def get_today(
    db: AsyncSession, principal_id: str, forum: ForumUser | None = None
) -> dict:
    day = israel_today()
    row = await _get_row(db, principal_id, day)
    # Only persist forum metadata if a row already exists; GET never creates rows
    # (keeps idle 15s polling from churning the DB; the day still resets by date).
    if row is not None and forum is not None:
        _apply_forum_metadata(row, forum)
    return build_state(row, day)


# ---- write helpers ---------------------------------------------------------

def _apply_forum_metadata(row: LikesQuotaDaily, forum: ForumUser | None) -> None:
    if not forum:
        return
    if forum.forum_user_id:
        row.forum_user_id = forum.forum_user_id
    if forum.username:
        row.forum_username = forum.username
    if forum.userslug:
        row.forum_userslug = forum.userslug


async def _get_or_create_row(
    db: AsyncSession, principal_id: str, day: dt.date, forum: ForumUser | None
) -> LikesQuotaDaily:
    row = await _get_row(db, principal_id, day)
    if row is None:
        row = LikesQuotaDaily(
            user_id=principal_id,
            date=day,
            likes_today=0,
            daily_limit=settings.likes_quota_daily_limit,
            per_user_limit=settings.likes_quota_per_user_limit,
            target_users={},
            liked_posts={},
        )
        _apply_forum_metadata(row, forum)
        db.add(row)
        await db.flush()
    else:
        _apply_forum_metadata(row, forum)
    return row


async def _already_processed(db: AsyncSession, principal_id: str, client_event_id: str | None) -> bool:
    if not client_event_id:
        return False
    existing = await db.scalar(
        select(LikesQuotaEvent.id).where(
            LikesQuotaEvent.user_id == principal_id,
            LikesQuotaEvent.client_event_id == client_event_id,
        )
    )
    return existing is not None


def _record_event(
    db: AsyncSession,
    *,
    principal_id: str,
    day: dt.date,
    type_: str,
    delta: int,
    previous: int,
    new: int,
    post_id: str | None = None,
    topic_id: str | None = None,
    target_user_id: str | None = None,
    target_username: str | None = None,
    client_event_id: str | None = None,
) -> None:
    db.add(
        LikesQuotaEvent(
            user_id=principal_id,
            date=day,
            type=type_,
            delta=delta,
            previous_likes_today=previous,
            new_likes_today=new,
            post_id=post_id,
            topic_id=topic_id,
            target_user_id=target_user_id,
            target_username=target_username,
            client_event_id=client_event_id,
        )
    )


# ---- mutations -------------------------------------------------------------

async def increment(db: AsyncSession, principal_id: str, payload) -> dict:
    day = israel_today()

    # idempotent retry: same client event -> return current state, do not re-count
    if await _already_processed(db, principal_id, payload.client_event_id):
        row = await _get_row(db, principal_id, day)
        return build_state(row, day)

    row = await _get_or_create_row(db, principal_id, day, payload.forum_user)

    liked = dict(row.liked_posts or {})
    # per-post dedup: this post is already counted today -> no-op (idempotent)
    if payload.post_id and payload.post_id in liked:
        return build_state(row, day)

    prev = row.likes_today
    new_val = min(prev + 1, row.daily_limit)

    key = _target_key(payload.target_user_id, payload.target_username)
    tu = dict(row.target_users or {})
    entry = dict(tu.get(key) or {"username": payload.target_username, "count": 0})
    entry["count"] = int(entry.get("count", 0)) + 1
    if payload.target_username:
        entry["username"] = payload.target_username
    tu[key] = entry

    if payload.post_id:
        liked[payload.post_id] = key

    # reassign (not in-place mutate) so SQLAlchemy persists the JSON change
    row.target_users = tu
    row.liked_posts = liked
    row.likes_today = new_val

    _record_event(
        db, principal_id=principal_id, day=day, type_="increment",
        delta=new_val - prev, previous=prev, new=new_val,
        post_id=payload.post_id, topic_id=payload.topic_id,
        target_user_id=payload.target_user_id, target_username=payload.target_username,
        client_event_id=payload.client_event_id,
    )
    return build_state(row, day)


async def decrement(db: AsyncSession, principal_id: str, payload) -> dict:
    day = israel_today()

    if await _already_processed(db, principal_id, payload.client_event_id):
        row = await _get_row(db, principal_id, day)
        return build_state(row, day)

    row = await _get_row(db, principal_id, day)
    if row is None:
        # nothing to decrement on a fresh day
        return build_state(None, day)
    _apply_forum_metadata(row, payload.forum_user)

    liked = dict(row.liked_posts or {})
    # only undo a post we actually counted (idempotent otherwise)
    if payload.post_id and payload.post_id not in liked:
        return build_state(row, day)

    prev = row.likes_today
    new_val = max(prev - 1, 0)

    key = (payload.post_id and liked.get(payload.post_id)) or _target_key(
        payload.target_user_id, payload.target_username
    )
    tu = dict(row.target_users or {})
    if key in tu:
        cnt = max(0, int(tu[key].get("count", 0)) - 1)
        if cnt <= 0:
            tu.pop(key, None)
        else:
            tu[key]["count"] = cnt

    if payload.post_id and payload.post_id in liked:
        liked.pop(payload.post_id, None)

    row.target_users = tu
    row.liked_posts = liked
    row.likes_today = new_val

    _record_event(
        db, principal_id=principal_id, day=day, type_="decrement",
        delta=new_val - prev, previous=prev, new=new_val,
        post_id=payload.post_id, topic_id=payload.topic_id,
        target_user_id=payload.target_user_id, target_username=payload.target_username,
        client_event_id=payload.client_event_id,
    )
    return build_state(row, day)


async def set_today(db: AsyncSession, principal_id: str, likes_today: int, reason: str | None, forum) -> dict:
    day = israel_today()
    limit = settings.likes_quota_daily_limit
    if likes_today < 0 or likes_today > limit:
        raise APIError(
            ErrorCode.VALIDATION_ERROR,
            f"likesToday חייב להיות בין 0 ל-{limit}",
            status_code=422,
        )
    row = await _get_or_create_row(db, principal_id, day, forum)
    prev = row.likes_today
    row.likes_today = likes_today
    row.manual_override = True
    _record_event(
        db, principal_id=principal_id, day=day, type_="set",
        delta=likes_today - prev, previous=prev, new=likes_today,
        client_event_id=None,
    )
    return build_state(row, day)


async def reset_today(db: AsyncSession, principal_id: str, reason: str | None, forum) -> dict:
    day = israel_today()
    row = await _get_or_create_row(db, principal_id, day, forum)
    prev = row.likes_today
    row.likes_today = 0
    row.target_users = {}
    row.liked_posts = {}
    row.manual_override = True
    _record_event(
        db, principal_id=principal_id, day=day, type_="reset",
        delta=-prev, previous=prev, new=0, client_event_id=None,
    )
    return build_state(row, day)
