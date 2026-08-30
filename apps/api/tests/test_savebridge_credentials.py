"""SaveBridge client credentials: issuance, storage, authentication, revocation.

The invariant these defend is narrow and absolute:

    The client chooses the video. The SERVER chooses the policy.

So the tests are mostly about what a credential CANNOT do - a public credential
cannot become unrestricted, a revoked one cannot be used, and the database does
not contain anything that can authenticate.
"""
from __future__ import annotations

import asyncio
import datetime as dt

import pytest
from sqlalchemy import select

from extsync_api.models.enums import UserRole
from extsync_api.models.savebridge_credential import (
    POLICY_NETFREE_REQUIRED,
    POLICY_UNRESTRICTED_PRIVATE,
    STATUS_REVOKED,
    TYPE_PRIVATE,
    TYPE_PUBLIC,
    SaveBridgeCredential,
)
from extsync_api.models.user import User
from extsync_api.services import savebridge_credentials as creds

ADMIN_ID, ADMIN_EMAIL = "usr_sbadmin", "sbadmin@extsync.test"


def _admin() -> User:
    return User(id=ADMIN_ID, email=ADMIN_EMAIL, display_name="SB Admin",
                role=UserRole.platform_admin, password_hash="x", email_verified=True)


@pytest.fixture()
def db(client, sessionmaker_factory):
    async def _seed():
        async with sessionmaker_factory() as s:
            s.add(_admin())
            await s.commit()

    asyncio.run(_seed())
    return sessionmaker_factory


def run(sm, fn):
    async def _go():
        async with sm() as s:
            import inspect
            out = fn(s)
            if inspect.isawaitable(out):
                out = await out
            await s.commit()
            return out

    return asyncio.run(_go())


async def _issue(s, *, policy=POLICY_NETFREE_REQUIRED, ctype=TYPE_PRIVATE,
                 label="test", expires_at=None):
    admin = await s.get(User, ADMIN_ID)
    return await creds.issue_credential(
        s, admin=admin, label=label, policy=policy,
        credential_type=ctype, expires_at=expires_at)


# ------------------------------------------------------------- token format

def test_token_shape_and_entropy():
    token, token_id, token_hash = creds.generate_token()
    assert token.startswith("sbc_v1_")
    assert token == f"sbc_v1_{token_id}.{token.split('.', 1)[1]}"
    secret = token.split(".", 1)[1]
    # 32 bytes -> 43 base64url chars. Anything shorter would be a silent
    # downgrade of the only thing standing between a guess and access.
    assert len(secret) == 43
    assert len(token_hash) == 64
    # Two tokens must never collide.
    assert creds.generate_token()[0] != token


def test_the_stored_hash_is_not_the_token():
    token, _, token_hash = creds.generate_token()
    assert token not in token_hash
    assert token_hash != token


# ------------------------------------------------------------- DB leak model

def test_the_database_row_contains_nothing_that_can_authenticate(db):
    """§38. A dump of this table must not yield a usable credential."""
    _, token = run(db, lambda s: _issue(s))

    row = run(db, lambda s: s.scalar(select(SaveBridgeCredential)))
    stored = " ".join(str(v) for v in (
        row.id, row.label, row.token_id, row.token_hash, row.policy,
        row.credential_type, row.status, row.notes))

    assert token not in stored, "the plaintext token is recoverable from the row"
    secret = token.split(".", 1)[1]
    assert secret not in stored, "the token SECRET is present in the row"
    # The lookup half is stored, and that is fine - it is not secret.
    assert row.token_id in token


def test_a_row_copied_verbatim_cannot_be_replayed_as_a_token(db):
    """Reconstructing `sbc_v1_<token_id>.<token_hash>` must not authenticate."""
    run(db, lambda s: _issue(s))
    row = run(db, lambda s: s.scalar(select(SaveBridgeCredential)))
    forged = f"sbc_v1_{row.token_id}.{row.token_hash}"

    cred, reason = run(db, lambda s: creds.authenticate(s, forged))
    assert cred is None
    assert reason == "invalid"


# ------------------------------------------------------------ authentication

def test_a_valid_token_authenticates_and_carries_its_policy(db):
    _, token = run(db, lambda s: _issue(s, policy=POLICY_UNRESTRICTED_PRIVATE))
    cred, reason = run(db, lambda s: creds.authenticate(s, token))
    assert reason == "ok"
    assert cred.policy == POLICY_UNRESTRICTED_PRIVATE


@pytest.mark.parametrize("bad", [
    "", "   ", "not-a-token", "sbc_v1_", "sbc_v1_short.secret",
    "sbc_v2_aaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "Bearer sbc_v1_x.y", "sbc_v1_aaaaaaaaaaaaaaaaaaaaaa.short",
])
def test_malformed_tokens_are_rejected_uniformly(db, bad):
    """§37. Every shape of nonsense gets the same flat answer."""
    cred, reason = run(db, lambda s: creds.authenticate(s, bad))
    assert cred is None
    assert reason == "invalid"


def test_a_valid_id_with_the_wrong_secret_is_rejected(db):
    """The id half is not secret, so possessing it must prove nothing."""
    _, token = run(db, lambda s: _issue(s))
    token_id = token[len("sbc_v1_"):].split(".", 1)[0]
    forged = f"sbc_v1_{token_id}.{'A' * 43}"

    cred, reason = run(db, lambda s: creds.authenticate(s, forged))
    assert cred is None
    assert reason == "invalid", "a wrong secret must not be distinguishable"


def test_secrets_are_not_interchangeable_between_credentials(db):
    """§37: public id + private secret, and the reverse, are both nonsense."""
    _, a = run(db, lambda s: _issue(s, label="a", ctype=TYPE_PUBLIC))
    _, b = run(db, lambda s: _issue(s, label="b", policy=POLICY_UNRESTRICTED_PRIVATE))

    a_id = a[len("sbc_v1_"):].split(".", 1)[0]
    b_secret = b.split(".", 1)[1]
    swapped = f"sbc_v1_{a_id}.{b_secret}"

    cred, reason = run(db, lambda s: creds.authenticate(s, swapped))
    assert cred is None and reason == "invalid"


def test_a_truncated_token_is_rejected(db):
    _, token = run(db, lambda s: _issue(s))
    cred, reason = run(db, lambda s: creds.authenticate(s, token[:-5]))
    assert cred is None and reason == "invalid"


# --------------------------------------------------------------- revocation

def test_revocation_is_immediate_and_reported_as_revoked(db):
    """§36. The holder proved they have the secret, so they are told plainly."""
    cred_obj, token = run(db, lambda s: _issue(s, policy=POLICY_UNRESTRICTED_PRIVATE))
    cred, reason = run(db, lambda s: creds.authenticate(s, token))
    assert reason == "ok"

    async def _revoke(s):
        row = await s.get(SaveBridgeCredential, cred_obj.id)
        await creds.revoke_credential(s, row, admin=await s.get(User, ADMIN_ID),
                                      reason="leaked")

    run(db, _revoke)

    cred, reason = run(db, lambda s: creds.authenticate(s, token))
    assert cred is None
    assert reason == "revoked"


def test_revoking_one_credential_does_not_affect_another(db):
    """The whole point of per-recipient credentials."""
    a_obj, a = run(db, lambda s: _issue(s, label="person A",
                                        policy=POLICY_UNRESTRICTED_PRIVATE))
    _, b = run(db, lambda s: _issue(s, label="person B",
                                    policy=POLICY_UNRESTRICTED_PRIVATE))

    async def _revoke(s):
        row = await s.get(SaveBridgeCredential, a_obj.id)
        await creds.revoke_credential(s, row, admin=await s.get(User, ADMIN_ID))

    run(db, _revoke)

    assert run(db, lambda s: creds.authenticate(s, a))[1] == "revoked"
    assert run(db, lambda s: creds.authenticate(s, b))[1] == "ok"


def test_revocation_records_a_durable_actor(db):
    obj, _ = run(db, lambda s: _issue(s))

    async def _revoke(s):
        row = await s.get(SaveBridgeCredential, obj.id)
        await creds.revoke_credential(s, row, admin=await s.get(User, ADMIN_ID))

    run(db, _revoke)
    row = run(db, lambda s: s.get(SaveBridgeCredential, obj.id))
    assert row.status == STATUS_REVOKED
    assert row.revoked_by_email_snapshot == ADMIN_EMAIL


def test_an_expired_credential_stops_working(db):
    past = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)
    _, token = run(db, lambda s: _issue(s, expires_at=past))
    cred, reason = run(db, lambda s: creds.authenticate(s, token))
    assert cred is None
    assert reason == "expired"


def test_a_future_expiry_still_works(db):
    future = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)
    _, token = run(db, lambda s: _issue(s, expires_at=future))
    assert run(db, lambda s: creds.authenticate(s, token))[1] == "ok"


# --------------------------------------------------------------- issuance

def test_issuance_records_a_durable_issuer(db):
    obj, _ = run(db, lambda s: _issue(s))
    row = run(db, lambda s: s.get(SaveBridgeCredential, obj.id))
    assert row.created_by_user_id == ADMIN_ID
    assert row.created_by_email_snapshot == ADMIN_EMAIL


def test_an_unknown_policy_is_refused(db):
    with pytest.raises(ValueError):
        run(db, lambda s: _issue(s, policy="unrestricted"))


def test_use_is_counted(db):
    obj, token = run(db, lambda s: _issue(s))

    async def _use(s):
        cred, _ = await creds.authenticate(s, token)
        await creds.note_use(s, cred)

    run(db, _use)
    run(db, _use)
    row = run(db, lambda s: s.get(SaveBridgeCredential, obj.id))
    assert row.use_count == 2
    assert row.last_used_at is not None
