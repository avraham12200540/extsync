"""Symmetric encryption for secrets at rest + token hashing.

Used for: TOTP secrets, project private keys, webhook HMAC secrets. The key is
derived from a dedicated app secret (JWT_SECRET here for dev simplicity; in
production use a separate ENCRYPTION_KEY or a KMS). Tokens stored for lookup
(refresh/email/reset/api/device) are hashed with SHA-256 — never reversible.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from ..config import settings


@lru_cache
def _fernet() -> Fernet:
    # Prefer a dedicated ENCRYPTION_KEY so a JWT_SECRET rotation/leak does not also
    # compromise encryption-at-rest. Falls back to jwt_secret for backward
    # compatibility (existing ciphertext stays decryptable) when unset.
    base_secret = settings.encryption_key or settings.jwt_secret
    digest = hashlib.sha256(("extsync-enc:" + base_secret).encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_str(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_str(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:  # pragma: no cover - corrupted/forged data
        raise ValueError("failed to decrypt secret") from exc


def hash_token(raw: str) -> str:
    """SHA-256 hex of an opaque token, for constant-shape DB storage + lookup."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
