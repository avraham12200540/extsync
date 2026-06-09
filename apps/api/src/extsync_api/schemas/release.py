"""Release request/response schemas (§12, §21)."""
from __future__ import annotations

from pydantic import Field

from ..models.enums import Channel, ReleaseStatus
from .common import CamelModel

ALLOWED_ROLLOUT = {1, 5, 10, 25, 50, 75, 100}


class ReleaseCreateMeta(CamelModel):
    """Metadata supplied alongside the uploaded ZIP (multipart fields)."""

    version: str = Field(pattern=r"^\d{1,9}(\.\d{1,9}){0,3}$")
    channel: Channel = Channel.stable
    release_notes: str | None = Field(default=None, max_length=8000)
    minimum_agent_version: str = Field(default="1.0.0", pattern=r"^\d+\.\d+\.\d+$")


class PublishRequest(CamelModel):
    rollout_percentage: int = 100

    def validated_rollout(self) -> int:
        return self.rollout_percentage if self.rollout_percentage in ALLOWED_ROLLOUT else 100


class PauseRequest(CamelModel):
    reason: str | None = Field(default=None, max_length=500)


class RevokeRequest(CamelModel):
    reason: str = Field(min_length=1, max_length=500)


class RollbackRequest(CamelModel):
    # Optional explicit target; defaults to the previous published release.
    target_release_id: str | None = None


class ArtifactInfo(CamelModel):
    size: int
    sha256: str
    url: str | None = None


class PermissionDiffInfo(CamelModel):
    added_permissions: list[str] = []
    removed_permissions: list[str] = []
    added_hosts: list[str] = []
    removed_hosts: list[str] = []
    risk_level: str = "low"


class ReleaseResponse(CamelModel):
    id: str
    project_id: str
    version: str
    channel: Channel
    status: ReleaseStatus
    sequence: int | None
    release_notes: str | None
    minimum_agent_version: str
    rollout_percentage: int
    permissions_changed: bool
    requires_user_approval: bool
    risk_score: int
    key_id: str | None
    published_at: str | None = None
    created_at: str | None = None
    validation_report: dict | None = None


class ReleaseListItem(CamelModel):
    id: str
    version: str
    channel: Channel
    status: ReleaseStatus
    sequence: int | None
    rollout_percentage: int
    permissions_changed: bool
    risk_score: int
    created_at: str | None = None
    published_at: str | None = None
