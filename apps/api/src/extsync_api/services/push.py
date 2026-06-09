"""Best-effort push to connected Agents via Redis pub/sub (§6).

Agents keep a WebSocket open and subscribe to their managed projects. On publish
we publish a lightweight "check now" nudge; the Agent then calls /agent/check-updates
(the single, idempotent source of truth). Failures here never break publishing.
"""
from __future__ import annotations

import json

from ..logging import get_logger
from ..redis_client import get_redis

logger = get_logger("extsync.push")


def project_channel_topic(project_id: str) -> str:
    return f"extsync:project:{project_id}"


async def notify_project_update(project_id: str, channel: str, *, event: str = "update_available") -> None:
    try:
        client = get_redis()
        await client.publish(
            project_channel_topic(project_id),
            json.dumps({"type": event, "projectId": project_id, "channel": channel}),
        )
    except Exception:  # noqa: BLE001 - push is best-effort
        logger.warning("push notify failed for project=%s (agents will poll)", project_id)
