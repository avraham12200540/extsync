"""Team management endpoints (§23 Teams)."""
from __future__ import annotations

from fastapi import APIRouter, status
from pydantic import EmailStr
from sqlalchemy import select

from ..deps import CurrentUser, DBSession
from ..errors import APIError, ErrorCode, forbidden, not_found
from ..ids import team_id as new_team_id
from ..models.enums import TeamRole
from ..models.team import Team, TeamMember
from ..models.user import User
from ..schemas.common import CamelModel, OkResponse
from ..schemas.project import slugify
from ..services.audit import record_audit

router = APIRouter(prefix="/teams", tags=["teams"])


class TeamCreate(CamelModel):
    name: str


class MemberAdd(CamelModel):
    email: EmailStr
    role: TeamRole = TeamRole.viewer


class MemberUpdate(CamelModel):
    role: TeamRole


class MemberResponse(CamelModel):
    id: str
    user_id: str
    email: str
    display_name: str
    role: TeamRole


class TeamResponse(CamelModel):
    id: str
    name: str
    slug: str
    owner_user_id: str
    members: list[MemberResponse] = []


async def _require_member(db: DBSession, team_id: str, user: User) -> TeamMember:
    member = await db.scalar(
        select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user.id)
    )
    if member is None and user.role != "platform_admin":
        raise not_found("הצוות לא נמצא")
    return member


async def _require_admin(db: DBSession, team_id: str, user: User) -> None:
    member = await _require_member(db, team_id, user)
    if (member is None or member.role != TeamRole.admin) and user.role != "platform_admin":
        raise forbidden("נדרשת הרשאת מנהל צוות")


async def _build_team(db: DBSession, team: Team) -> TeamResponse:
    rows = (await db.scalars(select(TeamMember).where(TeamMember.team_id == team.id))).all()
    members = []
    for m in rows:
        u = await db.get(User, m.user_id)
        members.append(MemberResponse(id=m.id, user_id=m.user_id,
                                      email=u.email if u else "", display_name=u.display_name if u else "",
                                      role=m.role))
    return TeamResponse(id=team.id, name=team.name, slug=team.slug,
                        owner_user_id=team.owner_user_id, members=members)


@router.get("", response_model=list[TeamResponse])
async def list_my_teams(user: CurrentUser, db: DBSession) -> list[TeamResponse]:
    team_ids = list((await db.scalars(
        select(TeamMember.team_id).where(TeamMember.user_id == user.id)
    )).all())
    if not team_ids:
        return []
    teams = (await db.scalars(
        select(Team).where(Team.id.in_(team_ids), Team.deleted_at.is_(None))
    )).all()
    return [await _build_team(db, t) for t in teams]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=TeamResponse)
async def create_team(req: TeamCreate, user: CurrentUser, db: DBSession) -> TeamResponse:
    base = slugify(req.name)
    slug, i = base, 2
    while await db.scalar(select(Team.id).where(Team.slug == slug)) is not None:
        slug = f"{base}-{i}"; i += 1
    team = Team(id=new_team_id(), name=req.name, slug=slug, owner_user_id=user.id)
    db.add(team)
    await db.flush()
    db.add(TeamMember(team_id=team.id, user_id=user.id, role=TeamRole.admin))
    await record_audit(db, action="team.create", actor_user_id=user.id,
                       target_type="team", target_id=team.id, team_id=team.id)
    return await _build_team(db, team)


@router.get("/{team_id}", response_model=TeamResponse)
async def get_team(team_id: str, user: CurrentUser, db: DBSession) -> TeamResponse:
    await _require_member(db, team_id, user)
    team = await db.get(Team, team_id)
    if team is None or team.deleted_at is not None:
        raise not_found("הצוות לא נמצא")
    return await _build_team(db, team)


@router.post("/{team_id}/members", status_code=status.HTTP_201_CREATED, response_model=TeamResponse)
async def add_member(team_id: str, req: MemberAdd, user: CurrentUser, db: DBSession) -> TeamResponse:
    await _require_admin(db, team_id, user)
    team = await db.get(Team, team_id)
    if team is None:
        raise not_found("הצוות לא נמצא")
    target = await db.scalar(select(User).where(User.email == req.email.lower()))
    if target is None:
        raise APIError(ErrorCode.NOT_FOUND, "לא נמצא משתמש עם האימייל הזה", status_code=404)
    existing = await db.scalar(
        select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == target.id)
    )
    if existing is not None:
        raise APIError(ErrorCode.CONFLICT, "המשתמש כבר חבר בצוות", status_code=409)
    db.add(TeamMember(team_id=team_id, user_id=target.id, role=req.role, invited_by_user_id=user.id))
    await record_audit(db, action="team.member_add", actor_user_id=user.id,
                       target_type="user", target_id=target.id, team_id=team_id,
                       extra={"role": req.role.value})
    return await _build_team(db, team)


@router.patch("/{team_id}/members/{member_id}", response_model=TeamResponse)
async def update_member(team_id: str, member_id: str, req: MemberUpdate,
                        user: CurrentUser, db: DBSession) -> TeamResponse:
    await _require_admin(db, team_id, user)
    member = await db.get(TeamMember, member_id)
    if member is None or member.team_id != team_id:
        raise not_found("החבר לא נמצא")
    member.role = req.role
    await record_audit(db, action="team.member_update", actor_user_id=user.id,
                       target_type="user", target_id=member.user_id, team_id=team_id,
                       extra={"role": req.role.value})
    team = await db.get(Team, team_id)
    return await _build_team(db, team)


@router.delete("/{team_id}/members/{member_id}", response_model=OkResponse)
async def remove_member(team_id: str, member_id: str, user: CurrentUser, db: DBSession) -> OkResponse:
    await _require_admin(db, team_id, user)
    member = await db.get(TeamMember, member_id)
    if member is None or member.team_id != team_id:
        raise not_found("החבר לא נמצא")
    team = await db.get(Team, team_id)
    if team is not None and team.owner_user_id == member.user_id:
        raise APIError(ErrorCode.CONFLICT, "לא ניתן להסיר את בעל הצוות", status_code=409)
    await db.delete(member)
    await record_audit(db, action="team.member_remove", actor_user_id=user.id,
                       target_type="user", target_id=member.user_id, team_id=team_id)
    return OkResponse()
