"""Worker entrypoint: consume validation + webhook jobs, write a heartbeat.

Run with:  python -m extsync_worker.main
Uses BRPOP so it blocks without busy-looping. Each job runs in its own DB
session/transaction. Errors are logged and the job is retried with backoff via a
delayed re-enqueue (never silently dropped).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import signal

from sqlalchemy import or_, select

from extsync_api.config import settings
from extsync_api.db import get_sessionmaker
from extsync_api.logging import configure_logging, get_logger
from extsync_api.models.webhook import WebhookDelivery
from extsync_api.redis_client import get_redis
from extsync_api.services.jobs import VALIDATION_QUEUE, WEBHOOK_QUEUE

from .pipeline import process_validation_job
from .webhook_delivery import deliver_webhook

logger = get_logger("extsync.worker")

HEARTBEAT_KEY = "extsync:worker:heartbeat"
HEARTBEAT_TTL = 60

# Webhook outbox: emit_event only writes pending WebhookDelivery rows. This
# sweeper turns them into queue jobs and re-queues retries whose next_retry_at is
# due. A short lease on next_retry_at stops the next sweep from re-enqueuing a
# delivery that is already in flight (deliver_webhook overrides it on its result).
WEBHOOK_SWEEP_INTERVAL = 10
WEBHOOK_LEASE_SECONDS = 120
WEBHOOK_SWEEP_BATCH = 200

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


async def _webhook_sweeper_loop() -> None:
    """Outbox: enqueue pending webhook deliveries and re-queue due retries."""
    sm = get_sessionmaker()
    client = get_redis()
    while not _shutdown.is_set():
        try:
            now = dt.datetime.now(dt.timezone.utc)
            async with sm() as session:
                rows = (await session.scalars(
                    select(WebhookDelivery)
                    .where(
                        WebhookDelivery.status == "pending",
                        or_(
                            WebhookDelivery.next_retry_at.is_(None),
                            WebhookDelivery.next_retry_at <= now,
                        ),
                    )
                    .order_by(WebhookDelivery.created_at)
                    .limit(WEBHOOK_SWEEP_BATCH)
                )).all()
                ids = [r.id for r in rows]
                lease_until = now + dt.timedelta(seconds=WEBHOOK_LEASE_SECONDS)
                for r in rows:
                    r.next_retry_at = lease_until  # lease; deliver_webhook overrides on its result
                await session.commit()
            for delivery_id in ids:
                await client.lpush(WEBHOOK_QUEUE, json.dumps({"deliveryId": delivery_id}))
            if ids:
                logger.info("webhook sweeper enqueued %s deliveries", len(ids))
        except Exception:  # noqa: BLE001 - never let the sweeper die
            logger.exception("webhook sweeper iteration failed")
        try:
            await asyncio.wait_for(_shutdown.wait(), timeout=WEBHOOK_SWEEP_INTERVAL)
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
    sweeper = asyncio.create_task(_webhook_sweeper_loop())
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
        sweeper.cancel()
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
