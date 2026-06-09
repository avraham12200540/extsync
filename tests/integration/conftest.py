"""Integration test harness wiring API + worker + release-schema together.

Backed by a temp SQLite DB. Object storage is an in-memory dict, and the signing
service boundary is replaced by a local Ed25519 signer using a test key — so the
full upload -> validate -> sign -> publish path runs without Docker/MinIO/Redis.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

# Make the three packages importable.
ROOT = Path(__file__).resolve().parents[2]
for rel in ("apps/api/src", "apps/worker/src", "packages/release-schema/python"):
    p = str(ROOT / rel)
    if p not in sys.path:
        sys.path.insert(0, p)

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import extsync_api.models  # noqa: E402,F401
from extsync_api.config import settings  # noqa: E402
from extsync_api.db import Base, configure_engine  # noqa: E402
from extsync_api.main import app  # noqa: E402
from extsync_api.services import jobs as jobs_mod  # noqa: E402
from extsync_api.services import release_service  # noqa: E402
from extsync_api.services import signing_client  # noqa: E402
from extsync_api.storage import storage  # noqa: E402
from extsync_release_schema import public_key_b64, sign_metadata  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

# In-memory object store shared by API and worker.
_STORE: dict[tuple[str, str], bytes] = {}
_TEST_KEY = Ed25519PrivateKey.generate()
_TEST_KEY_ID = "test-key-int"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    _STORE.clear()
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path/'it.db'}")
    configure_engine(engine)

    async def _setup() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_setup())

    # ---- patch object storage with the in-memory store ----
    def _put(bucket, key, data, content_type="application/octet-stream"):
        _STORE[(bucket, key)] = bytes(data)

    def _get(bucket, key):
        return _STORE[(bucket, key)]

    def _del(bucket, key):
        _STORE.pop((bucket, key), None)

    monkeypatch.setattr(storage, "put_bytes", _put)
    monkeypatch.setattr(storage, "get_bytes", _get)
    monkeypatch.setattr(storage, "delete", _del)
    monkeypatch.setattr(storage, "public_url", lambda b, k: f"memory://{b}/{k}")

    # ---- patch the signing-service boundary with a local Ed25519 signer ----
    monkeypatch.setattr(settings, "signing_active_key_id", _TEST_KEY_ID)
    monkeypatch.setattr(settings, "signing_public_keys", f"{_TEST_KEY_ID}:{public_key_b64(_TEST_KEY)}")

    async def _local_sign(unsigned: dict) -> dict:
        return sign_metadata(unsigned, _TEST_KEY)

    monkeypatch.setattr(signing_client, "sign", _local_sign)
    monkeypatch.setattr(release_service.signing_client, "sign", _local_sign)

    # ---- don't actually enqueue; tests drive the worker pipeline directly ----
    async def _noop_enqueue(release_id: str) -> None:
        return None

    monkeypatch.setattr(jobs_mod, "enqueue_validation", _noop_enqueue)
    monkeypatch.setattr(release_service, "enqueue_validation", _noop_enqueue)

    with TestClient(app) as c:
        yield c

    asyncio.run(engine.dispose())


@pytest.fixture()
def store():
    return _STORE


@pytest.fixture()
def test_public_keys() -> dict[str, str]:
    return {_TEST_KEY_ID: public_key_b64(_TEST_KEY)}
