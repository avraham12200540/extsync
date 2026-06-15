"""ExtSync API application factory."""
from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from .config import settings
from .errors import install_attach_error_handlers
from .logging import configure_logging, correlation_id_var, get_logger, request_id_var
from .redis_client import close_redis
from .routers import health

logger = get_logger("extsync.api")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assigns a request id + propagates a correlation id for structured logs."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        cid = request.headers.get("x-correlation-id") or rid
        request_id_var.set(rid)
        correlation_id_var.set(cid)
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        response.headers["x-correlation-id"] = cid
        return response


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging(settings.log_level)
    # Fail closed: never run production with a publicly-known dev secret default.
    insecure = settings.insecure_production_defaults()
    if insecure:
        raise RuntimeError(
            "Refusing to start in production with insecure default secrets: "
            + ", ".join(insecure)
            + ". Set strong values in the environment."
        )
    logger.info("ExtSync API starting (env=%s)", settings.environment)
    yield
    await close_redis()
    logger.info("ExtSync API shutting down")


def _init_sentry() -> None:
    """Enable Sentry error tracking, but only if a DSN is configured (else no-op)."""
    if not settings.sentry_dsn:
        return
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.environment,
            send_default_pii=False,
            traces_sample_rate=0.0,
        )
        logger.info("Sentry error tracking enabled")
    except Exception:  # noqa: BLE001 - monitoring must never block boot
        logger.warning("Sentry init failed; continuing without it", exc_info=True)


def create_app() -> FastAPI:
    _init_sentry()
    # Expose interactive docs only outside production (or when explicitly enabled).
    docs_enabled = settings.enable_api_docs or settings.environment != "production"
    app = FastAPI(
        title="ExtSync API",
        version="0.1.0",
        description=(
            "API לפלטפורמת ExtSync — הפצה, התקנה, ניהול ועדכון של תוספי Chrome "
            "מחוץ ל-Chrome Web Store."
        ),
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )

    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.public_web_url],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-request-id"],
    )

    install_attach_error_handlers(app)

    # Routers
    app.include_router(health.router)
    # Auth/projects/releases/agent/... routers are registered as they are built.
    _register_optional_routers(app)

    @app.get("/", tags=["meta"])
    async def root() -> dict:
        return {"name": "ExtSync API", "version": app.version, "docs": "/docs"}

    return app


def _register_optional_routers(app: FastAPI) -> None:
    """Include feature routers if present (keeps the app importable mid-build)."""
    module_names = [
        "auth",
        "oauth_google",
        "projects",
        "releases",
        "install_links",
        "agent",
        "teams",
        "api_tokens",
        "webhooks",
        "notifications",
        "admin",
        "analytics",
        "catalog",
        "likes_quota",
    ]
    import importlib

    for name in module_names:
        try:
            mod = importlib.import_module(f".routers.{name}", __package__)
        except ModuleNotFoundError:
            continue
        router = getattr(mod, "router", None)
        if router is not None:
            app.include_router(router)


app = create_app()
