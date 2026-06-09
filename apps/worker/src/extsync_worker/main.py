"""Worker entrypoint: consume validation + webhook jobs, write a heartbeat.

Run with:  python -m extsync_worker.main
Uses BRPOP so it blocks without busy-looping. Each job runs in its own DB
session/transaction. Errors are logged and the job is retried with backoff via a
delayed re-enqueue (never silently dropped).
"""
from __future__ import annotations

import asyncio
import json
import signal

from extsync_api.config import settings
from extsync_api.db import get_sessionmaker
from extsync_api.logging import configure_logging, get_logger
from extsync_api.redis_client import get_redis
from extsync_api.services.jobs import VALIDATION_QUEUE, WEBHOOK_QUEUE

from .pipeline import process_validation_job
from .webhook_delivery import deliver_webhook

logger = get_logger("extsync.worker")

HEARTBEAT_KEY = "extsync:worker:heartbeat"
HEARTBEAT_TTL = 60
_shutdown = asyncio.Event()


async def _heartbeat_loop() -> None:
    client = get_redis()
    while not _shutdown.is_set():
        try:
            await client.set(HEARTBEAT_KEY, "1", ex=HEARTBEAT_TTL)
        except Exception:  # noqa: BLE001
            logger.warning("heartbeat write failed")
        try:
            await asyncio.wait_for(_shutdown.wait(), timeout=20)
        except asyncio.TimeoutError:
            pass


async def _handle_validation(payload: dict) -> None:
    release_id = payload.get("releaseId")
    if not release_id:
        return
    sm = get_sessionmaker()
    async with sm() as session:
        try:
            status = await process_validation_job(session, release_id)
            await session.commit()
            logger.info("validation done release=%s status=%s", release_id, status)
        except Exception:
            await session.rollback()
            logger.exception("validation job failed release=%s; re-enqueueing", release_id)
            await _retry(VALIDATION_QUEUE, payload)


async def _handle_webhook(payload: dict) -> None:
    delivery_id = payload.get("deliveryId")
    if not delivery_id:
        return
    sm = get_sessionmaker()
    async with sm() as session:
        try:
            await deliver_webhook(session, delivery_id)
            await session.commit()
        except Exception:
            await session.rollback()
            logger.exception("webhook delivery failed id=%s", delivery_id)


async def _retry(queue: str, payload: dict, delay: float = 5.0) -> None:
    """Naive backoff: wait then re-enqueue. Production would use a delayed set."""
    await asyncio.sleep(delay)
    client = get_redis()
    attempts = payload.get("_attempts", 0) + 1
    if attempts > 5:
        logger.error("giving up on job after %s attempts: %s", attempts, payload)
        return
    payload["_attempts"] = attempts
    await client.lpush(queue, json.dumps(payload))


async def run() -> None:
    configure_logging(settings.log_level)
    logger.info("ExtSync worker starting")
    client = get_redis()
    hb = asyncio.create_task(_heartbeat_loop())
    try:
        while not _shutdown.is_set():
            try:
                result = await client.brpop([VALIDATION_QUEUE, WEBHOOK_QUEUE], timeout=5)
            except Exception:  # noqa: BLE001 - redis blip; back off briefly
                logger.warning("brpop failed; retrying")
                await asyncio.sleep(2)
                continue
            if result is None:
                continue
            queue_name, raw = result
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                logger.error("dropping malformed job on %s", queue_name)
                continue
            if queue_name == VALIDATION_QUEUE:
                await _handle_validation(payload)
            elif queue_name == WEBHOOK_QUEUE:
                await _handle_webhook(payload)
    finally:
        _shutdown.set()
        hb.cancel()
        logger.info("ExtSync worker stopped")


def _install_signal_handlers(loop: asyncio.AbstractEventLoop) -> None:
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _shutdown.set)
        except NotImplementedError:  # Windows
            pass


def main() -> None:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _install_signal_handlers(loop)
    try:
        loop.run_until_complete(run())
    finally:
        loop.close()


if __name__ == "__main__":
    main()
