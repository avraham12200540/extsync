"""Structured JSON logging + request/correlation id context."""
from __future__ import annotations

import contextvars
import datetime as dt
import json
import logging
import sys
from typing import Any

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)
correlation_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "correlation_id", default=None
)

# Keys that must never be logged (defense-in-depth against secret leakage).
_REDACT_KEYS = {"password", "token", "secret", "authorization", "cookie", "refresh_token"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": dt.datetime.now(dt.timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        rid = request_id_var.get()
        cid = correlation_id_var.get()
        if rid:
            payload["request_id"] = rid
        if cid:
            payload["correlation_id"] = cid
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        for key, value in getattr(record, "extra_fields", {}).items():
            if key.lower() in _REDACT_KEYS:
                continue
            payload[key] = value
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str = "info") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    # Quiet noisy libraries.
    logging.getLogger("uvicorn.access").handlers[:] = [handler]
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def log_with(logger: logging.Logger, level: int, msg: str, **fields: Any) -> None:
    logger.log(level, msg, extra={"extra_fields": fields})
