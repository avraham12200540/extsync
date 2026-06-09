"""Project endpoints (§23)."""
from __future__ import annotations

from fastapi import APIRouter, Request, status

from ..deps import CurrentUser, DBSession
from ..models.project import Project
from ..rbac import Permission, effective_project_permissions, global_permissions
from ..schemas.common import OkResponse
from ..schemas.project import ProjectCreate, ProjectResponse, ProjectUpdate
from ..services import project_service as svc
from ..services.authz import load_project_for_user
from ..services.ratelimit import client_ip

router = APIRouter(prefix="/projects", tags=["projects"])


def _to_response(project: Project, perms: set[Permission]) -> ProjectResponse:
    data = ProjectResponse.model_validate(project)
    data.permissions = sorted(p.value for p in perms)
    return data


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ProjectResponse)
async def create_project(req: ProjectCreate, request: Request, user: CurrentUser, db: DBSession) -> ProjectResponse:
    if Permission.PROJECT_CREATE not in global_permissions(user.role):
        from ..errors import forbidden
        raise forbidden("נדרש חשבון מפתח כדי ליצור פרויקט")
    project = await svc.create_project(db, user, req, ip=client_ip(request))
    # Creator is owner -> full permissions.
    perms = effective_project_permissions(user_role=user.role, is_owner=True, team_role=None)
    return _to_response(project, perms)


@router.get("", response_model=list[ProjectResponse])
async def list_projects(user: CurrentUser, db: DBSession) -> list[ProjectResponse]:
    projects = await svc.list_projects_for_user(db, user)
    out: list[ProjectResponse] = []
    for p in projects:
        is_owner = p.owner_user_id == user.id
        perms = effective_project_permissions(user_role=user.role, is_owner=is_owner, team_role=None)
        out.append(_to_response(p, perms))
    return out


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, user: CurrentUser, db: DBSession) -> ProjectResponse:
    project, perms = await load_project_for_user(db, project_id, user, Permission.PROJECT_READ)
    return _to_response(project, perms)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, req: ProjectUpdate, request: Request,
                         user: CurrentUser, db: DBSession) -> ProjectResponse:
    project, perms = await load_project_for_user(db, project_id, user, Permission.PROJECT_UPDATE)
    project = await svc.update_project(db, project, req, user=user, ip=client_ip(request))
    return _to_response(project, perms)


@router.delete("/{project_id}", response_model=OkResponse)
async def delete_project(project_id: str, request: Request, user: CurrentUser, db: DBSession) -> OkResponse:
    project, _ = await load_project_for_user(db, project_id, user, Permission.PROJECT_DELETE)
    await svc.delete_project(db, project, user=user, ip=client_ip(request))
    return OkResponse()
