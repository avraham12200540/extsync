"""HTTP client to the isolated signing service (§26).

The API never holds the private key; it sends well-formed metadata to the signing
service and gets back a signature. This module is the single network boundary,
which tests monkeypatch with a local signer.
"""
from __future__ import annotations

import httpx

from ..config import settings
from ..errors import APIError, ErrorCode


async def sign(unsigned_meta: dict) -> dict:
    """Return a copy of `unsigned_meta` with `signature` set by the signing service."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{settings.signing_service_url}/internal/sign",
                json={"metadata": unsigned_meta},
                headers={"X-Internal-Token": settings.signing_internal_token},
            )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:
        raise APIError(
            ErrorCode.INTERNAL, "שירות החתימה אינו זמין כרגע", status_code=503
        ) from exc
    signed = dict(unsigned_meta)
    signed["signature"] = data["signature"]
    signed["keyId"] = data["keyId"]
    return signed
