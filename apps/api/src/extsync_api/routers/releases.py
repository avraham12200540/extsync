"""Release endpoints (§23)."""
from __future__ import annotations

from fastapi import APIRouter, File, Form, Request, UploadFile, status

from ..deps import CurrentUser, DBSession, PublisherUser
from ..models.enums import Channel
from ..models.release import Release
from ..rbac import Permission
from ..schemas.common import OkResponse
from ..schemas.release import (
    PauseRequest,
    PublishRequest,
    ReleaseListItem,
    ReleaseResponse,
    RevokeRequest,
    RollbackRequest,
)
from ..services import release_service as svc
from ..services.authz import ensure_can_publish, ensure_project_active, load_project_for_user
from ..services.ratelimit import client_ip, enforce_rate_limit

router = APIRouter(prefix="/projects/{project_id}/releases", tags=["releases"])


def _iso(value) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def _response(r: Release) -> ReleaseResponse:
    return ReleaseResponse(
        id=r.id, project_id=r.project_id, version=r.version, channel=r.channel,
        status=r.status, sequence=r.sequence, release_notes=r.release_notes,
        minimum_agent_version=r.minimum_agent_version, rollout_percentage=r.rollout_percentage,
        permissions_changed=r.permissions_changed, requires_user_approval=r.requires_user_approval,
        risk_score=r.risk_score, key_id=r.key_id,
        published_at=_iso(r.published_at), created_at=_iso(r.created_at),
        validation_report=r.validation_report,
    )


def _list_item(r: Release) -> ReleaseListItem:
    return ReleaseListItem(
        id=r.id, version=r.version, channel=r.channel, status=r.status, sequence=r.sequence,
        rollout_percentage=r.rollout_percentage, permissions_changed=r.permissions_changed,
        risk_score=r.risk_score, created_at=_iso(r.created_at), published_at=_iso(r.published_at),
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ReleaseResponse)
async def upload_release(
    project_id: str, request: Request, user: CurrentUser, db: DBSession,
    file: UploadFile = File(...),
    version: str = Form(...),
    channel: Channel = Form(Channel.stable),
    release_notes: str | None = Form(None),
    minimum_agent_version: str = Form("1.0.0"),
) -> ReleaseResponse:
    project, _ = await load_project_for_user(db, project_id, user, Permission.RELEASE_CREATE)
    ensure_project_active(project)
    await enforce_rate_limit(f"upload:{user.id}", limit=60, window_seconds=3600)
    raw = await file.read()
    release = await svc.create_release_with_upload(
        db, project, version=version, channel=channel, release_notes=release_notes,
        minimum_agent_version=minimum_agent_version, raw=raw, user=user, ip=client_ip(request),
    )
    return _response(release)


@router.get("", response_model=list[ReleaseListItem])
async def list_releases(project_id: str, user: CurrentUser, db: DBSession,
                        channel: Channel | None = None) -> list[ReleaseListItem]:
    await load_project_for_user(db, project_id, user, Permission.PROJECT_READ)
    releases = await svc.list_releases(db, project_id, channel)
    return [_list_item(r) for r in releases]


@router.get("/{release_id}", response_model=ReleaseResponse)
async def get_release(project_id: str, release_id: str, user: CurrentUser, db: DBSession) -> ReleaseResponse:
    await load_project_for_user(db, project_id, user, Permission.PROJECT_READ)
    release = await svc.get_release(db, project_id, release_id)
    return _response(release)


@router.delete("/{release_id}", status_code=status.HTTP_200_OK, response_model=OkResponse)
async def delete_release(project_id: str, release_id: str,
                         request: Request, user: CurrentUser, db: DBSession) -> OkResponse:
    project, _ = await load_project_for_user(db, project_id, user, Permission.RELEASE_DELETE_DRAFT)
    release = await svc.get_release(db, project_id, release_id)
    await svc.delete_release(db, project, release, user=user, ip=client_ip(request))
    return OkResponse()


@router.post("/{release_id}/publish", response_model=ReleaseResponse)
async def publish_release(project_id: str, release_id: str, req: PublishRequest,
                          request: Request, user: PublisherUser, db: DBSession) -> ReleaseResponse:
    project, perms = await load_project_for_user(db, project_id, user, Permission.PROJECT_READ)
    ensure_project_active(project)
    release = await svc.get_release(db, project_id, release_id)
    ensure_can_publish(perms, release.channel.value)
    release = await svc.publish_release(
        db, project, release, rollout=req.validated_rollout(), user=user, ip=client_ip(request)
    )
    return _response(release)


@router.post("/{release_id}/pause", response_model=ReleaseResponse)
async def pause_release(project_id: str, release_id: str, req: PauseRequest,
                        request: Request, user: CurrentUser, db: DBSession) -> ReleaseResponse:
    project, perms = await load_project_for_user(db, project_id, user, Permission.PROJECT_READ)
    release = await svc.get_release(db, project_id, release_id)
    ensure_can_publish(perms, release.channel.value)
    release = await svc.pause_release(db, project, release, reason=req.reason, user=user, ip=client_ip(request))
    return _response(release)


@router.post("/{release_id}/revoke", response_model=ReleaseResponse)
async def revoke_release(project_id: str, release_id: str, req: RevokeRequest,
                         request: Request, user: CurrentUser, db: DBSession) -> ReleaseResponse:
    project, perms = await load_project_for_user(db, project_id, user, Permission.PROJECT_READ)
    release = await svc.get_release(db, project_id, release_id)
    ensure_can_publish(perms, release.channel.value)
    release = await svc.revoke_release(db, project, release, reason=req.reason, user=user, ip=client_ip(request))
    return _response(release)


@router.post("/{release_id}/rollback", response_model=ReleaseResponse)
async def rollback_release(project_id: str, release_id: str, req: RollbackRequest,
                           request: Request, user: PublisherUser, db: DBSession) -> ReleaseResponse:
    project, perms = await load_project_for_user(db, project_id, user, Permission.RELEASE_ROLLBACK)
    # `release_id` in the path is the target to roll back TO.
    target = await svc.get_release(db, project_id, release_id)
    result = await svc.rollback_release(
        db, project, target.channel,
        target_release_id=req.target_release_id or release_id, user=user, ip=client_ip(request),
    )
    return _response(result)
