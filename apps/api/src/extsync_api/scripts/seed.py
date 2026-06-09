"""Seed data + admin creation (§36).

Idempotent: re-running updates existing rows rather than duplicating. Creates:
  * a platform admin
  * a sample developer (email verified) with a developer profile
  * a sample team with the developer as admin
  * a sample project (with a generated stable signing key / extension id)
  * a public install link for that project

Run:  python -m extsync_api.scripts.seed
Env overrides: ADMIN_EMAIL, ADMIN_PASSWORD, DEV_EMAIL, DEV_PASSWORD
"""
from __future__ import annotations

import asyncio
import os
import secrets

from sqlalchemy import select

from ..db import get_sessionmaker
from ..ids import secret_token
from ..models.enums import ProjectStatus, ProjectVisibility, TeamRole, UserRole
from ..models.install_link import InstallLink
from ..models.project import Project, ProjectKey
from ..models.team import Team, TeamMember
from ..models.user import DeveloperProfile, User
from ..security.crypto import encrypt_str
from ..security.passwords import hash_password
from ..services.extension_key import generate_project_keypair
from ..models.base import utcnow


async def _get_or_create_user(session, email, password, role, name) -> tuple[User, bool]:
    user = await session.scalar(select(User).where(User.email == email))
    if user:
        return user, False
    user = User(email=email, password_hash=hash_password(password), display_name=name,
                role=role, email_verified=True)
    session.add(user)
    await session.flush()
    return user, True


async def seed() -> None:
    # NOTE: use a real TLD — email-validator rejects reserved names like .local.
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@extsync.dev")
    admin_password = os.environ.get("ADMIN_PASSWORD") or ("Admin-" + secrets.token_urlsafe(9))
    dev_email = os.environ.get("DEV_EMAIL", "dev@extsync.dev")
    dev_password = os.environ.get("DEV_PASSWORD") or ("Dev-" + secrets.token_urlsafe(9))

    sm = get_sessionmaker()
    async with sm() as session:
        admin, admin_new = await _get_or_create_user(
            session, admin_email, admin_password, UserRole.platform_admin, "Platform Admin")
        dev, dev_new = await _get_or_create_user(
            session, dev_email, dev_password, UserRole.developer, "Sample Developer")

        if dev_new:
            session.add(DeveloperProfile(user_id=dev.id, org_name="ExtSync Demo Labs",
                                         accepted_terms_at=utcnow(),
                                         support_email="support@extsync.local"))

        team = await session.scalar(select(Team).where(Team.slug == "demo-team"))
        if team is None:
            team = Team(name="Demo Team", slug="demo-team", owner_user_id=dev.id)
            session.add(team)
            await session.flush()
            session.add(TeamMember(team_id=team.id, user_id=dev.id, role=TeamRole.admin))

        project = await session.scalar(select(Project).where(Project.slug == "hello-extsync"))
        if project is None:
            private_pem, public_b64, ext_id = generate_project_keypair()
            project = Project(
                slug="hello-extsync", name="Hello ExtSync",
                short_description="תוסף דוגמה להדגמת מחזור החיים של ExtSync",
                full_description="תוסף הדגמה פשוט עם ExtSync Bridge.",
                visibility=ProjectVisibility.public, status=ProjectStatus.draft,
                owner_user_id=dev.id, team_id=team.id, extension_id=ext_id,
                bridge_mode="integrated",
            )
            session.add(project)
            await session.flush()
            session.add(ProjectKey(project_id=project.id, public_key_b64=public_b64,
                                   private_key_encrypted=encrypt_str(private_pem), extension_id=ext_id))

            session.add(InstallLink(project_id=project.id, token=secret_token(32),
                                    label="Public link", created_by_user_id=dev.id))

        await session.commit()

    print("=" * 60)
    print("ExtSync seed complete.")
    if admin_new:
        print(f"  ADMIN     {admin_email}  /  {admin_password}")
    else:
        print(f"  ADMIN     {admin_email}  (existing — password unchanged)")
    if dev_new:
        print(f"  DEVELOPER {dev_email}  /  {dev_password}")
    else:
        print(f"  DEVELOPER {dev_email}  (existing — password unchanged)")
    print("  PROJECT   hello-extsync (public)")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(seed())
