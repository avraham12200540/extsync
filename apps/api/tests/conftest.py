"""Pytest fixtures: in-process app backed by a temporary SQLite database.

Email (SMTP) and Redis are unavailable in tests; the code paths fail open / are
swallowed, so auth still works end-to-end against SQLite.
"""
from __future__ import annotations

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine

import extsync_api.models  # noqa: F401  populate metadata
from extsync_api.db import Base, configure_engine, get_sessionmaker
from extsync_api.main import app


@pytest.fixture()
def client(tmp_path) -> Iterator[TestClient]:
    db_path = tmp_path / "test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    configure_engine(engine)

    async def _setup() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_setup())

    with TestClient(app) as c:
        yield c

    async def _teardown() -> None:
        await engine.dispose()

    asyncio.run(_teardown())


@pytest.fixture()
def sessionmaker_factory():
    """Direct DB access for assertions/manipulation inside tests."""
    return get_sessionmaker()
