"""Release request/response schemas (§12, §21)."""
from __future__ import annotations

from pydantic import Field

from ..models.enums import Channel, ReleaseStatus, ReviewStatus
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


class ReleaseReviewInfo(CamelModel):
    """What the DEVELOPER is allowed to know about moderation of their release.

    Deliberately a closed shape rather than a passthrough of the review columns.
    `Release.review_note` is the administrator's private note and MUST NEVER
    appear here or anywhere else developer-facing; the only free text that
    reaches the developer is `review_reason`, which an administrator typed
    knowing it would be shown to them. `reviewed_by_user_id` is withheld too -
    who reviewed something is not the submitter's business.

    Build this only via schemas.release.review_info(); do not construct it from
    a model dump.
    """

    status: ReviewStatus
    # Administrator's explanation, written FOR the developer. None unless one
    # was deliberately entered.
    reason: str | None = None
    reviewed_at: str | None = None


def review_info(release, iso) -> ReleaseReviewInfo:
    """Map a Release to its developer-visible review state.

    The single place that decides what crosses the line. Note it reads
    `review_reason` and never `review_note`.
    """
    return ReleaseReviewInfo(
        status=release.review_status,
        reason=release.review_reason,
        reviewed_at=iso(release.reviewed_at),
    )


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
    review: ReleaseReviewInfo | None = None


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
    validation_error: str | None = None  # first error message when validation_failed
    warnings_count: int = 0
    review: ReleaseReviewInfo | None = None
