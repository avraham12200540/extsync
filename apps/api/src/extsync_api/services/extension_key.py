"""Stable Chrome extension id derivation (ADR-0005).

Chrome derives an unpacked extension's id from the `key` field of its manifest:
  1. `key` is the base64 of the DER SubjectPublicKeyInfo (an RSA public key).
  2. id = first 128 bits of SHA-256(DER public key), rendered as 32 chars where
     each hex nibble 0..15 maps to 'a'..'p' (the "mpdecimal" alphabet).

By generating one RSA keypair per project and injecting its public key as
manifest.key for every build, the extension id stays identical across versions
and machines. The PRIVATE key never leaves the server / signing service and is
never placed in a ZIP.
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def compute_extension_id(public_der: bytes) -> str:
    """Return the 32-char Chrome extension id for a DER SubjectPublicKeyInfo."""
    digest = hashlib.sha256(public_der).digest()
    first16 = digest[:16]
    chars = []
    for byte in first16:
        hi = byte >> 4
        lo = byte & 0x0F
        chars.append(chr(ord("a") + hi))
        chars.append(chr(ord("a") + lo))
    return "".join(chars)


def public_der_from_b64(key_b64: str) -> bytes:
    return base64.b64decode(key_b64)


def extension_id_from_key_b64(key_b64: str) -> str:
    return compute_extension_id(public_der_from_b64(key_b64))


def generate_project_keypair() -> tuple[str, str, str]:
    """Generate an RSA-2048 keypair for a project.

    Returns (private_pem, public_key_b64, extension_id). The caller encrypts the
    private PEM at rest (ProjectKey.private_key_encrypted) and stores the public
    key b64 (-> manifest.key) and the derived extension id.
    """
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    public_der = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    public_b64 = base64.b64encode(public_der).decode("ascii")
    return private_pem, public_b64, compute_extension_id(public_der)


def public_b64_from_private_pem(private_pem: str) -> str:
    key = serialization.load_pem_private_key(private_pem.encode("ascii"), password=None)
    public_der = key.public_key().public_bytes(  # type: ignore[union-attr]
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return base64.b64encode(public_der).decode("ascii")
