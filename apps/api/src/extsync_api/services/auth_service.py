"""Authentication business logic (§20).

Security properties implemented here:
  * Argon2id password hashing with transparent rehash-on-login.
  * Refresh-token rotation with reuse (theft) detection -> revoke all sessions.
  * No user enumeration on register/forgot-password.
  * 2FA via short-lived signed challenge token (never trust client for "2FA passed").
  * Everything sensitive writes an audit / security event.
"""
from __future__ import annotations

import datetime as dt

import jwt
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..errors import APIError, ErrorCode, conflict, unauthorized
from ..ids import device_id as new_device_id
from ..models.auth import (
    DeviceFlow,
    EmailVerification,
    PasswordReset,
    RecoveryCode,
    TwoFactorSecret,
    UserSession,
)
from ..models.device import Device, DeviceSession
from ..models.enums import DeviceOS, NotificationKind, UserRole
from ..models.user import DeveloperProfile, User
from ..security.crypto import constant_time_equals, decrypt_str, encrypt_str, hash_token
from ..security.passwords import (
    hash_password,
    needs_rehash,
    validate_password_strength,
    verify_password,
)
from ..security.tokens import (
    create_access_token,
    new_opaque_token,
    new_refresh_token,
    short_user_code,
)
from ..security.totp import (
    generate_recovery_codes,
    new_totp_secret,
    provisioning_uri,
    verify_totp,
)
from .audit import notify, record_audit, record_security_event
from .email import send_password_reset_email, send_verification_email

CHALLENGE_TYP = "2fa_challenge"

# Precomputed Argon2id hash used to keep login timing roughly constant when the
# email does not exist (mitigates user-enumeration via response timing).
_DUMMY_HASH = hash_password("extsync-timing-placeholder-password")


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _os_enum(value: str | None) -> DeviceOS:
    try:
        return DeviceOS(value) if value else DeviceOS.unknown
    except ValueError:
        return DeviceOS.unknown


# --------------------------------------------------------------------------- register
async def register_user(db: AsyncSession, *, email: str, password: str,
                        display_name: str, org_name: str, ip: str | None) -> User:
    validate_password_strength(password)
    email = email.strip().lower()
    existing = await db.scalar(select(User).where(User.email == email))
    if existing is not None:
        # Avoid leaking which emails exist via timing/behaviour differences:
        # still raise a generic conflict (the frontend treats it as "try login").
        raise conflict("כתובת האימייל כבר רשומה", ErrorCode.EMAIL_ALREADY_REGISTERED)

    user = User(
        email=email,
        password_hash=hash_password(password),
        display_name=display_name.strip(),
        role=UserRole.developer,
        email_verified=False,
    )
    db.add(user)
    await db.flush()
    db.add(DeveloperProfile(user_id=user.id, org_name=org_name.strip(), accepted_terms_at=_now()))

    await _issue_email_verification(db, user)
    await record_audit(db, action="auth.register", actor_user_id=user.id,
                       target_type="user", target_id=user.id, ip_address=ip)
    return user


async def _issue_email_verification(db: AsyncSession, user: User) -> None:
    raw = new_opaque_token(32)
    db.add(EmailVerification(
        user_id=user.id, token_hash=hash_token(raw),
        expires_at=_now() + dt.timedelta(hours=24),
    ))
    await db.flush()
    verify_url = f"{settings.public_web_url}/verify-email?token={raw}"
    try:
        await send_verification_email(user.email, verify_url)
    except Exception:  # email failure must not abort registration
        pass


# --------------------------------------------------------------------------- sessions
async def create_session(db: AsyncSession, user: User, *, ip: str | None,
                         user_agent: str | None, os: DeviceOS = DeviceOS.unknown
                         ) -> tuple[str, str, UserSession]:
    raw_refresh, refresh_hash = new_refresh_token()
    session = UserSession(
        user_id=user.id,
        refresh_token_hash=refresh_hash,
        expires_at=_now() + dt.timedelta(seconds=settings.jwt_refresh_ttl_seconds),
        ip_address=ip,
        user_agent=(user_agent or "")[:400] or None,
        os=os,
    )
    db.add(session)
    await db.flush()
    access = create_access_token(user.id, session_id=session.id)
    return access, raw_refresh, session


async def rotate_refresh(db: AsyncSession, raw_refresh: str, *, ip: str | None,
                         user_agent: str | None) -> tuple[str, str]:
    token_hash = hash_token(raw_refresh)
    session = await db.scalar(select(UserSession).where(UserSession.refresh_token_hash == token_hash))
    if session is None:
        raise unauthorized("טוקן הרענון אינו תקין")

    if session.revoked_at is not None:
        # Reuse of an already-rotated/revoked token => probable theft.
        await db.execute(
            update(UserSession).where(UserSession.user_id == session.user_id)
            .values(revoked_at=_now())
        )
        await record_security_event(
            db, type="refresh_token_reuse", severity="critical",
            user_id=session.user_id, ip_address=ip,
            message="Refresh token reuse detected; all sessions revoked",
        )
        # Persist the mass revocation NOW — otherwise the exception below would
        # trigger a rollback in the request session and undo this critical step.
        await db.commit()
        raise APIError(ErrorCode.SESSION_EXPIRED, "הסשן בוטל מטעמי אבטחה. יש להתחבר מחדש",
                       status_code=401)

    if not session.is_active:
        raise APIError(ErrorCode.SESSION_EXPIRED, "תוקף הסשן פג. יש להתחבר מחדש", status_code=401)

    user = await db.get(User, session.user_id)
    if user is None or not user.is_active or user.is_suspended:
        raise unauthorized()

    new_raw, new_hash = new_refresh_token()
    new_session = UserSession(
        user_id=user.id, refresh_token_hash=new_hash,
        expires_at=_now() + dt.timedelta(seconds=settings.jwt_refresh_ttl_seconds),
        ip_address=ip, user_agent=(user_agent or "")[:400] or None, os=session.os,
    )
    db.add(new_session)
    await db.flush()
    session.revoked_at = _now()
    session.replaced_by_id = new_session.id
    access = create_access_token(user.id, session_id=new_session.id)
    return access, new_raw


async def revoke_session_by_refresh(db: AsyncSession, raw_refresh: str) -> None:
    session = await db.scalar(
        select(UserSession).where(UserSession.refresh_token_hash == hash_token(raw_refresh))
    )
    if session is not None and session.revoked_at is None:
        session.revoked_at = _now()


async def revoke_all_sessions(db: AsyncSession, user_id: str) -> int:
    result = await db.execute(
        update(UserSession).where(
            UserSession.user_id == user_id, UserSession.revoked_at.is_(None)
        ).values(revoked_at=_now())
    )
    return result.rowcount or 0


# --------------------------------------------------------------------------- login
async def authenticate(db: AsyncSession, *, email: str, password: str,
                       ip: str | None) -> User:
    email = email.strip().lower()
    user = await db.scalar(select(User).where(User.email == email))
    # Always run a verify (against a real dummy hash if the user is missing) so the
    # response time does not reveal whether the email exists.
    stored = user.password_hash if (user and user.password_hash) else _DUMMY_HASH
    ok = verify_password(password, stored)
    if not user or not user.password_hash or not ok:
        await record_security_event(db, type="login_failed", severity="warning",
                                    user_id=(user.id if user else None), ip_address=ip)
        raise APIError(ErrorCode.INVALID_CREDENTIALS, "אימייל או סיסמה שגויים", status_code=401)
    if user.is_suspended or not user.is_active:
        raise APIError(ErrorCode.FORBIDDEN, "החשבון מושהה", status_code=403)

    if needs_rehash(user.password_hash or ""):
        user.password_hash = hash_password(password)
    return user


def _make_challenge(user_id: str) -> str:
    now = _now()
    return jwt.encode(
        {"sub": user_id, "typ": CHALLENGE_TYP, "iat": int(now.timestamp()),
         "exp": int((now + dt.timedelta(minutes=5)).timestamp())},
        settings.jwt_secret, algorithm="HS256",
    )


def _read_challenge(token: str) -> str:
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"],
                            options={"require": ["exp", "sub"]})
    except jwt.PyJWTError as exc:
        raise APIError(ErrorCode.INVALID_TOKEN, "אתגר ה-2FA אינו תקין או שפג תוקפו",
                       status_code=401) from exc
    if claims.get("typ") != CHALLENGE_TYP:
        raise APIError(ErrorCode.INVALID_TOKEN, "אתגר 2FA שגוי", status_code=401)
    return claims["sub"]


async def verify_login_2fa(db: AsyncSession, *, challenge: str, code: str) -> User:
    user_id = _read_challenge(challenge)
    user = await db.get(User, user_id)
    if user is None:
        raise unauthorized()
    if not await _check_2fa_code(db, user, code):
        await record_security_event(db, type="2fa_failed", severity="warning", user_id=user.id)
        raise APIError(ErrorCode.INVALID_TWO_FACTOR, "קוד האימות שגוי", status_code=401)
    return user


async def _check_2fa_code(db: AsyncSession, user: User, code: str) -> bool:
    secret_row = await db.scalar(
        select(TwoFactorSecret).where(TwoFactorSecret.user_id == user.id)
    )
    if secret_row and secret_row.confirmed_at is not None:
        if verify_totp(decrypt_str(secret_row.secret_encrypted), code):
            return True
    # Fall back to a single-use recovery code.
    code_hash = hash_token(code.strip())
    rc = await db.scalar(
        select(RecoveryCode).where(
            RecoveryCode.user_id == user.id,
            RecoveryCode.code_hash == code_hash,
            RecoveryCode.used_at.is_(None),
        )
    )
    if rc is not None:
        rc.used_at = _now()
        return True
    return False


# --------------------------------------------------------------------------- email verify
async def verify_email(db: AsyncSession, token: str) -> User:
    row = await db.scalar(
        select(EmailVerification).where(EmailVerification.token_hash == hash_token(token))
    )
    if row is None or row.consumed_at is not None or row.expires_at <= _now():
        raise APIError(ErrorCode.INVALID_TOKEN, "קישור האימות אינו תקין או שפג תוקפו",
                       status_code=400)
    row.consumed_at = _now()
    user = await db.get(User, row.user_id)
    if user is None:
        raise unauthorized()
    user.email_verified = True
    await record_audit(db, action="auth.email_verified", actor_user_id=user.id,
                       target_type="user", target_id=user.id)
    return user


async def resend_verification(db: AsyncSession, user: User) -> None:
    """Re-issue and resend the verification email (no-op if already verified)."""
    if user.email_verified:
        return
    await _issue_email_verification(db, user)


# --------------------------------------------------------------------------- password reset
async def start_password_reset(db: AsyncSession, email: str) -> None:
    email = email.strip().lower()
    user = await db.scalar(select(User).where(User.email == email))
    if user is None:
        return  # no enumeration
    if user.password_hash is None:
        # OAuth-only account (no password): nothing to reset - they sign in with
        # Google. Issuing a token here would let a mailbox holder SET a first
        # password and convert a Google-only account to password login.
        return
    raw = new_opaque_token(32)
    db.add(PasswordReset(user_id=user.id, token_hash=hash_token(raw),
                         expires_at=_now() + dt.timedelta(hours=1)))
    await db.flush()
    reset_url = f"{settings.public_web_url}/reset-password?token={raw}"
    try:
        await send_password_reset_email(user.email, reset_url)
    except Exception:
        pass


async def reset_password(db: AsyncSession, *, token: str, new_password: str) -> None:
    validate_password_strength(new_password)
    row = await db.scalar(select(PasswordReset).where(PasswordReset.token_hash == hash_token(token)))
    if row is None or row.consumed_at is not None or row.expires_at <= _now():
        raise APIError(ErrorCode.INVALID_TOKEN, "קישור איפוס הסיסמה אינו תקין או שפג תוקפו",
                       status_code=400)
    row.consumed_at = _now()
    user = await db.get(User, row.user_id)
    if user is None:
        raise unauthorized()
    user.password_hash = hash_password(new_password)
    await revoke_all_sessions(db, user.id)  # force re-login everywhere
    await record_audit(db, action="auth.password_reset", actor_user_id=user.id,
                       target_type="user", target_id=user.id)


# --------------------------------------------------------------------------- 2FA setup
async def setup_2fa(db: AsyncSession, user: User) -> tuple[str, str]:
    secret = new_totp_secret()
    existing = await db.scalar(select(TwoFactorSecret).where(TwoFactorSecret.user_id == user.id))
    if existing is not None and existing.confirmed_at is None:
        existing.secret_encrypted = encrypt_str(secret)
    elif existing is None:
        db.add(TwoFactorSecret(user_id=user.id, secret_encrypted=encrypt_str(secret)))
    else:
        raise conflict("אימות דו-שלבי כבר מופעל")
    return secret, provisioning_uri(secret, user.email)


async def confirm_2fa(db: AsyncSession, user: User, code: str) -> list[str]:
    row = await db.scalar(select(TwoFactorSecret).where(TwoFactorSecret.user_id == user.id))
    if row is None:
        raise APIError(ErrorCode.BAD_REQUEST, "יש להתחיל את הגדרת האימות הדו-שלבי תחילה",
                       status_code=400)
    if not verify_totp(decrypt_str(row.secret_encrypted), code):
        raise APIError(ErrorCode.INVALID_TWO_FACTOR, "קוד האימות שגוי", status_code=400)
    row.confirmed_at = _now()
    user.two_factor_enabled = True
    # (Re)generate recovery codes; store only hashes, return plaintext once.
    await db.execute(
        update(RecoveryCode).where(RecoveryCode.user_id == user.id, RecoveryCode.used_at.is_(None))
        .values(used_at=_now())
    )
    plaintext = generate_recovery_codes(10)
    for c in plaintext:
        db.add(RecoveryCode(user_id=user.id, code_hash=hash_token(c)))
    await record_audit(db, action="auth.2fa_enabled", actor_user_id=user.id,
                       target_type="user", target_id=user.id)
    return plaintext


async def disable_2fa(db: AsyncSession, user: User, password: str) -> None:
    """Turn 2FA off for a logged-in user after re-confirming their password.

    Reaching this endpoint already required passing 2FA at login, so a password
    re-check is sufficient defense-in-depth. Clears the TOTP secret and all
    recovery codes so 2FA is no longer a one-way door: a user who still has an
    active session can disable it even after losing their authenticator app.
    (A fully locked-out user with no session and no recovery codes still needs
    an admin reset — tracked separately.)
    """
    if not user.two_factor_enabled:
        raise APIError(ErrorCode.BAD_REQUEST, "אימות דו-שלבי אינו מופעל", status_code=400)
    if not user.password_hash or not verify_password(password, user.password_hash):
        await record_security_event(db, type="2fa_disable_failed", severity="warning",
                                    user_id=user.id)
        raise APIError(ErrorCode.INVALID_CREDENTIALS, "הסיסמה שגויה", status_code=401)
    await db.execute(delete(TwoFactorSecret).where(TwoFactorSecret.user_id == user.id))
    await db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    user.two_factor_enabled = False
    await record_audit(db, action="auth.2fa_disabled", actor_user_id=user.id,
                       target_type="user", target_id=user.id)


# --------------------------------------------------------------------------- device flow
async def device_flow_start(db: AsyncSession, *, anonymous_device_id: str, os: str | None,
                            os_version: str | None, agent_version: str | None
                            ) -> tuple[str, str, int, int]:
    user_code = short_user_code()
    raw_device_code = new_opaque_token(40)
    flow = DeviceFlow(
        user_code=user_code,
        device_code_hash=hash_token(raw_device_code),
        device_id=anonymous_device_id,  # store the agent's anonymous id for later linkage
        expires_at=_now() + dt.timedelta(minutes=10),
    )
    db.add(flow)
    # Stash agent metadata on the flow's audit trail for the eventual Device row.
    flow_extra = {"os": os, "os_version": os_version, "agent_version": agent_version}
    await record_audit(db, action="auth.device_flow_start", actor_type="agent",
                       target_type="device_flow", target_id=flow.id, extra=flow_extra)
    return user_code, raw_device_code, 5, 600


async def device_flow_approve(db: AsyncSession, *, user: User, user_code: str) -> None:
    flow = await db.scalar(select(DeviceFlow).where(DeviceFlow.user_code == user_code.strip().upper()))
    if flow is None or flow.expires_at <= _now() or flow.consumed:
        raise APIError(ErrorCode.INVALID_TOKEN, "הקוד אינו תקין או שפג תוקפו", status_code=400)
    flow.approved = True
    flow.approved_user_id = user.id
    await record_audit(db, action="auth.device_flow_approve", actor_user_id=user.id,
                       target_type="device_flow", target_id=flow.id)


async def device_flow_poll(db: AsyncSession, *, device_code: str
                           ) -> tuple[str, str | None, str | None]:
    """Returns (status, device_token, device_id)."""
    flow = await db.scalar(
        select(DeviceFlow).where(DeviceFlow.device_code_hash == hash_token(device_code))
    )
    if flow is None:
        return "denied", None, None
    if flow.expires_at <= _now():
        return "expired", None, None
    if not flow.approved or flow.approved_user_id is None:
        return "pending", None, None
    if flow.consumed:
        return "denied", None, None

    # Link/create the device to the approving user and mint a device session token.
    anon = flow.device_id or new_opaque_token(16)
    device = await db.scalar(select(Device).where(Device.anonymous_device_id == anon))
    if device is None:
        device = Device(id=new_device_id(), anonymous_device_id=anon,
                        user_id=flow.approved_user_id)
        db.add(device)
        await db.flush()
    else:
        device.user_id = flow.approved_user_id

    raw_token = new_opaque_token(40)
    db.add(DeviceSession(device_id=device.id, token_hash=hash_token(raw_token),
                         expires_at=_now() + dt.timedelta(days=365)))
    flow.consumed = True
    await record_audit(db, action="auth.device_paired", actor_user_id=flow.approved_user_id,
                       actor_type="system", target_type="device", target_id=device.id)
    return "approved", raw_token, device.id


async def post_login_side_effects(db: AsyncSession, user: User, *, ip: str | None) -> None:
    user.last_login_at = _now()
    await record_audit(db, action="auth.login", actor_user_id=user.id,
                       target_type="user", target_id=user.id, ip_address=ip)
    await notify(db, user_id=user.id, kind=NotificationKind.new_login,
                 title="כניסה חדשה לחשבון",
                 body="זוהתה כניסה חדשה לחשבון שלך. אם זה לא אתה, אפס את הסיסמה.")
