"""Async Redis client (cache, rate-limit counters, queue, WS pub/sub)."""
from __future__ import annotations

from typing import Any

from .config import settings

_redis: Any = None


def get_redis() -> Any:
    global _redis
    if _redis is None:
        import redis.asyncio as aioredis  # lazy import

        _redis = aioredis.from_url(
            settings.redis_url, encoding="utf-8", decode_responses=True
        )
    return _redis


async def redis_health_check() -> bool:
    client = get_redis()
    return bool(await client.ping())


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None
