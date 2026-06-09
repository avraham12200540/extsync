"""Project domain logic (§8, §21)."""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import conflict
from ..models.enums import ProjectStatus, TeamRole
from ..models.project import Project, ProjectKey
from ..models.team import TeamMember
from ..models.user import User
from ..schemas.project import ProjectCreate, ProjectUpdate, slugify
from ..security.crypto import encrypt_str
from .audit import record_audit
from .extension_key import generate_project_keypair


async def _unique_slug(db: AsyncSession, base: str) -> str:
    slug = base
    i = 2
    while await db.scalar(select(Project.id).where(Project.slug == slug)) is not None:
        slug = f"{base}-{i}"
        i += 1
    return slug


async def create_project(db: AsyncSession, user: User, data: ProjectCreate, *, ip: str | None) -> Project:
    base_slug = data.slug or slugify(data.name)
    slug = await _unique_slug(db, base_slug)

    # If the project is team-scoped, verify the user may create in that team.
    if data.team_id:
        member = await db.scalar(
            select(TeamMember).where(
                TeamMember.team_id == data.team_id, TeamMember.user_id == user.id
            )
        )
        if member is None or member.role != TeamRole.admin:
            raise conflict("אין לך הרשאה ליצור פרויקט בצוות הזה")

    # Generate the per-project signing key that yields the stable extension id.
    private_pem, public_b64, extension_id = generate_project_keypair()

    project = Project(
        slug=slug,
        name=data.name.strip(),
        short_description=data.short_description,
        full_description=data.full_description,
        website=data.website,
        repo_url=data.repo_url,
        support_url=data.support_url,
        privacy_policy_url=data.privacy_policy_url,
        category=data.category,
        visibility=data.visibility,
        status=ProjectStatus.draft,
        owner_user_id=user.id,
        team_id=data.team_id,
        extension_id=extension_id,
        bridge_mode=data.bridge_mode,
    )
    db.add(project)
    await db.flush()

    db.add(ProjectKey(
        project_id=project.id,
        public_key_b64=public_b64,
        private_key_encrypted=encrypt_str(private_pem),  # never leaves the server
        extension_id=extension_id,
    ))
    await record_audit(db, action="project.create", actor_user_id=user.id,
                       target_type="project", target_id=project.id, project_id=project.id, ip_address=ip)
    return project


async def list_projects_for_user(db: AsyncSession, user: User) -> list[Project]:
    # Projects owned by the user OR belonging to a team the user is a member of.
    team_ids = [
        row for row in (await db.scalars(
            select(TeamMember.team_id).where(TeamMember.user_id == user.id)
        )).all()
    ]
    conditions = [Project.owner_user_id == user.id]
    if team_ids:
        conditions.append(Project.team_id.in_(team_ids))
    stmt = (
        select(Project)
        .where(Project.deleted_at.is_(None), or_(*conditions))
        .order_by(Project.created_at.desc())
    )
    return list((await db.scalars(stmt)).all())


async def update_project(db: AsyncSession, project: Project, data: ProjectUpdate, *,
                         user: User, ip: str | None) -> Project:
    if data.expected_version is not None and data.expected_version != project.version:
        raise conflict("הפרויקט עודכן בינתיים. רעננו ונסו שוב.")
    fields = data.model_dump(exclude_unset=True, exclude={"expected_version"}, by_alias=False)
    for key, value in fields.items():
        setattr(project, key, value)
    await record_audit(db, action="project.update", actor_user_id=user.id,
                       target_type="project", target_id=project.id, project_id=project.id,
                       ip_address=ip, extra={"fields": list(fields.keys())})
    return project


async def delete_project(db: AsyncSession, project: Project, *, user: User, ip: str | None) -> None:
    from ..models.base import utcnow

    project.status = ProjectStatus.deleted
    project.deleted_at = utcnow()
    await record_audit(db, action="project.delete", actor_user_id=user.id,
                       target_type="project", target_id=project.id, project_id=project.id, ip_address=ip)
