"""Likes-quota meter API for the mitmachim.top extension.

Identity resolution (most-trusted first):
  1. Forum login - the `X-Forum-Session` header carries the user's base64-encoded
     mitmachim.top `express.sid` cookie; the server confirms it with NodeBB
     (/api/self) and keys the quota by the verified forum uid. This is the
     primary path and needs no ExtSync token, so any forum user just works.
  2. ExtSync bearer token (JWT session or API token) - admin/fallback path.
  3. DEV-ONLY `X-Dev-Quota-User` header, gated to non-production.

The quota is always keyed by a server-verified principal, never by a
client-supplied forum id, so a client can never read or modify another user's
count.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass

from fastapi import APIRouter, Query, Request

from ..config import settings
from ..deps import DBSession, OptionalUser
from ..errors import unauthorized
from ..schemas.likes_quota import (
    DecrementRequest,
    ForumUser,
    IncrementRequest,
    ResetRequest,
    SetRequest,
)
from ..services import likes_quota_service as svc

router = APIRouter(prefix="/api/likes-quota", tags=["likes-quota"])


@dataclass
class QuotaPrincipal:
    id: str
    source: str  # "forum" | "user" | "dev"
    forum: ForumUser | None = None
    cookie: str | None = None  # raw forum session cookie (forum source only)


def _decode_forum_cookie(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        return base64.b64decode(raw).decode("utf-8").strip() or None
    except Exception:  # noqa: BLE001 - malformed header -> just skip this path
        return None


async def get_quota_principal(request: Request, user: OptionalUser) -> QuotaPrincipal:
    # 1) forum login, verified server-side against NodeBB (primary path)
    cookie = _decode_forum_cookie(request.headers.get("x-forum-session"))
    identity = await svc.verify_forum_session(cookie)
    if identity:
        forum = ForumUser(
            forum_user_id=identity["forumUserId"],
            username=identity.get("username"),
            userslug=identity.get("userslug"),
        )
        return QuotaPrincipal(id=f"forum:{identity['forumUserId']}", source="forum", forum=forum, cookie=cookie)

    # 2) ExtSync platform user (admin / fallback)
    if user is not None:
        return QuotaPrincipal(id=user.id, source="user")

    # 3) DEV ONLY fallback - impossible to reach in production
    if not settings.is_production and settings.likes_quota_dev_auth:
        dev = request.headers.get("x-dev-quota-user")
        if dev:
            return QuotaPrincipal(id="dev:" + dev[:48], source="dev")

    raise unauthorized("נדרשת הזדהות לסנכרון מד הלייקים")


@router.get("/today")
async def get_today(
    request: Request,
    user: OptionalUser,
    db: DBSession,
    forumUserId: str | None = Query(default=None),
    username: str | None = Query(default=None),
    userslug: str | None = Query(default=None),
    fresh: bool = Query(default=False),
) -> dict:
    principal = await get_quota_principal(request, user)
    # Forum login: derive today's count from the forum itself (self-correcting).
    if principal.source == "forum" and principal.forum:
        return await svc.sync_today_from_forum(
            db, principal.id, principal.forum.userslug, principal.cookie, principal.forum, fresh=fresh,
        )
    # Other identities: return the stored counter (click/manual model).
    forum = principal.forum or ForumUser(forum_user_id=forumUserId, username=username, userslug=userslug)
    return await svc.get_today(db, principal.id, forum)


@router.post("/increment")
async def increment(
    body: IncrementRequest, request: Request, user: OptionalUser, db: DBSession
) -> dict:
    principal = await get_quota_principal(request, user)
    if principal.forum:
        body.forum_user = principal.forum
    return await svc.increment(db, principal.id, body)


@router.post("/decrement")
async def decrement(
    body: DecrementRequest, request: Request, user: OptionalUser, db: DBSession
) -> dict:
    principal = await get_quota_principal(request, user)
    if principal.forum:
        body.forum_user = principal.forum
    return await svc.decrement(db, principal.id, body)


@router.post("/set")
async def set_today(
    body: SetRequest, request: Request, user: OptionalUser, db: DBSession
) -> dict:
    principal = await get_quota_principal(request, user)
    forum = principal.forum or body.forum_user
    return await svc.set_today(db, principal.id, body.likes_today, body.reason, forum)


@router.post("/reset")
async def reset_today(
    body: ResetRequest, request: Request, user: OptionalUser, db: DBSession
) -> dict:
    principal = await get_quota_principal(request, user)
    forum = principal.forum or body.forum_user
    return await svc.reset_today(db, principal.id, body.reason, forum)
