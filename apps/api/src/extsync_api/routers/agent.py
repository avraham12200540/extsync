"""Agent endpoints + WebSocket events (§23 Agent section, §6)."""
from __future__ import annotations

import asyncio
import contextlib
import datetime as dt

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..config import settings
from ..deps import CurrentDevice, DBSession
from ..db import get_sessionmaker
from ..logging import get_logger
from ..models.device import Device, DeviceSession, Installation
from ..models.enums import InstallationStatus
from ..redis_client import get_redis
from ..schemas.agent import (
    AgentRegisterRequest,
    AgentRegisterResponse,
    CheckUpdatesRequest,
    CheckUpdatesResponse,
    HeartbeatRequest,
    HeartbeatResponse,
    RegisterExtensionRequest,
    RegisterExtensionResponse,
    ReportUpdateRequest,
    UnregisterExtensionRequest,
)
from ..schemas.common import OkResponse
from ..security.crypto import hash_token
from ..services import agent_service as svc
from ..services.push import project_channel_topic
from ..services.ratelimit import client_ip, enforce_rate_limit

logger = get_logger("extsync.agent")
router = APIRouter(prefix="/agent", tags=["agent"])

MIN_AGENT_VERSION = "1.0.0"


def _iso(value: dt.datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


@router.post("/register", response_model=AgentRegisterResponse)
async def register(req: AgentRegisterRequest, request: Request, db: DBSession) -> AgentRegisterResponse:
    # Anonymous, write-heavy endpoint: cap per-IP so a scripted loop can't bloat
    # the devices/sessions tables on the shared droplet.
    await enforce_rate_limit(f"agent-register:{client_ip(request)}",
                             limit=settings.rate_limit_agent_register_per_hour, window_seconds=3600)
    device, token = await svc.register_device(
        db, anonymous_device_id=req.anonymous_device_id, os=req.os,
        os_version=req.os_version, agent_version=req.agent_version,
        agent_public_key=req.agent_public_key,
    )
    return AgentRegisterResponse(device_id=device.id, device_token=token, server_time=_now_iso())


@router.post("/heartbeat", response_model=HeartbeatResponse)
async def heartbeat(req: HeartbeatRequest, device: CurrentDevice, db: DBSession) -> HeartbeatResponse:
    await svc.heartbeat(db, device, req.agent_version)
    update_required = not svc.version_gte(req.agent_version, MIN_AGENT_VERSION)
    return HeartbeatResponse(server_time=_now_iso(), minimum_agent_version=MIN_AGENT_VERSION,
                             update_required=update_required)


@router.post("/register-extension", response_model=RegisterExtensionResponse)
async def register_extension(req: RegisterExtensionRequest, device: CurrentDevice,
                             db: DBSession) -> RegisterExtensionResponse:
    installation, metadata = await svc.register_extension(
        db, device, token=req.token, extension_id=req.extension_id, has_bridge=req.has_bridge
    )
    return RegisterExtensionResponse(
        installation_id=installation.id, project_id=installation.project_id,
        channel=installation.channel, status=installation.status, metadata=metadata,
    )


@router.post("/unregister-extension", response_model=OkResponse)
async def unregister_extension(req: UnregisterExtensionRequest, device: CurrentDevice,
                               db: DBSession) -> OkResponse:
    await svc.unregister_extension(db, device, project_id=req.project_id)
    return OkResponse()


@router.post("/check-updates", response_model=CheckUpdatesResponse)
async def check_updates(req: CheckUpdatesRequest, device: CurrentDevice, db: DBSession) -> CheckUpdatesResponse:
    updates = await svc.check_updates(db, device, req.items)
    return CheckUpdatesResponse(updates=updates, server_time=_now_iso())


@router.post("/report-update", response_model=OkResponse)
async def report_update(req: ReportUpdateRequest, device: CurrentDevice, db: DBSession) -> OkResponse:
    await svc.report_update(
        db, device, project_id=req.project_id, release_id=req.release_id,
        idempotency_key=req.idempotency_key, from_version=req.from_version,
        to_version=req.to_version, status=req.status, error_code=req.error_code,
        error_detail=req.error_detail, reload_completed=req.reload_completed,
        new_status=req.new_status,
    )
    return OkResponse()


@router.get("/release-metadata/{release_id}")
async def release_metadata(release_id: str, device: CurrentDevice, db: DBSession) -> dict:
    return await svc.get_release_metadata(db, release_id)


@router.get("/self-update")
async def self_update(db: DBSession, channel: str = "stable", current_version: str = "0.0.0") -> dict:
    """Agent self-update check (§28). Separate from extension updates; returns the
    latest signed Agent build for the channel if newer than the caller's version."""
    from sqlalchemy import select

    from ..models.agent_version import AgentUpdateChannel, AgentVersion

    ch = await db.scalar(select(AgentUpdateChannel).where(AgentUpdateChannel.channel == channel))
    if ch is None or ch.active_version_id is None:
        return {"updateAvailable": False}
    av = await db.get(AgentVersion, ch.active_version_id)
    if av is None or not svc.version_gte(av.version, current_version) or av.version == current_version:
        return {"updateAvailable": False}
    return {
        "updateAvailable": True,
        "version": av.version,
        "downloadUrl": av.download_url,
        "sha256": av.sha256,
        "signature": av.signature,
        "keyId": av.key_id,
        "minimumSupportedVersion": av.minimum_supported_version,
        "required": av.required,
        "releaseNotes": av.release_notes,
    }


# --------------------------------------------------------------------------- WebSocket
async def _resolve_device_ws(token: str) -> tuple[str, list[str]] | None:
    sm = get_sessionmaker()
    async with sm() as db:
        session = await db.scalar(
            select(DeviceSession).where(DeviceSession.token_hash == hash_token(token))
        )
        now = dt.datetime.now(dt.timezone.utc)
        if session is None or session.revoked_at is not None or session.expires_at <= now:
            return None
        device = await db.get(Device, session.device_id)
        if device is None:
            return None
        project_ids = list((await db.scalars(
            select(Installation.project_id).where(
                Installation.device_id == device.id,
                Installation.status != InstallationStatus.removed,
            )
        )).all())
        return device.id, project_ids


@router.websocket("/events")
async def agent_events(ws: WebSocket) -> None:
    token = ws.query_params.get("token")
    await ws.accept()
    if not token:
        await ws.close(code=4401)
        return
    resolved = await _resolve_device_ws(token)
    if resolved is None:
        await ws.close(code=4401)
        return
    device_id, project_ids = resolved
    await ws.send_json({"type": "connected", "deviceId": device_id})

    pubsub = None
    try:
        redis = get_redis()
        pubsub = redis.pubsub()
        topics = [project_channel_topic(pid) for pid in project_ids] or ["extsync:noop"]
        await pubsub.subscribe(*topics)
    except Exception:  # noqa: BLE001 - degrade to polling if Redis is unavailable
        await ws.send_json({"type": "degraded", "message": "push unavailable; polling only"})
        await _keepalive_only(ws)
        return

    async def _pump() -> None:
        async for message in pubsub.listen():
            if message is None or message.get("type") != "message":
                continue
            with contextlib.suppress(Exception):
                import json
                await ws.send_json({"type": "push", "data": json.loads(message["data"])})

    pump_task = asyncio.create_task(_pump())
    try:
        while True:
            # Client pings keep the socket alive; ignore content.
            await ws.receive_text()
            await ws.send_json({"type": "pong", "ts": _now_iso()})
    except WebSocketDisconnect:
        pass
    finally:
        pump_task.cancel()
        with contextlib.suppress(Exception):
            await pubsub.unsubscribe()
            await pubsub.aclose()


async def _keepalive_only(ws: WebSocket) -> None:
    try:
        while True:
            await ws.receive_text()
            await ws.send_json({"type": "pong", "ts": _now_iso()})
    except WebSocketDisconnect:
        pass
