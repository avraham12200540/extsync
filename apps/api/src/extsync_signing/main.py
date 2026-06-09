"""Isolated signing service HTTP app (internal network only)."""
from __future__ import annotations

from fastapi import FastAPI, Header, HTTPException

from extsync_api.config import settings
from extsync_api.logging import configure_logging, get_logger

from .signer import active_key_id, sign_metadata

logger = get_logger("extsync.signing")

app = FastAPI(title="ExtSync Signing Service", version="0.1.0", docs_url=None, openapi_url=None)
configure_logging(settings.log_level)


def _require_internal_token(x_internal_token: str | None) -> None:
    import hmac

    expected = settings.signing_internal_token
    if not x_internal_token or not hmac.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health/live")
async def live() -> dict:
    return {"status": "ok", "keyId": active_key_id()}


@app.post("/internal/sign")
async def sign(payload: dict, x_internal_token: str | None = Header(default=None)) -> dict:
    _require_internal_token(x_internal_token)
    meta = payload.get("metadata")
    if not isinstance(meta, dict):
        raise HTTPException(status_code=422, detail="metadata object required")
    try:
        key_id, signature = sign_metadata(meta)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # Log every signature (project/version/sequence) WITHOUT the artifact itself.
    logger.info(
        "signed release project=%s version=%s sequence=%s keyId=%s",
        meta.get("projectId"), meta.get("version"), meta.get("sequence"), key_id,
    )
    return {"keyId": key_id, "signature": signature}
