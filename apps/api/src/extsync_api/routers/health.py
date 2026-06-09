"""Health / readiness / liveness endpoints (§33)."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..redis_client import get_redis, redis_health_check
from ..storage import storage

router = APIRouter(prefix="/health", tags=["health"])

WORKER_HEARTBEAT_KEY = "extsync:worker:heartbeat"


@router.get("/live")
async def live() -> dict:
    return {"status": "ok"}


async def _check_db(session: AsyncSession) -> tuple[bool, str | None]:
    try:
        await session.execute(text("SELECT 1"))
        return True, None
    except Exception as exc:  # noqa: BLE001 - report, don't crash
        return False, str(exc)


@router.get("/database")
async def database(session: Annotated[AsyncSession, Depends(get_session)], response: Response) -> dict:
    ok, err = await _check_db(session)
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"component": "database", "ok": ok, "error": err}


@router.get("/redis")
async def redis(response: Response) -> dict:
    try:
        ok = await redis_health_check()
        err = None
    except Exception as exc:  # noqa: BLE001
        ok, err = False, str(exc)
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"component": "redis", "ok": ok, "error": err}


@router.get("/storage")
async def storage_health(response: Response) -> dict:
    try:
        storage.health_check()
        ok, err = True, None
    except Exception as exc:  # noqa: BLE001
        ok, err = False, str(exc)
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"component": "storage", "ok": ok, "error": err}


@router.get("/worker")
async def worker(response: Response) -> dict:
    """The worker writes a heartbeat key periodically; absence => not running."""
    try:
        client = get_redis()
        beat = await client.get(WORKER_HEARTBEAT_KEY)
        ok = beat is not None
        err = None if ok else "no recent worker heartbeat"
    except Exception as exc:  # noqa: BLE001
        ok, err = False, str(exc)
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"component": "worker", "ok": ok, "error": err, "last_beat": None}


@router.get("/ready")
async def ready(session: Annotated[AsyncSession, Depends(get_session)], response: Response) -> dict:
    db_ok, db_err = await _check_db(session)
    try:
        redis_ok = await redis_health_check()
        redis_err = None
    except Exception as exc:  # noqa: BLE001
        redis_ok, redis_err = False, str(exc)
    try:
        storage.health_check()
        storage_ok, storage_err = True, None
    except Exception as exc:  # noqa: BLE001
        storage_ok, storage_err = False, str(exc)

    all_ok = db_ok and redis_ok and storage_ok
    if not all_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ready" if all_ok else "not_ready",
        "checks": {
            "database": {"ok": db_ok, "error": db_err},
            "redis": {"ok": redis_ok, "error": redis_err},
            "storage": {"ok": storage_ok, "error": storage_err},
        },
    }
