"""Likes-quota meter API for the mitmachim.top extension.

Auth reuses the platform's existing bearer auth (JWT session token or API
token). The quota row is keyed by the AUTHENTICATED principal, so a client can
never read or modify another user's count by sending a different forum id.

A DEV-ONLY fallback (header `X-Dev-Quota-User`) lets the extension be tested
without a login; it is gated behind both `environment != production` AND the
`likes_quota_dev_auth` flag, so it can never be reached in production.
"""
from __future__ import annotations

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
    source: str  # "user" | "dev"


async def get_quota_principal(request: Request, user: OptionalUser) -> QuotaPrincipal:
    # 1) real authenticated platform user (production path)
    if user is not None:
        return QuotaPrincipal(id=user.id, source="user")
    # 2) DEV ONLY fallback - impossible to reach in production
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
) -> dict:
    principal = await get_quota_principal(request, user)
    forum = ForumUser(forum_user_id=forumUserId, username=username, userslug=userslug)
    return await svc.get_today(db, principal.id, forum)


@router.post("/increment")
async def increment(
    body: IncrementRequest, request: Request, user: OptionalUser, db: DBSession
) -> dict:
    principal = await get_quota_principal(request, user)
    return await svc.increment(db, principal.id, body)


@router.post("/decrement")
async def decrement(
    body: DecrementRequest, request: Request, user: OptionalUser, db: DBSession
) -> dict:
    principal = await get_quota_principal(request, user)
    return await svc.decrement(db, principal.id, body)


@router.post("/set")
async def set_today(
    body: SetRequest, request: Request, user: OptionalUser, db: DBSession
) -> dict:
    principal = await get_quota_principal(request, user)
    return await svc.set_today(db, principal.id, body.likes_today, body.reason, body.forum_user)


@router.post("/reset")
async def reset_today(
    body: ResetRequest, request: Request, user: OptionalUser, db: DBSession
) -> dict:
    principal = await get_quota_principal(request, user)
    return await svc.reset_today(db, principal.id, body.reason, body.forum_user)
