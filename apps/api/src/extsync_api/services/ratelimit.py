"""Lightweight fixed-window rate limiting backed by Redis.

Fails OPEN if Redis is unreachable (logs a warning) so a Redis outage cannot lock
everyone out — acceptable because auth still requires valid credentials. In
production Redis is part of readiness, so this is a defense-in-depth layer.
"""
from __future__ import annotations

from ..errors import APIError, ErrorCode
from ..logging import get_logger
from ..redis_client import get_redis

logger = get_logger("extsync.ratelimit")


async def enforce_rate_limit(key: str, *, limit: int, window_seconds: int) -> None:
    try:
        client = get_redis()
        redis_key = f"rl:{key}"
        current = await client.incr(redis_key)
        if current == 1:
            await client.expire(redis_key, window_seconds)
        if current > limit:
            ttl = await client.ttl(redis_key)
            raise APIError(
                ErrorCode.RATE_LIMITED,
                "יותר מדי בקשות. נסו שוב מאוחר יותר.",
                status_code=429,
                details={"retry_after": max(ttl, 1)},
            )
    except APIError:
        raise
    except Exception:  # noqa: BLE001 - fail open on infra error
        logger.warning("rate limit check skipped (redis unavailable) key=%s", key)


def client_ip(request) -> str:  # type: ignore[no-untyped-def]
    # Behind Caddy (the only upstream): Caddy APPENDS the real connecting peer as
    # the LAST X-Forwarded-For hop. Trust that, NOT the client-supplied leftmost
    # value - otherwise a request can spoof its own IP and bypass per-IP limits.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        hops = [h.strip() for h in fwd.split(",") if h.strip()]
        if hops:
            return hops[-1]
    return request.client.host if request.client else "unknown"
