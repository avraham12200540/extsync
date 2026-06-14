"""Install link schemas (§16)."""
from __future__ import annotations

import datetime as dt

from pydantic import Field

from ..models.enums import Channel, InstallLinkType
from .common import CamelModel


class InstallLinkCreate(CamelModel):
    label: str = Field(default="", max_length=160)
    link_type: InstallLinkType = InstallLinkType.public
    channel: Channel = Channel.stable
    max_uses: int | None = Field(default=None, ge=1)
    expires_at: dt.datetime | None = None
    requires_account: bool = False
    allowed_email_domain: str | None = Field(default=None, max_length=255)
    org_team_id: str | None = None


class InstallLinkUpdate(CamelModel):
    label: str | None = None
    max_uses: int | None = Field(default=None, ge=1)
    expires_at: dt.datetime | None = None
    disabled: bool | None = None


class InstallLinkResponse(CamelModel):
    id: str
    project_id: str
    token: str
    url: str
    label: str
    link_type: InstallLinkType
    channel: Channel
    max_uses: int | None
    used_count: int
    expires_at: str | None = None
    requires_account: bool
    allowed_email_domain: str | None
    disabled: bool


class InstallPagePermissions(CamelModel):
    permissions: list[str] = []
    host_permissions: list[str] = []
    optional_permissions: list[str] = []
    uses_native_messaging: bool = False


class InstallPageResolve(CamelModel):
    """Public data shown on the install page (§16)."""

    token: str
    project_id: str
    extension_id: str | None
    name: str
    icon_url: str | None
    short_description: str
    full_description: str | None
    developer_name: str
    website: str | None
    repo_url: str | None
    privacy_policy_url: str | None
    visibility: str
    channel: Channel
    version: str | None
    published_at: str | None
    permissions: InstallPagePermissions
    requires_account: bool
    has_bridge: bool
    install_uri: str  # extsync://install?token=...
    # Direct download of the validated extension ZIP for manual install (load
    # unpacked in Chrome) - for users who don't want the Agent. Omitted for
    # account-gated links. Manual installs do NOT auto-update.
    download_url: str | None = None
    usable: bool
    reason: str | None = None
