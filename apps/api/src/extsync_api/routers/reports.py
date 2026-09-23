"""Extension reports: anyone can report an extension; only administrators read them.

Two audiences, kept in one module so the privacy rule is visible next to the
place it is enforced:

  POST /catalog/{slug}/report        anyone, signed in or not
  /admin/moderation/reports/...      platform administrators only

A report is NEVER shown to the extension's developer. It may be about the
developer's own conduct, and routing it to them would warn the person being
reported. That is also why this is not built on ExtensionFeedback, which is a
message TO the developer.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Request, status
from sqlalchemy import select
from sqlalchemy.orm import aliased

from ..deps import AdminUser, DBSession, OptionalUser
from ..errors import not_found
from ..models.enums import Channel
from ..models.extension_report import REPORT_OPEN, ExtensionReport
from ..models.project import Project
from ..models.release import ChannelState
from ..models.user import User
from ..schemas.common import OkResponse
from ..schemas.report import ReportCreate, ReportHandle
from ..services.audit import record_audit
from ..services.availability import public_project_clause
from ..services.ratelimit import client_ip, enforce_rate_limit

router = APIRouter(tags=["reports"])


def _iso(v) -> str | None:
    return v.isoformat().replace("+00:00", "Z") if v else None


# ------------------------------------------------------------------- public
@router.post("/catalog/{slug}/report", status_code=status.HTTP_201_CREATED,
             response_model=OkResponse)
async def report_extension(slug: str, req: ReportCreate, user: OptionalUser,
                           db: DBSession, request: Request) -> OkResponse:
    """Report a public extension to the site administrators.

    No account needed, and nothing is required: the reason and the email are
    both optional. That makes this an open endpoint, so it is rate limited per
    connection - broadly, so one source cannot flood the queue, and per
    extension, so one source cannot bury a single extension in reports.
    """
    ip = client_ip(request)
    await enforce_rate_limit(f"report:ip:{ip}", limit=10, window_seconds=3600)
    await enforce_rate_limit(f"report:ip:{ip}:{slug}", limit=3, window_seconds=86400)

    project = await db.scalar(
        select(Project).where(Project.slug == slug, public_project_clause())
    )
    if project is None:
        raise not_found("התוסף לא נמצא")

    # The version that was live at the moment of the report, so the report is
    # about what the reporter actually saw rather than whatever ships later.
    live = await db.scalar(
        select(ChannelState.active_release_id).where(
            ChannelState.project_id == project.id,
            ChannelState.channel == Channel.stable,
        )
    )

    db.add(ExtensionReport(
        project_id=project.id,
        release_id=live,
        reason=req.reason,
        reporter_email=req.email,
        reporter_user_id=user.id if user else None,
    ))
    await db.commit()
    # Deliberately no notification to the developer, and no echo of what was
    # recorded: the reporter learns only that it was received.
    return OkResponse()


# -------------------------------------------------------------------- admin
@router.get("/admin/moderation/reports")
async def list_reports(_: AdminUser, db: DBSession, state: str = REPORT_OPEN,
                       limit: int = 200) -> list[dict]:
    """Reports, newest first. `state=all` for every report regardless of status."""
    reporter = aliased(User)
    stmt = (
        select(ExtensionReport, Project.name, Project.slug, reporter.email)
        .join(Project, Project.id == ExtensionReport.project_id)
        .join(reporter, reporter.id == ExtensionReport.reporter_user_id, isouter=True)
        .order_by(ExtensionReport.created_at.desc())
        .limit(min(limit, 500))
    )
    if state != "all":
        stmt = stmt.where(ExtensionReport.status == state)
    rows = (await db.execute(stmt)).all()
    return [
        {
            "id": r.id,
            "projectId": r.project_id,
            "projectName": name,
            "projectSlug": slug,
            "releaseId": r.release_id,
            "reason": r.reason,
            "reporterEmail": r.reporter_email,
            # The reporter's ACCOUNT email only if they were signed in. Shown to
            # administrators so repeat or bad-faith reporters can be spotted.
            "reporterAccount": account,
            "status": r.status,
            "createdAt": _iso(r.created_at),
            "handledAt": _iso(r.handled_at),
            "handledByEmail": r.handled_by_email_snapshot,
            "adminNote": r.admin_note,
        }
        for r, name, slug, account in rows
    ]


@router.post("/admin/moderation/reports/{report_id}")
async def handle_report(report_id: str, req: ReportHandle, admin: AdminUser,
                        db: DBSession, request: Request) -> dict:
    """Mark a report resolved, dismissed, or re-open it."""
    report = await db.get(ExtensionReport, report_id)
    if report is None:
        raise not_found("הדיווח לא נמצא")

    report.status = req.status
    if req.status == REPORT_OPEN:
        report.handled_at = None
        report.handled_by_user_id = None
        report.handled_by_email_snapshot = None
    else:
        report.handled_at = dt.datetime.now(dt.timezone.utc)
        report.handled_by_user_id = admin.id
        report.handled_by_email_snapshot = admin.email
    if req.admin_note is not None:
        report.admin_note = req.admin_note.strip() or None

    await record_audit(
        db, action=f"moderation.report_{req.status}", actor=admin,
        target_type="extension_report", target_id=report.id,
        project_id=report.project_id, ip_address=client_ip(request),
        extra={"note": report.admin_note},
    )
    await db.commit()
    return {"ok": True, "status": report.status}
