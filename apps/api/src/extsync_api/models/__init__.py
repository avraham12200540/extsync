"""Import all ORM models so that Base.metadata is fully populated.

Order matters only for readability; SQLAlchemy resolves FKs by table name.
"""
from __future__ import annotations

from .agent_version import AgentUpdateChannel, AgentVersion
from .api_token import ApiToken
from .audit import AuditEvent, SecurityEvent
from .auth import (
    DeviceFlow,
    EmailVerification,
    PasswordReset,
    RecoveryCode,
    TwoFactorSecret,
    UserSession,
)
from .device import (
    Device,
    DeviceSession,
    Installation,
    InstallationEvent,
    RolloutAssignment,
    UpdateAttempt,
)
from .extension_feedback import ExtensionFeedback
from .install_link import InstallLink
from .likes_quota import LikesQuotaDaily, LikesQuotaEvent, LikesQuotaState
from .notification import Notification
from .project import Project, ProjectKey
from .rating import ProjectRating
from .release import (
    ChannelAssignment,
    ChannelState,
    Release,
    ReleaseArtifact,
    ReleasePermissionSnapshot,
)
from .team import Team, TeamMember
from .user import DeveloperProfile, User
from .user_extension import UserExtension
from .webhook import Webhook, WebhookDelivery

__all__ = [
    "AgentUpdateChannel",
    "AgentVersion",
    "ApiToken",
    "AuditEvent",
    "ChannelAssignment",
    "ChannelState",
    "Device",
    "DeviceFlow",
    "DeviceSession",
    "DeveloperProfile",
    "ExtensionFeedback",
    "EmailVerification",
    "Installation",
    "InstallationEvent",
    "InstallLink",
    "LikesQuotaDaily",
    "LikesQuotaEvent",
    "LikesQuotaState",
    "Notification",
    "PasswordReset",
    "Project",
    "ProjectKey",
    "RecoveryCode",
    "Release",
    "ReleaseArtifact",
    "ReleasePermissionSnapshot",
    "RolloutAssignment",
    "SecurityEvent",
    "Team",
    "TeamMember",
    "TwoFactorSecret",
    "UpdateAttempt",
    "User",
    "UserExtension",
    "UserSession",
    "Webhook",
    "WebhookDelivery",
]
