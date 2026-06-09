"""Prefixed, URL-safe, collision-resistant identifiers (Stripe-style).

e.g. ext_3kQ9..., rel_8aZ..., usr_..., tok_..., lnk_..., dev_...
"""
from __future__ import annotations

import secrets

_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
_DEFAULT_LEN = 24


def _random_base62(length: int) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def new_id(prefix: str, length: int = _DEFAULT_LEN) -> str:
    return f"{prefix}_{_random_base62(length)}"


# Convenience generators (kept explicit so prefixes are discoverable/grep-able).
def user_id() -> str:
    return new_id("usr")


def team_id() -> str:
    return new_id("team")


def project_id() -> str:
    return new_id("ext")


def release_id() -> str:
    return new_id("rel")


def artifact_id() -> str:
    return new_id("art")


def install_link_id() -> str:
    return new_id("lnk")


def device_id() -> str:
    return new_id("dev")


def installation_id() -> str:
    return new_id("ins")


def api_token_id() -> str:
    return new_id("tok")


def webhook_id() -> str:
    return new_id("wh")


def event_id() -> str:
    return new_id("evt")


def session_id() -> str:
    return new_id("ses")


def notification_id() -> str:
    return new_id("ntf")


def generic_id() -> str:
    return new_id("id")


def secret_token(length: int = 40) -> str:
    """Opaque high-entropy token for install links, refresh tokens, etc."""
    return secrets.token_urlsafe(length)
