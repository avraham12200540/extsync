"""Agent API schemas (§23 Agent section)."""
from __future__ import annotations

from pydantic import Field

from ..models.enums import Channel, InstallationStatus, UpdateAttemptStatus
from .common import CamelModel


class AgentRegisterRequest(CamelModel):
    anonymous_device_id: str = Field(min_length=8, max_length=64)
    os: str = "windows"
    os_version: str | None = None
    agent_version: str = "1.0.0"
    agent_public_key: str | None = None


class AgentRegisterResponse(CamelModel):
    device_id: str
    device_token: str
    server_time: str


class HeartbeatRequest(CamelModel):
    agent_version: str = "1.0.0"


class HeartbeatResponse(CamelModel):
    server_time: str
    minimum_agent_version: str
    update_required: bool = False


class RegisterExtensionRequest(CamelModel):
    token: str  # install link token
    extension_id: str | None = None
    has_bridge: bool = False


class RegisterExtensionResponse(CamelModel):
    installation_id: str
    project_id: str
    channel: Channel
    status: InstallationStatus
    metadata: dict | None = None  # signed release metadata to download+verify


class InstalledItem(CamelModel):
    project_id: str
    channel: Channel
    current_sequence: int | None = None
    current_version: str | None = None


class CheckUpdatesRequest(CamelModel):
    items: list[InstalledItem] = []


class UpdateItem(CamelModel):
    project_id: str
    available: bool
    reason: str | None = None
    metadata: dict | None = None


class CheckUpdatesResponse(CamelModel):
    updates: list[UpdateItem]
    server_time: str


class ReportUpdateRequest(CamelModel):
    project_id: str
    release_id: str
    idempotency_key: str = Field(min_length=4, max_length=80)
    from_version: str | None = None
    to_version: str
    status: UpdateAttemptStatus
    error_code: str | None = None
    error_detail: str | None = None
    reload_completed: bool = False
    new_status: InstallationStatus | None = None


class UnregisterExtensionRequest(CamelModel):
    project_id: str
    delete_files: bool = False
