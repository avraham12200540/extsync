"""ExtSync release metadata: canonical JSON + Ed25519 signing (Python).

Produces byte-identical canonical output to the TypeScript and .NET
implementations. See packages/release-schema/README.md.
"""
from __future__ import annotations

import base64
from typing import Any, Mapping

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

RELEASE_SCHEMA_VERSION = 1

__all__ = [
    "RELEASE_SCHEMA_VERSION",
    "canonicalize",
    "canonical_bytes",
    "sign_metadata",
    "verify_metadata",
    "rollout_bucket",
    "load_private_key_pem",
    "public_key_b64",
    "private_seed_b64",
]


def _escape_string(s: str) -> str:
    """JSON minimal string escaping, non-ASCII left as-is (ensure_ascii=False)."""
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\f":
            out.append("\\f")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif o < 0x20:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def canonicalize(value: Any) -> str:
    """Canonical JSON string. Restricted to int/bool/str/list/dict (no float, no None)."""
    if value is None:
        raise ValueError("canonicalize: None is not allowed in signed metadata")
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        raise ValueError(f"canonicalize: float not allowed: {value!r}")
    if isinstance(value, str):
        return _escape_string(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonicalize(v) for v in value) + "]"
    if isinstance(value, Mapping):
        keys = sorted(value.keys())  # code-point order; keys must be ASCII
        return "{" + ",".join(
            _escape_string(str(k)) + ":" + canonicalize(value[k]) for k in keys
        ) + "}"
    raise TypeError(f"canonicalize: unsupported type {type(value)!r}")


def canonical_bytes(meta: Mapping[str, Any]) -> bytes:
    """UTF-8 canonical bytes of the metadata WITHOUT the 'signature' field."""
    rest = {k: v for k, v in meta.items() if k != "signature"}
    return canonicalize(rest).encode("utf-8")


def sign_metadata(meta: Mapping[str, Any], private_key: Ed25519PrivateKey) -> dict:
    """Return a copy of meta with a base64 'signature' added."""
    sig = private_key.sign(canonical_bytes(meta))
    signed = {k: v for k, v in meta.items() if k != "signature"}
    signed["signature"] = base64.b64encode(sig).decode("ascii")
    return signed


def verify_metadata(meta: Mapping[str, Any], public_keys: Mapping[str, str]) -> bool:
    """Verify against {keyId: base64 raw public key}. False if keyId unknown/invalid."""
    key_id = meta.get("keyId")
    sig_b64 = meta.get("signature")
    if not isinstance(key_id, str) or not isinstance(sig_b64, str):
        return False
    pub_b64 = public_keys.get(key_id)
    if not pub_b64:
        return False
    try:
        pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(pub_b64))
        pub.verify(base64.b64decode(sig_b64), canonical_bytes(meta))
        return True
    except (InvalidSignature, ValueError):
        return False


def rollout_bucket(project_id: str, device_id: str) -> int:
    """Deterministic bucket in [0,100). FNV-1a (32-bit) — matches the TS impl."""
    key = f"{project_id}:{device_id}".encode("utf-8")
    h = 0x811C9DC5
    for b in key:
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h % 100


def load_private_key_pem(pem: bytes, password: bytes | None = None) -> Ed25519PrivateKey:
    key = serialization.load_pem_private_key(pem, password=password)
    if not isinstance(key, Ed25519PrivateKey):
        raise TypeError("Expected an Ed25519 private key")
    return key


def public_key_b64(private_key: Ed25519PrivateKey) -> str:
    raw = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return base64.b64encode(raw).decode("ascii")


def private_seed_b64(private_key: Ed25519PrivateKey) -> str:
    """The 32-byte Ed25519 seed (base64) — same value the TS signer expects."""
    raw = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return base64.b64encode(raw).decode("ascii")
