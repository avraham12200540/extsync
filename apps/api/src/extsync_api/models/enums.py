"""Domain enums — mirror the lifecycle states defined in the spec (§3, §7)."""
from __future__ import annotations

from enum import StrEnum


class UserRole(StrEnum):
    guest = "guest"
    end_user = "end_user"
    developer = "developer"
    team_member = "team_member"
    team_admin = "team_admin"
    platform_admin = "platform_admin"


class TeamRole(StrEnum):
    viewer = "viewer"
    developer = "developer"
    release_manager = "release_manager"
    admin = "admin"


class ProjectStatus(StrEnum):
    draft = "draft"
    active = "active"
    suspended = "suspended"
    archived = "archived"
    deleted = "deleted"


class ProjectVisibility(StrEnum):
    public = "public"
    private = "private"


class ReleaseStatus(StrEnum):
    uploaded = "uploaded"
    validating = "validating"
    validation_failed = "validation_failed"
    ready = "ready"
    draft = "draft"
    scheduled = "scheduled"
    publishing = "publishing"
    published = "published"
    paused = "paused"
    superseded = "superseded"
    revoked = "revoked"


class Channel(StrEnum):
    stable = "stable"
    beta = "beta"
    nightly = "nightly"


class InstallationStatus(StrEnum):
    downloading = "downloading"
    staged = "staged"
    awaiting_manual_load = "awaiting_manual_load"
    installed = "installed"
    update_available = "update_available"
    updating = "updating"
    reload_required = "reload_required"
    up_to_date = "up_to_date"
    paused = "paused"
    broken = "broken"
    rollback_in_progress = "rollback_in_progress"
    removed = "removed"


class UpdateAttemptStatus(StrEnum):
    pending = "pending"
    downloading = "downloading"
    verifying = "verifying"
    applying = "applying"
    awaiting_reload = "awaiting_reload"
    success = "success"
    failed = "failed"
    rolled_back = "rolled_back"


class InstallLinkType(StrEnum):
    public = "public"
    private_secret = "private_secret"
    one_time = "one_time"
    expiring = "expiring"
    usage_limited = "usage_limited"
    channel_scoped = "channel_scoped"
    requires_account = "requires_account"
    email_domain = "email_domain"
    org_scoped = "org_scoped"


class DeviceOS(StrEnum):
    windows = "windows"
    macos = "macos"
    linux = "linux"
    unknown = "unknown"


class WebhookEventType(StrEnum):
    release_uploaded = "release.uploaded"
    release_validated = "release.validated"
    release_validation_failed = "release.validation_failed"
    release_published = "release.published"
    release_paused = "release.paused"
    release_revoked = "release.revoked"
    installation_created = "installation.created"
    installation_updated = "installation.updated"
    installation_failed = "installation.failed"
    rollout_paused = "rollout.paused"
    rollback_completed = "rollback.completed"


class NotificationKind(StrEnum):
    release_validated = "release.validated"
    release_validation_failed = "release.validation_failed"
    release_published = "release.published"
    high_failure_rate = "high_failure_rate"
    rollout_paused = "rollout.paused"
    rollback_done = "rollback.done"
    install_link_used = "install_link.used"
    new_login = "new_login"
    team_changed = "team.changed"
    api_token_created = "api_token.created"


# ---- Allowed state transitions (server-side release state machine, §7) ----
RELEASE_TRANSITIONS: dict[ReleaseStatus, set[ReleaseStatus]] = {
    ReleaseStatus.uploaded: {ReleaseStatus.validating},
    ReleaseStatus.validating: {ReleaseStatus.validation_failed, ReleaseStatus.ready},
    ReleaseStatus.validation_failed: set(),
    ReleaseStatus.ready: {ReleaseStatus.draft, ReleaseStatus.scheduled, ReleaseStatus.publishing},
    ReleaseStatus.draft: {ReleaseStatus.scheduled, ReleaseStatus.publishing},
    ReleaseStatus.scheduled: {ReleaseStatus.publishing, ReleaseStatus.draft},
    ReleaseStatus.publishing: {ReleaseStatus.published, ReleaseStatus.paused},
    ReleaseStatus.published: {ReleaseStatus.paused, ReleaseStatus.superseded, ReleaseStatus.revoked},
    ReleaseStatus.paused: {ReleaseStatus.publishing, ReleaseStatus.revoked, ReleaseStatus.superseded},
    ReleaseStatus.superseded: {ReleaseStatus.revoked},
    ReleaseStatus.revoked: set(),
}


def can_transition(current: ReleaseStatus, target: ReleaseStatus) -> bool:
    return target in RELEASE_TRANSITIONS.get(current, set())
