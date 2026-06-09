"""Signing core: load the Ed25519 private key and sign canonical metadata."""
from __future__ import annotations

import base64
from functools import lru_cache
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from extsync_release_schema import canonical_bytes

from extsync_api.config import settings


@lru_cache
def _private_key() -> Ed25519PrivateKey:
    path = settings.signing_private_key_path
    if not path or not Path(path).exists():
        raise RuntimeError(
            "Signing private key not found. Set SIGNING_PRIVATE_KEY_PATH and run "
            "`make gen-dev-signing-key`."
        )
    key = serialization.load_pem_private_key(Path(path).read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise RuntimeError("Configured signing key is not Ed25519")
    return key


def active_key_id() -> str:
    return settings.signing_active_key_id


def sign_metadata(unsigned: dict) -> tuple[str, str]:
    """Sign the canonical form of `unsigned` (which must include keyId).

    Returns (key_id, signature_b64). Raises if the metadata's keyId does not
    match the active signing key.
    """
    key_id = unsigned.get("keyId")
    if key_id != active_key_id():
        raise ValueError(f"keyId {key_id!r} does not match active signing key")
    signature = _private_key().sign(canonical_bytes(unsigned))
    return key_id, base64.b64encode(signature).decode("ascii")
