"""End-to-end: register -> project -> upload -> validate -> publish -> verify signature.

Proves acceptance-criteria steps 3-7 (§40) and the signing chain (§12, §26).
"""
from __future__ import annotations

import asyncio
import io
import json
import zipfile

from sqlalchemy import select

from extsync_api.db import get_sessionmaker
from extsync_api.models.enums import ReleaseStatus
from extsync_api.models.release import Release, ReleaseArtifact
from extsync_release_schema import verify_metadata
from extsync_worker.pipeline import process_validation_job


def _make_zip(version: str = "1.0.0", with_bridge: bool = False) -> bytes:
    manifest = {
        "manifest_version": 3,
        "name": "Demo Extension",
        "version": version,
        "description": "Demo",
        "action": {"default_title": "Demo"},
        "icons": {"16": "icon16.png"},
        "background": {"service_worker": "sw.js"},
        "permissions": ["storage"],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        zf.writestr("sw.js", "console.log('hi')")
        zf.writestr("icon16.png", b"\x89PNG\r\n")
        if with_bridge:
            zf.writestr("extsync-bridge.js", "// bridge")
    return buf.getvalue()


def _auth(client, email="owner@example.com"):
    client.post("/auth/register", json={
        "email": email, "password": "Sup3r-Secret!",
        "displayName": "Owner", "orgName": "Acme", "acceptTerms": True,
    })
    token = client.post("/auth/login", json={"email": email, "password": "Sup3r-Secret!"}).json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def _run_worker(release_id: str) -> str:
    async def _go() -> str:
        sm = get_sessionmaker()
        async with sm() as session:
            status = await process_validation_job(session, release_id)
            await session.commit()
            return status

    return asyncio.run(_go())


def test_full_pipeline_upload_validate_publish(client, test_public_keys):
    h = _auth(client)

    # create project
    proj = client.post("/projects", headers=h, json={
        "name": "Demo Extension", "shortDescription": "demo", "visibility": "public",
    })
    assert proj.status_code == 201, proj.text
    project = proj.json()
    project_id = project["id"]
    assert project["extensionId"] and len(project["extensionId"]) == 32

    # upload a release (multipart)
    files = {"file": ("ext.zip", _make_zip("1.0.0"), "application/zip")}
    data = {"version": "1.0.0", "channel": "stable", "minimumAgentVersion": "1.0.0"}
    up = client.post(f"/projects/{project_id}/releases", headers=h, files=files, data=data)
    assert up.status_code == 201, up.text
    release_id = up.json()["id"]
    assert up.json()["status"] == "uploaded"

    # worker validates -> ready
    status = _run_worker(release_id)
    assert status == "ready", status

    got = client.get(f"/projects/{project_id}/releases/{release_id}", headers=h)
    assert got.json()["status"] == "ready"
    assert got.json()["validationReport"]["ok"] is True

    # publish to stable (owner can publish stable)
    pub = client.post(f"/projects/{project_id}/releases/{release_id}/publish",
                      headers=h, json={"rolloutPercentage": 100})
    assert pub.status_code == 200, pub.text
    assert pub.json()["status"] == "published"
    assert pub.json()["sequence"] == 1

    # the stored signed metadata verifies against the platform public key
    async def _check_signature():
        sm = get_sessionmaker()
        async with sm() as session:
            rel = await session.get(Release, release_id)
            assert rel.signed_metadata is not None
            assert rel.signature
            assert verify_metadata(rel.signed_metadata, test_public_keys)
            # tamper -> fails
            bad = dict(rel.signed_metadata)
            bad["version"] = "9.9.9"
            assert not verify_metadata(bad, test_public_keys)
            # validated artifact exists and is separate from the original
            arts = (await session.scalars(
                select(ReleaseArtifact).where(ReleaseArtifact.release_id == release_id)
            )).all()
            kinds = {a.kind for a in arts}
            assert kinds == {"original", "validated"}

    asyncio.run(_check_signature())


def test_invalid_zip_marks_validation_failed(client):
    h = _auth(client, email="owner2@example.com")
    project_id = client.post("/projects", headers=h, json={"name": "Bad Ext", "shortDescription": "t"}).json()["id"]

    # a zip whose manifest is MV2 -> validation must fail
    manifest = {"manifest_version": 2, "name": "Bad", "version": "1.0.0"}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
    files = {"file": ("bad.zip", buf.getvalue(), "application/zip")}
    up = client.post(f"/projects/{project_id}/releases", headers=h,
                     files=files, data={"version": "1.0.0", "channel": "beta"})
    release_id = up.json()["id"]

    status = _run_worker(release_id)
    assert status == "validation_failed"

    got = client.get(f"/projects/{project_id}/releases/{release_id}", headers=h)
    assert got.json()["status"] == "validation_failed"

    # cannot publish a failed release
    pub = client.post(f"/projects/{project_id}/releases/{release_id}/publish", headers=h, json={})
    assert pub.status_code == 409


def _make_wrapped_zip(version: str = "2.5.4", folder: str = "my-ext") -> bytes:
    """A ZIP that wraps everything in a single top folder (the real-world case
    that broke the Agent with INVALID_MANIFEST)."""
    manifest = {
        "manifest_version": 3, "name": "Wrapped", "version": version,
        "background": {"service_worker": "sw.js"}, "permissions": ["storage"],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{folder}/manifest.json", json.dumps(manifest))
        zf.writestr(f"{folder}/sw.js", "console.log('hi')")
    return buf.getvalue()


def test_wrapped_zip_is_rerooted_in_validated_artifact(client, store):
    """A wrapped upload must validate AND the built artifact must have
    manifest.json at the root (so Chrome + the Agent load it)."""
    h = _auth(client, email="wrap@example.com")
    project_id = client.post("/projects", headers=h, json={"name": "Wrapped Ext", "shortDescription": "t"}).json()["id"]

    up = client.post(f"/projects/{project_id}/releases", headers=h,
                     files={"file": ("w.zip", _make_wrapped_zip("2.5.4"), "application/zip")},
                     data={"version": "2.5.4", "channel": "stable", "minimumAgentVersion": "1.0.0"})
    release_id = up.json()["id"]
    assert _run_worker(release_id) == "ready"

    # find the validated artifact bytes in the in-memory store and inspect them
    validated = [v for (bucket, key), v in store.items() if "extension.zip" in key]
    assert validated, "validated artifact not stored"
    zf = zipfile.ZipFile(io.BytesIO(validated[-1]))
    names = set(zf.namelist())
    assert "manifest.json" in names, names           # at the ROOT now
    assert "sw.js" in names
    assert not any(n.startswith("my-ext/") for n in names)  # wrapper stripped
    manifest = json.loads(zf.read("manifest.json"))
    assert manifest["version"] == "2.5.4"
    assert manifest.get("key"), "stable manifest key must be injected"


def test_pipeline_auto_injects_bridge(client, store):
    """An ordinary (no-bridge) upload gets the Bridge auto-injected and is flagged
    hasBridge, so the Agent can reload it in place — zero developer work."""
    h = _auth(client, email="bridge@example.com")
    project_id = client.post("/projects", headers=h, json={"name": "Bridge Ext", "shortDescription": "t"}).json()["id"]

    up = client.post(f"/projects/{project_id}/releases", headers=h,
                     files={"file": ("b.zip", _make_zip("1.0.0"), "application/zip")},
                     data={"version": "1.0.0", "channel": "stable", "minimumAgentVersion": "1.0.0"})
    rid = up.json()["id"]
    assert _run_worker(rid) == "ready"

    got = client.get(f"/projects/{project_id}/releases/{rid}", headers=h).json()
    assert got["validationReport"]["hasBridge"] is True
    assert got["validationReport"].get("bridgeInjected") is True

    validated = [v for (b, k), v in store.items() if "extension.zip" in k]
    zf = zipfile.ZipFile(io.BytesIO(validated[-1]))
    assert "extsync-bridge.js" in zf.namelist()
    manifest = json.loads(zf.read("manifest.json"))
    assert "nativeMessaging" in manifest["permissions"]
    assert project_id in zf.read("extsync-bridge.js").decode("utf-8")


def test_delete_release(client):
    h = _auth(client, email="del@example.com")
    project_id = client.post("/projects", headers=h, json={"name": "Del Ext", "shortDescription": "t"}).json()["id"]

    # a ready-but-unpublished release can be deleted
    up = client.post(f"/projects/{project_id}/releases", headers=h,
                     files={"file": ("v.zip", _make_zip("1.0.0"), "application/zip")},
                     data={"version": "1.0.0", "channel": "stable", "minimumAgentVersion": "1.0.0"})
    rid = up.json()["id"]
    assert _run_worker(rid) == "ready"

    dele = client.delete(f"/projects/{project_id}/releases/{rid}", headers=h)
    assert dele.status_code == 200, dele.text
    assert client.get(f"/projects/{project_id}/releases/{rid}", headers=h).status_code == 404

    # a failed upload attempt can also be deleted
    bad = io.BytesIO()
    with zipfile.ZipFile(bad, "w") as zf:
        zf.writestr("manifest.json", json.dumps({"manifest_version": 2, "name": "B", "version": "9.9"}))
    up2 = client.post(f"/projects/{project_id}/releases", headers=h,
                      files={"file": ("bad.zip", bad.getvalue(), "application/zip")},
                      data={"version": "9.9.9", "channel": "beta"})
    rid2 = up2.json()["id"]
    assert _run_worker(rid2) == "validation_failed"
    assert client.delete(f"/projects/{project_id}/releases/{rid2}", headers=h).status_code == 200


def test_publish_blocked_until_email_verified_when_enforced(client, monkeypatch):
    from extsync_api.config import settings as _settings
    monkeypatch.setattr(_settings, "enforce_email_verification", True)

    h = _auth(client, email="unverified@example.com")  # registers unverified
    project_id = client.post("/projects", headers=h, json={"name": "Gated Ext", "shortDescription": "t"}).json()["id"]
    up = client.post(f"/projects/{project_id}/releases", headers=h,
                     files={"file": ("v.zip", _make_zip("1.0.0"), "application/zip")},
                     data={"version": "1.0.0", "channel": "stable", "minimumAgentVersion": "1.0.0"})
    rid = up.json()["id"]
    _run_worker(rid)

    # publishing is forbidden until the email is verified
    blocked = client.post(f"/projects/{project_id}/releases/{rid}/publish",
                          headers=h, json={"rolloutPercentage": 100})
    assert blocked.status_code == 403, blocked.text

    # resend endpoint works (no email backend in tests, but must not error)
    assert client.post("/auth/resend-verification", headers=h).status_code == 200

    # verify the user directly, then publishing succeeds
    async def _verify():
        from sqlalchemy import select
        from extsync_api.db import get_sessionmaker
        from extsync_api.models.user import User
        sm = get_sessionmaker()
        async with sm() as s:
            u = await s.scalar(select(User).where(User.email == "unverified@example.com"))
            u.email_verified = True
            await s.commit()
    asyncio.run(_verify())

    ok = client.post(f"/projects/{project_id}/releases/{rid}/publish",
                     headers=h, json={"rolloutPercentage": 100})
    assert ok.status_code == 200, ok.text


def test_cannot_delete_published_release(client):
    h = _auth(client, email="delpub@example.com")
    project_id = client.post("/projects", headers=h, json={"name": "DelPub Ext", "shortDescription": "t"}).json()["id"]
    up = client.post(f"/projects/{project_id}/releases", headers=h,
                     files={"file": ("v.zip", _make_zip("1.0.0"), "application/zip")},
                     data={"version": "1.0.0", "channel": "stable", "minimumAgentVersion": "1.0.0"})
    rid = up.json()["id"]
    _run_worker(rid)
    client.post(f"/projects/{project_id}/releases/{rid}/publish", headers=h, json={"rolloutPercentage": 100})

    # the live published release is protected from deletion
    dele = client.delete(f"/projects/{project_id}/releases/{rid}", headers=h)
    assert dele.status_code == 409, dele.text
    assert client.get(f"/projects/{project_id}/releases/{rid}", headers=h).status_code == 200


def test_rollback_keeps_old_release(client, test_public_keys):
    h = _auth(client, email="owner3@example.com")
    project_id = client.post("/projects", headers=h, json={"name": "RB Ext", "shortDescription": "t"}).json()["id"]

    # publish v1
    up1 = client.post(f"/projects/{project_id}/releases", headers=h,
                      files={"file": ("v1.zip", _make_zip("1.0.0"), "application/zip")},
                      data={"version": "1.0.0", "channel": "stable", "minimumAgentVersion": "1.0.0"})
    r1 = up1.json()["id"]
    _run_worker(r1)
    client.post(f"/projects/{project_id}/releases/{r1}/publish", headers=h, json={"rolloutPercentage": 100})

    # publish v2
    up2 = client.post(f"/projects/{project_id}/releases", headers=h,
                      files={"file": ("v2.zip", _make_zip("2.0.0"), "application/zip")},
                      data={"version": "2.0.0", "channel": "stable", "minimumAgentVersion": "1.0.0"})
    r2 = up2.json()["id"]
    _run_worker(r2)
    client.post(f"/projects/{project_id}/releases/{r2}/publish", headers=h, json={"rolloutPercentage": 100})

    # rollback to v1
    rb = client.post(f"/projects/{project_id}/releases/{r1}/rollback", headers=h, json={})
    assert rb.status_code == 200, rb.text
    assert rb.json()["status"] == "published"
    assert rb.json()["sequence"] == 3  # new, higher sequence

    # v1 still present & its rollback metadata is signed + flagged
    async def _check():
        sm = get_sessionmaker()
        async with sm() as session:
            rel1 = await session.get(Release, r1)
            assert rel1.status == ReleaseStatus.published
            assert rel1.signed_metadata.get("rollback") is True
            assert verify_metadata(rel1.signed_metadata, test_public_keys)
            rel2 = await session.get(Release, r2)
            assert rel2.status == ReleaseStatus.superseded  # not deleted
    asyncio.run(_check())
