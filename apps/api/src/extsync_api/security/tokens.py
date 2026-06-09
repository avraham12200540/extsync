"""JWT access tokens, opaque refresh/session tokens, and API tokens."""
from __future__ import annotations

import datetime as dt
import secrets

import jwt

from ..config import settings
from .crypto import hash_token

ALGO = "HS256"
ACCESS_AUDIENCE = "extsync:access"


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def create_access_token(
    user_id: str, *, session_id: str, extra: dict | None = None
) -> str:
    now = _now()
    claims = {
        "sub": user_id,
        "sid": session_id,
        "aud": ACCESS_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(seconds=settings.jwt_access_ttl_seconds)).timestamp()),
        "typ": "access",
    }
    if extra:
        claims.update(extra)
    return jwt.encode(claims, settings.jwt_secret, algorithm=ALGO)


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError subclasses on invalid/expired tokens."""
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[ALGO],
        audience=ACCESS_AUDIENCE,
        options={"require": ["exp", "sub", "sid"]},
    )


def new_opaque_token(nbytes: int = 32) -> str:
    """High-entropy opaque token (refresh, email-verify, reset, device codes)."""
    return secrets.token_urlsafe(nbytes)


def new_refresh_token() -> tuple[str, str]:
    """Returns (raw_token, token_hash). Store only the hash."""
    raw = new_opaque_token(48)
    return raw, hash_token(raw)


# ---- API tokens (CLI / CI) ------------------------------------------------
API_TOKEN_PREFIX = "exsk"


def new_api_token() -> tuple[str, str, str]:
    """Returns (full_token_shown_once, short_prefix, token_hash).

    Format: exsk_<prefix>.<secret>  — only the hash of the full token is stored.
    """
    short = secrets.token_hex(4)  # 8 hex chars displayed for identification
    secret = secrets.token_urlsafe(32)
    full = f"{API_TOKEN_PREFIX}_{short}.{secret}"
    return full, short, hash_token(full)


def short_user_code() -> str:
    """Human-typed device-flow code, e.g. 'WXYZ-1234' (§20)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no ambiguous chars
    part = lambda: "".join(secrets.choice(alphabet) for _ in range(4))  # noqa: E731
    return f"{part()}-{part()}"
