"""Background job queue (Redis list). Shared key constants between API and worker."""
from __future__ import annotations

import json

from ..redis_client import get_redis

VALIDATION_QUEUE = "extsync:jobs:validation"
WEBHOOK_QUEUE = "extsync:jobs:webhook"


async def enqueue_validation(release_id: str) -> None:
    """Push a validation job. The API calls this after storing the upload."""
    client = get_redis()
    await client.lpush(VALIDATION_QUEUE, json.dumps({"releaseId": release_id}))


async def enqueue_webhook(delivery_id: str) -> None:
    client = get_redis()
    await client.lpush(WEBHOOK_QUEUE, json.dumps({"deliveryId": delivery_id}))
