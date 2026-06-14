"""Google OAuth login / signup - server-side redirect (authorization code) flow.

Why server-side (not the Google JS SDK): no third-party script, so the strict
nonce-CSP on the web stays untouched, and the client secret never reaches the
browser. Security properties:
  * one-time `state` stored in Redis (consumed atomically) -> CSRF protection.
  * fixed redirect targets only (never a client-supplied URL) -> no open redirect.
  * code is exchanged server-to-server; we read the verified email from Google's
    userinfo endpoint and require email_verified.
  * conservative account linking: a Google identity is auto-attached to an
    existing local account ONLY when that account's email is already verified, so
    a pre-registration squat (someone who registered an unverified row with your
    email) can never be silently taken over.
"""
from __future__ import annotations

import datetime as dt
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from ..config import settings
from ..deps import DBSession
from ..logging import get_logger
from ..models.enums import UserRole
from ..models.user import DeveloperProfile, User
from ..redis_client import get_redis
from ..security.tokens import new_opaque_token
from ..services import auth_service as svc
from ..services.audit import record_audit
from ..services.ratelimit import client_ip, enforce_rate_limit
from .auth import _set_refresh_cookie

logger = get_logger("extsync.oauth.google")
router = APIRouter(prefix="/auth/google", tags=["auth"])

_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
_STATE_PREFIX = "oauth:google:state:"
_STATE_COOKIE = "extsync_oauth_state"
_STATE_TTL = 600


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _configured() -> bool:
    return bool(settings.google_oauth_client_id and settings.google_oauth_client_secret)


def _redirect_uri() -> str:
    return f"{settings.public_api_url}/auth/google/callback"


def _fail(reason: str) -> RedirectResponse:
    """Send the browser back to the login page with a generic error flag.

    The reason is logged server-side only; the user sees a generic message (no
    detail leakage). 303 so the browser issues a clean GET.
    """
    logger.warning("google oauth failed: %s", reason)
    return RedirectResponse(f"{settings.public_web_url}/login?oauth=failed", status_code=303)


def _set_state_cookie(resp: RedirectResponse, state: str) -> None:
    # Binds the flow to THIS browser; the callback double-submit-checks it.
    resp.set_cookie(_STATE_COOKIE, state, max_age=_STATE_TTL, httponly=True,
                    secure=settings.session_cookie_secure or settings.is_production,
                    samesite="lax", path="/auth/google")


def _clear_state_cookie(resp: RedirectResponse) -> None:
    resp.delete_cookie(_STATE_COOKIE, path="/auth/google")


@router.get("/start")
async def google_start(request: Request) -> RedirectResponse:
    if not _configured():
        return _fail("not_configured")
    # Light per-IP cap so the state-issuing endpoint can't be used to spam Redis.
    await enforce_rate_limit(f"google-start:{client_ip(request)}", limit=30, window_seconds=300)
    state = new_opaque_token(24)
    await get_redis().set(f"{_STATE_PREFIX}{state}", "1", ex=_STATE_TTL)
    params = {
        "client_id": settings.google_oauth_client_id,
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    resp = RedirectResponse(f"{_AUTH_URL}?{urlencode(params)}", status_code=303)
    _set_state_cookie(resp, state)
    return resp


@router.get("/callback")
async def google_callback(
    request: Request,
    db: DBSession,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    if error or not code or not state:
        return _fail(error or "missing_code_or_state")
    if not _configured():
        return _fail("not_configured")
    await enforce_rate_limit(f"google-callback:{client_ip(request)}", limit=30, window_seconds=300)

    # Browser binding (double-submit): the query state MUST equal the cookie set on
    # this browser at /start. THIS is what stops OAuth login-CSRF / session fixation;
    # the one-time Redis token below only prevents replay.
    cookie_state = request.cookies.get(_STATE_COOKIE)
    if not cookie_state or cookie_state != state:
        return _fail("state_browser_mismatch")
    consumed = await get_redis().getdel(f"{_STATE_PREFIX}{state}")
    if not consumed:
        return _fail("bad_or_expired_state")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            tok = await client.post(_TOKEN_URL, data={
                "code": code,
                "client_id": settings.google_oauth_client_id,
                "client_secret": settings.google_oauth_client_secret,
                "redirect_uri": _redirect_uri(),
                "grant_type": "authorization_code",
            })
            if tok.status_code != 200:
                return _fail(f"token_exchange_{tok.status_code}")
            access_tok = tok.json().get("access_token")
            if not access_tok:
                return _fail("no_access_token")
            ui = await client.get(_USERINFO_URL, headers={"Authorization": f"Bearer {access_tok}"})
            if ui.status_code != 200:
                return _fail(f"userinfo_{ui.status_code}")
            info = ui.json()
    except httpx.HTTPError as exc:
        return _fail(f"http_error:{exc}")

    sub = info.get("sub")
    email = (info.get("email") or "").strip().lower()
    email_verified = info.get("email_verified") in (True, "true", "True")
    name = (info.get("name") or (email.split("@")[0] if email else "")).strip()
    if not sub or not email or not email_verified:
        return _fail("incomplete_or_unverified_profile")

    user = await _resolve_user(db, sub=sub, email=email, name=name)
    if user is None:
        return _fail("link_conflict")
    if user.is_suspended or not user.is_active:
        return _fail("account_disabled")

    # 2FA must not be skipped by OAuth: hand off to the existing second-factor
    # challenge (same token the password login uses) instead of issuing a session.
    if user.two_factor_enabled:
        challenge = svc._make_challenge(user.id)
        resp = RedirectResponse(
            f"{settings.public_web_url}/login?{urlencode({'challenge': challenge})}",
            status_code=303,
        )
        _clear_state_cookie(resp)
        return resp

    ip = client_ip(request)
    _, raw_refresh, _ = await svc.create_session(db, user, ip=ip,
                                                 user_agent=request.headers.get("user-agent"))
    await svc.post_login_side_effects(db, user, ip=ip)
    redirect = RedirectResponse(f"{settings.public_web_url}/app", status_code=303)
    _set_refresh_cookie(redirect, raw_refresh)
    _clear_state_cookie(redirect)
    return redirect


async def _resolve_user(db, *, sub: str, email: str, name: str) -> User | None:
    # 1) Already linked to this Google account.
    user = await db.scalar(select(User).where(User.google_sub == sub))
    if user is not None:
        return None if user.deleted_at is not None else user
    # 2) A local account already uses this email.
    existing = await db.scalar(select(User).where(User.email == email))
    if existing is not None:
        if existing.deleted_at is not None:
            return None  # closed / soft-deleted account: never resurrect via OAuth
        if not existing.email_verified:
            # Could be a pre-registration squat - refuse to auto-link. The owner
            # logs in with their password first (then we could link in settings).
            return None
        existing.google_sub = sub
        await record_audit(db, action="auth.google_linked", actor_user_id=existing.id,
                           target_type="user", target_id=existing.id)
        return existing
    # 3) Brand-new account from a Google-verified email.
    user = User(
        email=email,
        password_hash=None,
        display_name=(name or email)[:120],
        role=UserRole.developer,
        email_verified=True,
        google_sub=sub,
    )
    db.add(user)
    await db.flush()
    db.add(DeveloperProfile(user_id=user.id, org_name="", accepted_terms_at=_now()))
    await record_audit(db, action="auth.google_signup", actor_user_id=user.id,
                       target_type="user", target_id=user.id)
    return user
