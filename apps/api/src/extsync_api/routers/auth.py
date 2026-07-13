"""Authentication endpoints (§23)."""
from __future__ import annotations

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..config import settings
from ..deps import CurrentUser, DBSession, OptionalUser
from ..errors import APIError, ErrorCode, unauthorized
from ..models.base import utcnow
from ..models.enums import DeviceOS, NotificationKind, UserRole
from ..models.user import DeveloperProfile
from ..schemas.auth import (
    DeviceFlowApproveRequest,
    DeviceFlowStartRequest,
    DeviceFlowStartResponse,
    DeviceFlowTokenRequest,
    DeviceFlowTokenResponse,
    ForgotPasswordRequest,
    LoginRequest,
    LoginResponse,
    MeResponse,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    TwoFactorDisableRequest,
    TwoFactorEnabledResponse,
    TwoFactorSetupResponse,
    TwoFactorVerifyRequest,
    UpdateMeRequest,
    VerifyEmailRequest,
)
from ..schemas.common import OkResponse
from ..security.crypto import hash_token
from ..services import auth_service as svc
from ..services.ratelimit import client_ip, enforce_rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = settings.session_cookie_name


def _set_refresh_cookie(response: Response, raw_refresh: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=raw_refresh,
        max_age=settings.jwt_refresh_ttl_seconds,
        httponly=True,
        # Always Secure in production (the cookie must never ride plain HTTP),
        # regardless of the env flag; dev over http stays usable.
        secure=settings.session_cookie_secure or settings.is_production,
        samesite=settings.session_cookie_samesite,
        path="/",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path="/")


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=OkResponse)
async def register(req: RegisterRequest, request: Request, db: DBSession) -> OkResponse:
    ip = client_ip(request)
    await enforce_rate_limit(f"register:{ip}", limit=settings.rate_limit_register_per_hour, window_seconds=3600)
    try:
        await svc.register_user(
            db, email=req.email, password=req.password,
            display_name=req.display_name, org_name=req.org_name, ip=ip,
            account_type=req.account_type,
        )
    except ValueError as exc:  # weak password
        raise APIError(ErrorCode.VALIDATION_ERROR, str(exc), status_code=422) from exc
    return OkResponse()


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, request: Request, response: Response, db: DBSession) -> LoginResponse:
    ip = client_ip(request)
    await enforce_rate_limit(f"login:{ip}", limit=settings.rate_limit_login_per_min, window_seconds=60)

    try:
        user = await svc.authenticate(db, email=req.email, password=req.password, ip=ip)
    except Exception:
        # Throttle FAILED attempts per-email (brute-force defense) but never on success,
        # so an attacker spamming a victim's address with wrong passwords cannot lock the
        # victim out - the victim's correct password never reaches this limiter.
        await enforce_rate_limit(f"login-fail:{req.email.lower()}", limit=10, window_seconds=300)
        raise
    if user.two_factor_enabled:
        return LoginResponse(two_factor_required=True, challenge=svc._make_challenge(user.id))

    ua = request.headers.get("user-agent")
    access, raw_refresh, _ = await svc.create_session(db, user, ip=ip, user_agent=ua)
    await svc.post_login_side_effects(db, user, ip=ip)
    _set_refresh_cookie(response, raw_refresh)
    return LoginResponse(access_token=access, expires_in=settings.jwt_access_ttl_seconds)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, response: Response, db: DBSession) -> TokenResponse:
    raw_refresh = request.cookies.get(REFRESH_COOKIE)
    if not raw_refresh:
        raise unauthorized("חסר טוקן רענון")
    ua = request.headers.get("user-agent")
    access, new_refresh = await svc.rotate_refresh(db, raw_refresh, ip=client_ip(request), user_agent=ua)
    _set_refresh_cookie(response, new_refresh)
    return TokenResponse(access_token=access, expires_in=settings.jwt_access_ttl_seconds)


@router.post("/logout", response_model=OkResponse)
async def logout(request: Request, response: Response, db: DBSession) -> OkResponse:
    raw_refresh = request.cookies.get(REFRESH_COOKIE)
    if raw_refresh:
        await svc.revoke_session_by_refresh(db, raw_refresh)
    _clear_refresh_cookie(response)
    return OkResponse()


@router.post("/logout-all", response_model=OkResponse)
async def logout_all(user: CurrentUser, response: Response, db: DBSession) -> OkResponse:
    await svc.revoke_all_sessions(db, user.id)
    _clear_refresh_cookie(response)
    return OkResponse()


@router.post("/verify-email", response_model=OkResponse)
async def verify_email(req: VerifyEmailRequest, request: Request, db: DBSession) -> OkResponse:
    await enforce_rate_limit(f"verify-email:{client_ip(request)}", limit=20, window_seconds=3600)
    await svc.verify_email(db, req.token)
    return OkResponse()


@router.post("/resend-verification", response_model=OkResponse)
async def resend_verification(user: CurrentUser, db: DBSession) -> OkResponse:
    await enforce_rate_limit(f"resend-verify:{user.id}", limit=settings.rate_limit_resend_verify_per_hour, window_seconds=3600)
    await svc.resend_verification(db, user)
    return OkResponse()


@router.post("/forgot-password", response_model=OkResponse)
async def forgot_password(req: ForgotPasswordRequest, request: Request, db: DBSession) -> OkResponse:
    await enforce_rate_limit(f"forgot:{client_ip(request)}", limit=10, window_seconds=3600)
    await svc.start_password_reset(db, req.email)
    return OkResponse()  # always ok — no enumeration


@router.post("/reset-password", response_model=OkResponse)
async def reset_password(req: ResetPasswordRequest, request: Request, db: DBSession) -> OkResponse:
    await enforce_rate_limit(f"reset-pw:{client_ip(request)}", limit=20, window_seconds=3600)
    try:
        await svc.reset_password(db, token=req.token, new_password=req.new_password)
    except ValueError as exc:
        raise APIError(ErrorCode.VALIDATION_ERROR, str(exc), status_code=422) from exc
    return OkResponse()


@router.post("/2fa/setup", response_model=TwoFactorSetupResponse)
async def two_factor_setup(user: CurrentUser, db: DBSession) -> TwoFactorSetupResponse:
    secret, uri = await svc.setup_2fa(db, user)
    return TwoFactorSetupResponse(secret=secret, otpauth_uri=uri)


@router.post("/2fa/verify")
async def two_factor_verify(
    req: TwoFactorVerifyRequest, request: Request, response: Response,
    db: DBSession, user: OptionalUser = None,
):
    # Throttle TOTP/recovery-code guessing: per IP, and per challenge/user so a
    # single account/session can't be brute-forced from many IPs either.
    ip = client_ip(request)
    limit, window = settings.rate_limit_2fa_per_5min, 300
    await enforce_rate_limit(f"2fa:ip:{ip}", limit=limit, window_seconds=window)
    subject = req.challenge or (user.id if user else "anon")
    await enforce_rate_limit(f"2fa:sub:{hash_token(subject)}", limit=limit, window_seconds=window)

    # Login-challenge path (no auth header, challenge present) -> returns tokens.
    if req.challenge:
        verified = await svc.verify_login_2fa(db, challenge=req.challenge, code=req.code)
        ua = request.headers.get("user-agent")
        access, raw_refresh, _ = await svc.create_session(db, verified, ip=client_ip(request), user_agent=ua)
        await svc.post_login_side_effects(db, verified, ip=client_ip(request))
        _set_refresh_cookie(response, raw_refresh)
        return TokenResponse(access_token=access, expires_in=settings.jwt_access_ttl_seconds)

    # Setup-confirmation path (requires auth) -> returns recovery codes.
    if user is None:
        raise unauthorized()
    codes = await svc.confirm_2fa(db, user, req.code)
    return TwoFactorEnabledResponse(recovery_codes=codes)


@router.post("/2fa/disable", response_model=OkResponse)
async def two_factor_disable(
    req: TwoFactorDisableRequest, user: CurrentUser, db: DBSession
) -> OkResponse:
    # Password re-check, throttled per-user to blunt online password guessing.
    await enforce_rate_limit(f"2fa-disable:{user.id}", limit=settings.rate_limit_2fa_per_5min,
                             window_seconds=300)
    await svc.disable_2fa(db, user, req.password)
    return OkResponse()


@router.post("/device-flow/start", response_model=DeviceFlowStartResponse)
async def device_flow_start(req: DeviceFlowStartRequest, request: Request, db: DBSession) -> DeviceFlowStartResponse:
    await enforce_rate_limit(f"devflow:{client_ip(request)}", limit=30, window_seconds=3600)
    user_code, device_code, interval, expires_in = await svc.device_flow_start(
        db, anonymous_device_id=req.anonymous_device_id, os=req.os,
        os_version=req.os_version, agent_version=req.agent_version,
    )
    return DeviceFlowStartResponse(
        user_code=user_code, device_code=device_code,
        verification_uri=f"{settings.public_web_url}/activate",
        interval=interval, expires_in=expires_in,
    )


@router.post("/device-flow/approve", response_model=OkResponse)
async def device_flow_approve(req: DeviceFlowApproveRequest, user: CurrentUser, db: DBSession) -> OkResponse:
    await svc.device_flow_approve(db, user=user, user_code=req.user_code)
    return OkResponse()


@router.post("/device-flow/token", response_model=DeviceFlowTokenResponse)
async def device_flow_token(req: DeviceFlowTokenRequest, db: DBSession) -> DeviceFlowTokenResponse:
    status_str, token, device_id = await svc.device_flow_poll(db, device_code=req.device_code)
    return DeviceFlowTokenResponse(status=status_str, device_token=token, device_id=device_id)


@router.get("/me", response_model=MeResponse)
async def me(user: CurrentUser) -> MeResponse:
    return MeResponse.model_validate(user)


@router.patch("/me", response_model=MeResponse)
async def update_me(req: UpdateMeRequest, user: CurrentUser, db: DBSession) -> MeResponse:
    # Public-facing display name (shown as the publisher in the store). Bound to
    # the request session, so the get_session dependency commits on success.
    if req.display_name is not None:
        user.display_name = req.display_name.strip()
    if req.email_notif_optout is not None:
        # Store only known NotificationKind values (drop anything unrecognized).
        valid = {k.value for k in NotificationKind}
        user.email_notif_optout = [k for k in req.email_notif_optout if k in valid]
    await db.flush()
    return MeResponse.model_validate(user)


@router.post("/become-developer", response_model=MeResponse)
async def become_developer(user: CurrentUser, db: DBSession) -> MeResponse:
    """Upgrade a personal account to a developer account (idempotent). Only a
    plain end_user is promoted; team/admin roles already have developer access,
    so they are left unchanged."""
    if user.role == UserRole.end_user:
        user.role = UserRole.developer
        existing = await db.scalar(
            select(DeveloperProfile).where(DeveloperProfile.user_id == user.id)
        )
        if existing is None:
            # Savepoint so a concurrent become-developer (double-click) that already
            # inserted the profile becomes an idempotent no-op, not a unique-violation 500.
            try:
                async with db.begin_nested():
                    db.add(DeveloperProfile(user_id=user.id, org_name="", accepted_terms_at=utcnow()))
            except IntegrityError:
                pass
        await db.flush()
    return MeResponse.model_validate(user)
