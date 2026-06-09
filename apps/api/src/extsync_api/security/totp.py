"""TOTP-based 2FA and recovery codes (§20)."""
from __future__ import annotations

import secrets

import pyotp

ISSUER = "ExtSync"


def new_totp_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, account_email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account_email, issuer_name=ISSUER)


def verify_totp(secret: str, code: str, *, valid_window: int = 1) -> bool:
    code = (code or "").strip().replace(" ", "")
    if not code.isdigit():
        return False
    return pyotp.TOTP(secret).verify(code, valid_window=valid_window)


def generate_recovery_codes(count: int = 10) -> list[str]:
    """Plaintext recovery codes (shown once); store only hashes."""
    codes = []
    for _ in range(count):
        raw = "-".join(secrets.token_hex(2) for _ in range(3))  # e.g. ab12-cd34-ef56
        codes.append(raw)
    return codes
