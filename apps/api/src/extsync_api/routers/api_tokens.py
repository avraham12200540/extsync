"""Developer API tokens (§23 API Tokens)."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, status
from sqlalchemy import select

from ..deps import CurrentUser, DBSession
from ..errors import not_found
from ..models.api_token import ApiToken
from ..models.enums import NotificationKind
from ..schemas.common import CamelModel, OkResponse
from ..security.tokens import new_api_token
from ..services.audit import record_audit
from ..services.audit import notify

router = APIRouter(prefix="/api-tokens", tags=["api-tokens"])


class TokenCreate(CamelModel):
    name: str
    expires_in_days: int | None = None


class TokenCreated(CamelModel):
    id: str
    name: str
    token: str  # shown once
    token_prefix: str


class TokenInfo(CamelModel):
    id: str
    name: str
    token_prefix: str
    last_used_at: str | None = None
    expires_at: str | None = None
    created_at: str | None = None


def _iso(v) -> str | None:
    return v.isoformat().replace("+00:00", "Z") if v else None


@router.post("", status_code=status.HTTP_201_CREATED, response_model=TokenCreated)
async def create_token(req: TokenCreate, user: CurrentUser, db: DBSession) -> TokenCreated:
    full, prefix, token_hash = new_api_token()
    expires = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=req.expires_in_days)
               if req.expires_in_days else None)
    row = ApiToken(user_id=user.id, name=req.name, token_prefix=prefix,
                   token_hash=token_hash, scopes=["developer"], expires_at=expires)
    db.add(row)
    await db.flush()
    await record_audit(db, action="api_token.create", actor_user_id=user.id,
                       target_type="api_token", target_id=row.id)
    await notify(db, user_id=user.id, kind=NotificationKind.api_token_created,
                 title="נוצר API Token", body=f"נוצר טוקן בשם '{req.name}'.")
    return TokenCreated(id=row.id, name=row.name, token=full, token_prefix=prefix)


@router.get("", response_model=list[TokenInfo])
async def list_tokens(user: CurrentUser, db: DBSession) -> list[TokenInfo]:
    rows = (await db.scalars(
        select(ApiToken).where(ApiToken.user_id == user.id, ApiToken.revoked_at.is_(None))
        .order_by(ApiToken.created_at.desc())
    )).all()
    return [TokenInfo(id=r.id, name=r.name, token_prefix=r.token_prefix,
                      last_used_at=_iso(r.last_used_at), expires_at=_iso(r.expires_at),
                      created_at=_iso(r.created_at)) for r in rows]


@router.delete("/{token_id}", response_model=OkResponse)
async def revoke_token(token_id: str, user: CurrentUser, db: DBSession) -> OkResponse:
    row = await db.get(ApiToken, token_id)
    if row is None or row.user_id != user.id:
        raise not_found("הטוקן לא נמצא")
    row.revoked_at = dt.datetime.now(dt.timezone.utc)
    await record_audit(db, action="api_token.revoke", actor_user_id=user.id,
                       target_type="api_token", target_id=row.id)
    return OkResponse()
