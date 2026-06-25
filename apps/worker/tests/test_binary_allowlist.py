"""Tests for the per-uploader binary/executable exemption policy.

Covers the two pieces the validator test cannot reach:
  * config.binary_upload_allowlist_set() CSV parsing/normalization;
  * pipeline._uploader_allows_binaries() fail-closed authorization.

The resolver is the security-bearing logic, so its fail-closed branches are
pinned here. Run in the worker suite with PYTHONPATH=../api/src:src (see CI).
"""
from __future__ import annotations

import asyncio
import types

from extsync_api.config import Settings
from extsync_worker.pipeline import _uploader_allows_binaries, settings


def test_allowlist_parser_normalizes_and_fails_closed():
    s = Settings(binary_upload_allowlist=" A@x.com , b@x.com ,")
    assert s.binary_upload_allowlist_set() == {"a@x.com", "b@x.com"}
    assert Settings(binary_upload_allowlist="").binary_upload_allowlist_set() == set()
    assert Settings(binary_upload_allowlist="   ").binary_upload_allowlist_set() == set()


def _user(**kw):
    base = dict(email="dev@x.com", email_verified=True, is_active=True, is_suspended=False)
    base.update(kw)
    return types.SimpleNamespace(**base)


class _FakeDB:
    """Minimal stand-in: db.get(User, id) just returns the configured user (or None)."""

    def __init__(self, user):
        self._user = user

    async def get(self, _model, _pk):
        return self._user


def _allows(allowlist: str, user) -> bool:
    release = types.SimpleNamespace(uploaded_by_user_id="u1")
    original = settings.binary_upload_allowlist
    try:
        settings.binary_upload_allowlist = allowlist
        return asyncio.run(_uploader_allows_binaries(_FakeDB(user), release))
    finally:
        settings.binary_upload_allowlist = original


def test_empty_allowlist_denies_everyone():
    assert _allows("", _user()) is False


def test_listed_verified_user_allowed_case_insensitive():
    assert _allows("Dev@X.com", _user(email="dev@x.com")) is True


def test_unlisted_user_denied():
    assert _allows("other@x.com", _user(email="dev@x.com")) is False


def test_unknown_user_denied():
    assert _allows("dev@x.com", None) is False


def test_unverified_email_denied():
    assert _allows("dev@x.com", _user(email_verified=False)) is False


def test_suspended_or_inactive_denied():
    assert _allows("dev@x.com", _user(is_suspended=True)) is False
    assert _allows("dev@x.com", _user(is_active=False)) is False
