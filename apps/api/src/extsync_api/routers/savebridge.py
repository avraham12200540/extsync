"""SaveBridge client credentials: administration, and authentication for the relay.

Two audiences, deliberately in one module so the rules that govern a credential
are visible next to the place they are issued:

  /admin/savebridge/...        platform administrators only. Issue, list, revoke.
  /internal/savebridge/authenticate
                               the SaveBridge relay only, over the private docker
                               network, presenting a shared internal key.

The internal endpoint answers exactly one question - "who is this credential and
what policy does it carry" - and deliberately does NOT decide anything about the
video. The NetFree check is the relay's job, so the decision to allow a download
is made in one place, by the service that owns it.
"""
from __future__ import annotations

import datetime as dt
import hmac

from fastapi import APIRouter, Header, Request
from pydantic import Field
from sqlalchemy import select

from ..config import settings
from ..deps import AdminUser, DBSession
from ..errors import APIError, ErrorCode, not_found
from ..models.savebridge_credential import (
    POLICIES,
    POLICY_NETFREE_REQUIRED,
    POLICY_UNRESTRICTED_PRIVATE,
    STATUS_ACTIVE,
    TYPE_PRIVATE,
    TYPE_PUBLIC,
    TYPES,
    SaveBridgeCredential,
)
from ..schemas.common import CamelModel
from ..services import savebridge_credentials as creds
from ..services.audit import record_audit
from ..services.ratelimit import client_ip

router = APIRouter(tags=["savebridge"])


def _iso(v) -> str | None:
    return v.isoformat().replace("+00:00", "Z") if v else None


def _public(cred: SaveBridgeCredential) -> dict:
    """Everything about a credential EXCEPT anything that could authenticate.

    `tokenId` is the non-secret lookup half and is safe to show; there is no
    field here from which a token could be reconstructed.
    """
    return {
        "id": cred.id,
        "label": cred.label,
        "tokenId": cred.token_id,
        "policy": cred.policy,
        "credentialType": cred.credential_type,
        "status": cred.status,
        "createdAt": _iso(cred.created_at),
        "createdByEmail": cred.created_by_email_snapshot,
        "expiresAt": _iso(cred.expires_at),
        "revokedAt": _iso(cred.revoked_at),
        "revokedByEmail": cred.revoked_by_email_snapshot,
        "revokedReason": cred.revoked_reason,
        "lastUsedAt": _iso(cred.last_used_at),
        "useCount": cred.use_count,
        "notes": cred.notes,
    }


# --------------------------------------------------------------------- admin
class CreateCredential(CamelModel):
    label: str = Field(min_length=1, max_length=120)
    policy: str = Field(default=POLICY_NETFREE_REQUIRED)
    credential_type: str = Field(default=TYPE_PRIVATE)
    expires_at: dt.datetime | None = None
    notes: str | None = Field(default=None, max_length=2000)
    # Issuing unrestricted access is the one action here with real consequences,
    # so it cannot be reached by accident or by a client that simply omits a
    # field: the caller must say so explicitly.
    confirm_unrestricted: bool = False


class RevokeCredential(CamelModel):
    reason: str | None = Field(default=None, max_length=500)


@router.get("/admin/savebridge/credentials")
async def list_credentials(_: AdminUser, db: DBSession) -> list[dict]:
    rows = (await db.scalars(
        select(SaveBridgeCredential).order_by(SaveBridgeCredential.created_at.desc())
    )).all()
    return [_public(c) for c in rows]


@router.post("/admin/savebridge/credentials", status_code=201)
async def create_credential(req: CreateCredential, admin: AdminUser, db: DBSession,
                            request: Request) -> dict:
    """Issue a credential and return its token ONCE.

    The token in this response is the only copy that will ever exist outside the
    build it goes into. It is not stored and cannot be shown again.
    """
    if req.policy not in POLICIES:
        raise APIError(ErrorCode.VALIDATION_ERROR, "מדיניות לא מוכרת", status_code=422)
    if req.credential_type not in TYPES:
        raise APIError(ErrorCode.VALIDATION_ERROR, "סוג הרשאה לא מוכר", status_code=422)

    if req.policy == POLICY_UNRESTRICTED_PRIVATE and not req.confirm_unrestricted:
        raise APIError(
            ErrorCode.VALIDATION_ERROR,
            "הרשאה בלתי מוגבלת עוקפת את בדיקת הזמינות בנטפרי. יש לאשר במפורש.",
            status_code=422,
        )
    # An unrestricted credential embedded in the PUBLIC build would hand
    # everyone the bypass. The combination is refused outright rather than
    # merely discouraged in the UI.
    if (req.policy == POLICY_UNRESTRICTED_PRIVATE
            and req.credential_type == TYPE_PUBLIC):
        raise APIError(
            ErrorCode.VALIDATION_ERROR,
            "לא ניתן להנפיק הרשאה בלתי מוגבלת כהפצה ציבורית.",
            status_code=422,
        )

    cred, token = await creds.issue_credential(
        db, admin=admin, label=req.label, policy=req.policy,
        credential_type=req.credential_type, expires_at=req.expires_at,
        notes=req.notes,
    )
    await record_audit(
        db, action="savebridge.credential_create", actor=admin,
        target_type="savebridge_credential", target_id=cred.id,
        ip_address=client_ip(request),
        # The token is NOT in here, and must never be.
        extra={"label": cred.label, "policy": cred.policy,
               "credentialType": cred.credential_type},
    )
    await db.commit()
    return {**_public(cred), "token": token,
            "tokenShownOnce": True}


@router.post("/admin/savebridge/credentials/{credential_id}/revoke")
async def revoke(credential_id: str, req: RevokeCredential, admin: AdminUser,
                 db: DBSession, request: Request) -> dict:
    cred = await db.get(SaveBridgeCredential, credential_id)
    if cred is None:
        raise not_found("ההרשאה לא נמצאה")
    await creds.revoke_credential(db, cred, admin=admin, reason=req.reason)
    await record_audit(
        db, action="savebridge.credential_revoke", actor=admin,
        target_type="savebridge_credential", target_id=cred.id,
        ip_address=client_ip(request),
        extra={"label": cred.label, "policy": cred.policy,
               "reason": req.reason},
    )
    await db.commit()
    return _public(cred)


# ------------------------------------------------------------------ internal
class AuthenticateRequest(CamelModel):
    token: str = Field(min_length=1, max_length=256)


@router.post("/internal/savebridge/authenticate")
async def authenticate_for_relay(
    req: AuthenticateRequest, db: DBSession,
    x_savebridge_internal_key: str = Header(default=""),
) -> dict:
    """Tell the relay who a client credential is, and what policy it carries.

    NOT reachable from a browser: it is served on the private docker network and
    requires the shared internal key. It is also the one place that answers
    "what policy" - the relay never decides that, and the client is never asked.

    Note what this does NOT return: any judgement about a video. The relay
    performs the NetFree check itself, so there is exactly one component that
    decides whether a gated download proceeds.
    """
    expected = settings.savebridge_internal_key
    if not expected or not hmac.compare_digest(x_savebridge_internal_key, expected):
        raise APIError(ErrorCode.FORBIDDEN, "forbidden", status_code=403)

    cred, reason = await creds.authenticate(db, req.token)
    if cred is None:
        # 401 for "not a credential", 403 for "your credential was withdrawn" -
        # the second is only ever reached by a caller that proved it holds the
        # secret, so it discloses nothing to anyone else.
        return {"ok": False, "reason": reason}

    await creds.note_use(db, cred)
    await db.commit()
    return {
        "ok": True,
        "credentialId": cred.id,
        "policy": cred.policy,
        "credentialType": cred.credential_type,
        "label": cred.label,
    }
