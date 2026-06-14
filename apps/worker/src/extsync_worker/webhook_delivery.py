"""Webhook delivery with HMAC signing, retry, and replay protection (§32)."""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import hmac
import json

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from extsync_api.logging import get_logger
from extsync_api.models.webhook import Webhook, WebhookDelivery
from extsync_api.security.crypto import decrypt_str
from extsync_api.security.ssrf import UnsafeUrlError, assert_safe_public_url

logger = get_logger("extsync.worker.webhook")

MAX_ATTEMPTS = 6
BACKOFF_SECONDS = [60, 300, 900, 3600, 10800]  # 1m,5m,15m,1h,3h


def sign_payload(secret: str, timestamp: str, body: bytes) -> str:
    mac = hmac.new(secret.encode("utf-8"), f"{timestamp}.".encode() + body, hashlib.sha256)
    return f"sha256={mac.hexdigest()}"


async def deliver_webhook(db: AsyncSession, delivery_id: str) -> str:
    delivery = await db.get(WebhookDelivery, delivery_id)
    if delivery is None or delivery.status == "success":
        return "skip"
    webhook = await db.get(Webhook, delivery.webhook_id)
    if webhook is None or not webhook.is_active:
        delivery.status = "failed"
        return "failed"

    # SSRF guard at delivery time: re-resolve and reject internal targets, in
    # case DNS for this host was repointed inward after the webhook was created.
    try:
        await asyncio.to_thread(assert_safe_public_url, webhook.url)
    except UnsafeUrlError as exc:
        logger.warning("webhook %s blocked unsafe url: %s", webhook.id, exc)
        delivery.status = "failed"
        delivery.response_body = f"blocked: {exc}"
        delivery.next_retry_at = None
        return "failed"

    # Count this as an attempt up front so that ANY failure below (HTTP error,
    # un-decryptable secret after a key rotation, JSON/serialisation error) is a
    # bounded attempt and the delivery still reaches a terminal state. Otherwise
    # a non-HTTP exception would escape, get rolled back, and be re-swept forever.
    delivery.attempts += 1
    try:
        body = json.dumps(delivery.payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ts = str(int(dt.datetime.now(dt.timezone.utc).timestamp()))
        secret = decrypt_str(webhook.secret_encrypted)
        headers = {
            "Content-Type": "application/json",
            "X-ExtSync-Event": delivery.event_type,
            "X-ExtSync-Event-Id": delivery.event_id,           # replay protection key
            "X-ExtSync-Timestamp": ts,                          # replay window check
            "X-ExtSync-Signature": sign_payload(secret, ts, body),
            "User-Agent": "ExtSync-Webhook/1.0",
        }
        # follow_redirects=False: a 30x to an internal URL would bypass the SSRF
        # guard above, so never follow redirects on webhook delivery.
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            resp = await client.post(webhook.url, content=body, headers=headers)
        delivery.response_code = resp.status_code
        delivery.response_body = resp.text[:2000]
        if 200 <= resp.status_code < 300:
            delivery.status = "success"
            delivery.delivered_at = dt.datetime.now(dt.timezone.utc)
            delivery.next_retry_at = None
            return "success"
        raise httpx.HTTPStatusError("non-2xx", request=resp.request, response=resp)
    except Exception as exc:  # noqa: BLE001 - any failure is a bounded, recorded attempt
        logger.warning("webhook delivery %s attempt %s failed: %s", delivery_id, delivery.attempts, exc)
        if delivery.attempts >= MAX_ATTEMPTS:
            delivery.status = "failed"
            delivery.next_retry_at = None
        else:
            idx = min(delivery.attempts - 1, len(BACKOFF_SECONDS) - 1)
            delivery.next_retry_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(
                seconds=BACKOFF_SECONDS[idx]
            )
        return delivery.status
