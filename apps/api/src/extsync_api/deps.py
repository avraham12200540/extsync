"""Shared FastAPI dependencies: DB session, current user, role guards."""
from __future__ import annotations

import datetime as dt
from typing import Annotated

import jwt
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_session
from .errors import ErrorCode, forbidden, unauthorized
from .models.api_token import ApiToken
from .models.auth import UserSession
from .models.device import Device, DeviceSession
from .models.enums import UserRole
from .models.user import User
from .security.crypto import hash_token
from .security.tokens import API_TOKEN_PREFIX, decode_access_token

DBSession = Annotated[AsyncSession, Depends(get_session)]


def _bearer_token(request: Request) -> str | None:
    auth = request.headers.get("authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return None
    return auth[7:].strip() or None


async def _user_from_api_token(db: AsyncSession, token: str) -> User | None:
    row = await db.scalar(select(ApiToken).where(ApiToken.token_hash == hash_token(token)))
    if row is None or not row.is_active:
        return None
    row.last_used_at = dt.datetime.now(dt.timezone.utc)
    return await db.get(User, row.user_id)


async def _user_from_access_token(db: AsyncSession, token: str) -> User | None:
    try:
        claims = decode_access_token(token)
    except jwt.PyJWTError:
        return None
    session = await db.get(UserSession, claims.get("sid"))
    if session is None or not session.is_active:
        return None
    user = await db.get(User, claims.get("sub"))
    if user is None or not user.is_active or user.is_suspended:
        return None
    return user


async def get_optional_user(request: Request, db: DBSession) -> User | None:
    token = _bearer_token(request)
    if token is None:
        return None
    if token.startswith(API_TOKEN_PREFIX + "_"):
        return await _user_from_api_token(db, token)
    return await _user_from_access_token(db, token)


async def get_current_user(
    user: Annotated[User | None, Depends(get_optional_user)],
) -> User:
    if user is None:
        raise unauthorized()
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


def require_role(*roles: UserRole):
    async def _dep(user: CurrentUser) -> User:
        if user.role not in roles and user.role != UserRole.platform_admin:
            raise forbidden()
        return user

    return _dep


async def require_admin(user: CurrentUser) -> User:
    if user.role != UserRole.platform_admin:
        raise forbidden("נדרשת הרשאת מנהל מערכת")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def require_verified_email(user: CurrentUser) -> User:
    if not user.email_verified:
        raise unauthorized("יש לאמת את כתובת האימייל לפני ביצוע הפעולה")
    return user


def require_verified_for_publish(user: CurrentUser) -> User:
    """Gate publishing to the public store on a verified email — but only when the
    platform enables it (so nothing breaks before email delivery is configured)."""
    if settings.enforce_email_verification and not user.email_verified:
        raise forbidden("יש לאמת את כתובת האימייל לפני פרסום לחנות הציבורית")
    return user


PublisherUser = Annotated[User, Depends(require_verified_for_publish)]


# ---- Agent (device) authentication --------------------------------------
async def get_current_device(request: Request, db: DBSession) -> Device:
    """Resolve the Agent's device from the X-Agent-Token header."""
    token = request.headers.get("x-agent-token")
    if not token:
        raise unauthorized("חסר טוקן Agent")
    session = await db.scalar(
        select(DeviceSession).where(DeviceSession.token_hash == hash_token(token))
    )
    now = dt.datetime.now(dt.timezone.utc)
    if session is None or session.revoked_at is not None or session.expires_at <= now:
        raise unauthorized("טוקן ה-Agent אינו תקין")
    device = await db.get(Device, session.device_id)
    if device is None:
        raise unauthorized()
    return device


CurrentDevice = Annotated[Device, Depends(get_current_device)]
