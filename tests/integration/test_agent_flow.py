"""Agent lifecycle: register device, install via link, receive + report updates,
deterministic rollout, and automatic rollout stop (§6, §22, acceptance 15-23)."""
from __future__ import annotations

import asyncio
import io
import json
import zipfile

from sqlalchemy import func, select

from extsync_api.db import get_sessionmaker
from extsync_api.models.device import UpdateAttempt
from extsync_release_schema import rollout_bucket
from extsync_worker.pipeline import process_validation_job


def _zip(version: str) -> bytes:
    manifest = {
        "manifest_version": 3, "name": "AgentDemo", "version": version,
        "action": {"default_title": "x"}, "icons": {"16": "i.png"},
        "background": {"service_worker": "sw.js"}, "permissions": ["storage"],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        zf.writestr("sw.js", "1")
        zf.writestr("i.png", b"x")
    return buf.getvalue()


def _run_worker(release_id: str) -> str:
    async def _go():
        sm = get_sessionmaker()
        async with sm() as s:
            st = await process_validation_job(s, release_id)
            await s.commit()
            return st
    return asyncio.run(_go())


def _dev(client, email="dev@a.com"):
    client.post("/auth/register", json={"email": email, "password": "Sup3r-Secret!",
                "displayName": "D", "orgName": "Org", "acceptTerms": True})
    tok = client.post("/auth/login", json={"email": email, "password": "Sup3r-Secret!"}).json()["accessToken"]
    return {"Authorization": f"Bearer {tok}"}


def _publish(client, h, project_id, version, rollout=100):
    up = client.post(f"/projects/{project_id}/releases", headers=h,
                     files={"file": (f"{version}.zip", _zip(version), "application/zip")},
                     data={"version": version, "channel": "stable", "minimumAgentVersion": "1.0.0"})
    rid = up.json()["id"]
    _run_worker(rid)
    client.post(f"/projects/{project_id}/releases/{rid}/publish", headers=h,
                json={"rolloutPercentage": rollout})
    return rid


def test_agent_install_and_update_cycle(client):
    h = _dev(client)
    project_id = client.post("/projects", headers=h, json={"name": "AgentDemo", "visibility": "public"}).json()["id"]
    r1 = _publish(client, h, project_id, "1.0.0")

    link = client.post(f"/projects/{project_id}/install-links", headers=h,
                       json={"channel": "stable", "linkType": "public"}).json()
    token = link["token"]

    # public install page resolve (no auth)
    page = client.post(f"/install-links/{token}/resolve").json()
    assert page["name"] == "AgentDemo"
    assert page["version"] == "1.0.0"
    assert page["installUri"].startswith("extsync://install?token=")

    # agent registers
    reg = client.post("/agent/register", json={"anonymousDeviceId": "device-aaaa-1111", "os": "windows"})
    assert reg.status_code == 200
    device_token = reg.json()["deviceToken"]
    ah = {"X-Agent-Token": device_token}

    # heartbeat
    hb = client.post("/agent/heartbeat", headers=ah, json={"agentVersion": "1.0.0"})
    assert hb.status_code == 200 and hb.json()["updateRequired"] is False

    # register the extension via the install link
    rx = client.post("/agent/register-extension", headers=ah,
                     json={"token": token, "hasBridge": True, "extensionId": "a" * 32})
    assert rx.status_code == 200, rx.text
    assert rx.json()["status"] == "awaiting_manual_load"
    assert rx.json()["metadata"]["version"] == "1.0.0"

    # report initial install success for v1
    rep = client.post("/agent/report-update", headers=ah, json={
        "projectId": project_id, "releaseId": r1, "idempotencyKey": "k-v1",
        "toVersion": "1.0.0", "status": "success", "reloadCompleted": True,
    })
    assert rep.status_code == 200

    # check-updates: now up to date
    cu = client.post("/agent/check-updates", headers=ah, json={
        "items": [{"projectId": project_id, "channel": "stable", "currentSequence": 1}]
    })
    assert cu.json()["updates"][0]["available"] is False

    # developer publishes v2
    r2 = _publish(client, h, project_id, "2.0.0")

    cu2 = client.post("/agent/check-updates", headers=ah, json={
        "items": [{"projectId": project_id, "channel": "stable", "currentSequence": 1}]
    })
    upd = cu2.json()["updates"][0]
    assert upd["available"] is True
    assert upd["metadata"]["version"] == "2.0.0"
    assert upd["metadata"]["sequence"] == 2

    # report v2 success
    client.post("/agent/report-update", headers=ah, json={
        "projectId": project_id, "releaseId": r2, "idempotencyKey": "k-v2",
        "fromVersion": "1.0.0", "toVersion": "2.0.0", "status": "success", "reloadCompleted": True,
    })

    # idempotency: same key does not create a second attempt
    client.post("/agent/report-update", headers=ah, json={
        "projectId": project_id, "releaseId": r2, "idempotencyKey": "k-v2",
        "fromVersion": "1.0.0", "toVersion": "2.0.0", "status": "success", "reloadCompleted": True,
    })

    async def _count():
        sm = get_sessionmaker()
        async with sm() as s:
            return await s.scalar(
                select(func.count()).select_from(UpdateAttempt).where(UpdateAttempt.release_id == r2)
            )
    assert asyncio.run(_count()) == 1


def test_rollout_is_deterministic(client):
    h = _dev(client, email="dev2@a.com")
    project_id = client.post("/projects", headers=h, json={"name": "RollDemo", "visibility": "public"}).json()["id"]
    _publish(client, h, project_id, "1.0.0", rollout=1)  # 1% rollout

    anon = "device-rollout-test-1"
    reg = client.post("/agent/register", json={"anonymousDeviceId": anon, "os": "windows"})
    ah = {"X-Agent-Token": reg.json()["deviceToken"]}

    cu = client.post("/agent/check-updates", headers=ah, json={
        "items": [{"projectId": project_id, "channel": "stable", "currentSequence": 0}]
    }).json()["updates"][0]

    bucket = rollout_bucket(project_id, anon)
    if bucket < 1:
        assert cu["available"] is True
    else:
        assert cu["available"] is False
        assert cu["reason"] == "rollout"


def test_rollout_auto_stop_on_failures(client):
    h = _dev(client, email="dev3@a.com")
    project_id = client.post("/projects", headers=h, json={"name": "StopDemo", "visibility": "public"}).json()["id"]
    rid = _publish(client, h, project_id, "1.0.0")
    token = client.post(f"/projects/{project_id}/install-links", headers=h,
                        json={"channel": "stable"}).json()["token"]

    reg = client.post("/agent/register", json={"anonymousDeviceId": "stop-dev-1", "os": "windows"})
    ah = {"X-Agent-Token": reg.json()["deviceToken"]}
    client.post("/agent/register-extension", headers=ah, json={"token": token})

    # report many failures -> auto stop
    for i in range(8):
        client.post("/agent/report-update", headers=ah, json={
            "projectId": project_id, "releaseId": rid, "idempotencyKey": f"fail-{i}",
            "toVersion": "1.0.0", "status": "failed", "errorCode": "RELOAD_TIMEOUT",
        })

    # channel auto-paused -> no active release served
    reg2 = client.post("/agent/register", json={"anonymousDeviceId": "stop-dev-2", "os": "windows"})
    ah2 = {"X-Agent-Token": reg2.json()["deviceToken"]}
    cu = client.post("/agent/check-updates", headers=ah2, json={
        "items": [{"projectId": project_id, "channel": "stable", "currentSequence": 0}]
    }).json()["updates"][0]
    assert cu["available"] is False
    assert cu["reason"] == "no_active_release"
