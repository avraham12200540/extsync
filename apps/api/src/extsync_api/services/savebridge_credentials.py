"""Issuing and verifying SaveBridge client credentials.

Token format:

    sbc_v1_<token_id>.<secret>

    token_id  22 url-safe chars, NOT secret. Used to find the row, safe to log,
              safe to show in the admin UI.
    secret    32 bytes (256 bits) from the OS CSPRNG, base64url, no padding.

Only `HMAC-SHA256(pepper, full_token)` is stored. The pepper lives in the
application config, not the database, so a stolen database alone yields nothing
that can authenticate - see verify_credential for what that does and does not
protect against.

The secret is returned exactly once, by `issue_credential`, and is unrecoverable
afterwards. Nothing here logs a token, puts one in an exception message, or
returns one from any other function.
"""
from __future__ import annotations

import datetime as dt
import hmac
import re
import secrets
from hashlib import sha256

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..logging import get_logger
from ..models.savebridge_credential import (
    POLICIES,
    POLICY_NETFREE_REQUIRED,
    STATUS_ACTIVE,
    STATUS_REVOKED,
    TYPE_PRIVATE,
    TYPES,
    SaveBridgeCredential,
)
from ..models.user import User

logger = get_logger("extsync.savebridge.credentials")

PREFIX = "sbc_v1_"
_TOKEN_RE = re.compile(r"^sbc_v1_([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$")

# 32 bytes -> 43 base64url chars without padding.
_SECRET_BYTES = 32
_TOKEN_ID_BYTES = 16          # -> 22 base64url chars


def _b64(raw: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _mac(token: str) -> str:
    """MAC of the WHOLE token, so a row cannot be reused under a different id."""
    pepper = settings.savebridge_credential_pepper.encode("utf-8")
    return hmac.new(pepper, token.encode("utf-8"), sha256).hexdigest()


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def generate_token() -> tuple[str, str, str]:
    """Returns (full_token, token_id, token_hash). The caller must not log it."""
    token_id = _b64(secrets.token_bytes(_TOKEN_ID_BYTES))
    secret = _b64(secrets.token_bytes(_SECRET_BYTES))
    token = f"{PREFIX}{token_id}.{secret}"
    return token, token_id, _mac(token)


async def issue_credential(
    db: AsyncSession, *, admin: User, label: str, policy: str,
    credential_type: str = TYPE_PRIVATE, expires_at: dt.datetime | None = None,
    notes: str | None = None,
) -> tuple[SaveBridgeCredential, str]:
    """Create a credential and return it WITH its one and only plaintext token.

    The token is returned to the caller and never stored, so this is the single
    moment it exists outside the recipient's build.
    """
    if policy not in POLICIES:
        raise ValueError(f"unknown policy: {policy}")
    if credential_type not in TYPES:
        raise ValueError(f"unknown credential type: {credential_type}")

    token, token_id, token_hash = generate_token()
    cred = SaveBridgeCredential(
        label=label.strip(),
        token_id=token_id,
        token_hash=token_hash,
        policy=policy,
        credential_type=credential_type,
        status=STATUS_ACTIVE,
        expires_at=expires_at,
        created_by_user_id=admin.id,
        created_by_email_snapshot=admin.email,
        created_by_name_snapshot=admin.display_name or None,
        notes=(notes or "").strip() or None,
    )
    db.add(cred)
    await db.flush()
    # The label and policy are logged; the token is not, and must never be.
    logger.info("savebridge: issued credential %s (%s, %s) by %s",
                cred.id, cred.policy, cred.credential_type, admin.email)
    return cred, token


async def revoke_credential(db: AsyncSession, cred: SaveBridgeCredential, *,
                            admin: User, reason: str | None = None) -> None:
    """Take a credential out of service immediately and permanently."""
    if cred.status == STATUS_REVOKED:
        return
    cred.status = STATUS_REVOKED
    cred.revoked_at = _now()
    cred.revoked_by_user_id = admin.id
    cred.revoked_by_email_snapshot = admin.email
    cred.revoked_by_name_snapshot = admin.display_name or None
    cred.revoked_reason = (reason or "").strip() or None
    logger.info("savebridge: revoked credential %s by %s", cred.id, admin.email)


async def authenticate(db: AsyncSession,
                       token: str | None) -> tuple[SaveBridgeCredential | None, str]:
    """Authenticate a token. Returns (credential, reason).

    reason is one of: ok | invalid | revoked | expired.

    The revoked/expired distinction is made ONLY after the MAC has verified,
    i.e. only for a caller that demonstrably holds that credential's secret.
    Someone who does not hold it gets a flat "invalid" for every failure -
    malformed, unknown id, wrong secret alike - so this cannot be used to
    discover which token ids exist. Someone who does hold it already knows the
    credential exists, so telling them it was revoked leaks nothing and is the
    difference between a useful message and a baffling one.

    What the MAC protects: a database copy on its own contains no token and no
    reversible material, so it cannot be used to authenticate. What it does not
    protect: an attacker holding BOTH the table and the application pepper can
    verify guesses offline - but the secret is 256 random bits, so guessing is
    not a practical attack. The honest summary is that the pepper is a second
    factor against a database-only compromise, not a defence against full
    server compromise.
    """
    if not token:
        return None, "invalid"
    m = _TOKEN_RE.match(token.strip())
    if not m:
        return None, "invalid"
    token_id = m.group(1)

    cred = await db.scalar(select(SaveBridgeCredential).where(
        SaveBridgeCredential.token_id == token_id))
    if cred is None:
        # Still burn a comparison so a present/absent id is not timeable.
        hmac.compare_digest(_mac(token), "0" * 64)
        return None, "invalid"

    if not hmac.compare_digest(_mac(token), cred.token_hash):
        return None, "invalid"

    # Authenticated from here on: the caller holds this credential's secret.
    if cred.status == STATUS_REVOKED or cred.revoked_at is not None:
        return None, "revoked"
    if not cred.is_usable:
        return None, "expired"
    return cred, "ok"


async def verify_credential(db: AsyncSession, token: str | None) -> SaveBridgeCredential | None:
    """Usable credential or nothing, for callers that need no reason code."""
    cred, _ = await authenticate(db, token)
    return cred


async def note_use(db: AsyncSession, cred: SaveBridgeCredential) -> None:
    """Record that a credential was used. Visibility only."""
    cred.last_used_at = _now()
    cred.use_count = (cred.use_count or 0) + 1
