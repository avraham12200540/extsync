"""Auth request/response schemas (§20, §23)."""
from __future__ import annotations

from pydantic import EmailStr, Field, field_validator

from ..models.enums import UserRole
from .common import CamelModel


class RegisterRequest(CamelModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)
    display_name: str = Field(min_length=1, max_length=120)
    org_name: str = Field(default="", max_length=160)
    accept_terms: bool

    @field_validator("accept_terms")
    @classmethod
    def _must_accept(cls, v: bool) -> bool:
        if not v:
            raise ValueError("יש לאשר את תנאי השימוש")
        return v


class LoginRequest(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class TokenResponse(CamelModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class LoginResponse(CamelModel):
    two_factor_required: bool = False
    challenge: str | None = None
    access_token: str | None = None
    token_type: str = "bearer"
    expires_in: int | None = None


class VerifyEmailRequest(CamelModel):
    token: str


class ForgotPasswordRequest(CamelModel):
    email: EmailStr


class ResetPasswordRequest(CamelModel):
    token: str
    new_password: str = Field(min_length=10, max_length=256)


class TwoFactorSetupResponse(CamelModel):
    secret: str
    otpauth_uri: str


class TwoFactorVerifyRequest(CamelModel):
    # During setup: just `code` (with auth). During login: `challenge` + `code`.
    code: str = Field(min_length=4, max_length=16)
    challenge: str | None = None


class TwoFactorEnabledResponse(CamelModel):
    recovery_codes: list[str]


class TwoFactorDisableRequest(CamelModel):
    password: str = Field(min_length=1, max_length=256)


class DeviceFlowStartRequest(CamelModel):
    anonymous_device_id: str = Field(min_length=8, max_length=64)
    os: str | None = None
    os_version: str | None = None
    agent_version: str | None = None


class DeviceFlowStartResponse(CamelModel):
    user_code: str
    device_code: str
    verification_uri: str
    interval: int
    expires_in: int


class DeviceFlowApproveRequest(CamelModel):
    user_code: str
    device_label: str | None = None


class DeviceFlowTokenRequest(CamelModel):
    device_code: str


class DeviceFlowTokenResponse(CamelModel):
    status: str  # pending | approved | expired | denied
    device_token: str | None = None
    device_id: str | None = None


class UpdateMeRequest(CamelModel):
    # Both optional so the client can PATCH just the name OR just the email prefs.
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    email_notif_optout: list[str] | None = None


class MeResponse(CamelModel):
    id: str
    email: EmailStr
    display_name: str
    role: UserRole
    email_verified: bool
    two_factor_enabled: bool
    email_notif_optout: list[str] = []
