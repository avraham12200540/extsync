"""Project request/response schemas (§8, §21)."""
from __future__ import annotations

import re

from pydantic import Field, field_validator

from ..models.enums import ProjectStatus, ProjectVisibility
from .common import CamelModel

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$")


def slugify(value: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return s[:80] or "extension"


class ProjectCreate(CamelModel):
    name: str = Field(min_length=2, max_length=160)
    slug: str | None = Field(default=None, max_length=80)
    short_description: str = Field(min_length=1, max_length=280)
    full_description: str | None = Field(default=None, max_length=8000)
    website: str | None = Field(default=None, max_length=500)
    repo_url: str | None = Field(default=None, max_length=500)
    support_url: str | None = Field(default=None, max_length=500)
    privacy_policy_url: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, max_length=80)
    visibility: ProjectVisibility = ProjectVisibility.private
    team_id: str | None = None
    bridge_mode: str = Field(default="basic", pattern="^(basic|integrated)$")

    @field_validator("slug")
    @classmethod
    def _check_slug(cls, v: str | None) -> str | None:
        if v is not None and not SLUG_RE.match(v):
            raise ValueError("Slug חייב להכיל אותיות קטנות, ספרות ומקפים בלבד")
        return v


class ProjectUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    short_description: str | None = Field(default=None, max_length=280)
    full_description: str | None = Field(default=None, max_length=8000)
    website: str | None = Field(default=None, max_length=500)
    repo_url: str | None = Field(default=None, max_length=500)
    support_url: str | None = Field(default=None, max_length=500)
    privacy_policy_url: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, max_length=80)
    icon_url: str | None = Field(default=None, max_length=500)
    visibility: ProjectVisibility | None = None
    allow_channel_switch: bool | None = None
    bridge_mode: str | None = Field(default=None, pattern="^(basic|integrated)$")
    # Optimistic-lock guard supplied by the client.
    expected_version: int | None = None


class ScreenshotItem(CamelModel):
    id: str
    url: str
    position: int


class ProjectResponse(CamelModel):
    id: str
    slug: str
    name: str
    short_description: str
    full_description: str | None
    icon_url: str | None
    website: str | None
    repo_url: str | None
    support_url: str | None
    privacy_policy_url: str | None
    category: str | None
    visibility: ProjectVisibility
    status: ProjectStatus
    extension_id: str | None
    team_id: str | None
    allow_channel_switch: bool
    bridge_mode: str
    version: int
    # Caller's resolved permissions on this project (drives UI gating).
    permissions: list[str] = []
    # Promo/preview images shown on the public detail page (ordered).
    screenshots: list[ScreenshotItem] = []
