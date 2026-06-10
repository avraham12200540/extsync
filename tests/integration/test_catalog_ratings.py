"""Store catalog: star ratings (one per user, changeable) + sort by rating."""
from __future__ import annotations

import asyncio
import io
import json
import zipfile


def _zip(version: str = "1.0.0") -> bytes:
    manifest = {"manifest_version": 3, "name": "X", "version": version,
                "background": {"service_worker": "sw.js"}, "permissions": ["storage"]}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        zf.writestr("sw.js", "1")
    return buf.getvalue()


def _auth(client, email):
    client.post("/auth/register", json={
        "email": email, "password": "Sup3r-Secret!",
        "displayName": "U", "orgName": "Acme", "acceptTerms": True})
    tok = client.post("/auth/login", json={"email": email, "password": "Sup3r-Secret!"}).json()["accessToken"]
    return {"Authorization": f"Bearer {tok}"}


def _publish(client, h, name, version="1.0.0"):
    from extsync_api.db import get_sessionmaker
    from extsync_worker.pipeline import process_validation_job
    pid = client.post("/projects", headers=h, json={"name": name, "visibility": "public"}).json()["id"]
    rid = client.post(f"/projects/{pid}/releases", headers=h,
                      files={"file": ("e.zip", _zip(version), "application/zip")},
                      data={"version": version, "channel": "stable"}).json()["id"]

    async def _run():
        sm = get_sessionmaker()
        async with sm() as s:
            await process_validation_job(s, rid); await s.commit()
    asyncio.run(_run())
    client.post(f"/projects/{pid}/releases/{rid}/publish", headers=h, json={"rolloutPercentage": 100})
    slug = client.get(f"/projects/{pid}", headers=h).json()["slug"]
    return slug


def test_rating_one_per_user_changeable_and_sorted(client):
    dev = _auth(client, "dev@example.com")
    low = _publish(client, dev, "Low Rated")
    high = _publish(client, dev, "High Rated")

    u1 = _auth(client, "u1@example.com")
    u2 = _auth(client, "u2@example.com")

    # rate high=5 by both users, low=2 by one
    assert client.put(f"/catalog/{high}/rating", headers=u1, json={"stars": 5}).status_code == 200
    assert client.put(f"/catalog/{high}/rating", headers=u2, json={"stars": 5}).status_code == 200
    assert client.put(f"/catalog/{low}/rating", headers=u1, json={"stars": 2}).status_code == 200

    # changing my vote updates (not duplicates)
    client.put(f"/catalog/{low}/rating", headers=u1, json={"stars": 3})

    # invalid stars rejected
    assert client.put(f"/catalog/{high}/rating", headers=u1, json={"stars": 9}).status_code == 422
    # anonymous cannot rate
    assert client.put(f"/catalog/{high}/rating", json={"stars": 4}).status_code in (401, 403)

    # catalog reflects averages, my_rating, and is sorted high-to-low
    catalog = client.get("/catalog", headers=u1).json()
    by_slug = {c["slug"]: c for c in catalog}
    assert by_slug[high]["avgRating"] == 5 and by_slug[high]["ratingsCount"] == 2
    assert by_slug[high]["myRating"] == 5
    assert by_slug[low]["avgRating"] == 3 and by_slug[low]["ratingsCount"] == 1
    assert catalog[0]["slug"] == high  # highest first

    # detail carries my rating too
    detail = client.get(f"/catalog/{low}", headers=u1).json()
    assert detail["myRating"] == 3 and detail["avgRating"] == 3


def test_public_extension_gets_managed_install_uri_automatically(client):
    dev = _auth(client, "autolink@example.com")
    slug = _publish(client, dev, "Auto Link Ext")
    # no install link was created manually, but the store detail must still offer
    # the managed (auto-updating) install path
    detail = client.get(f"/catalog/{slug}").json()
    assert detail["installUri"], "public published extension must have an install URI"
    assert detail["installUri"].startswith("extsync://install?token=")
    # idempotent: a second view reuses the same link (doesn't pile up)
    again = client.get(f"/catalog/{slug}").json()
    assert again["installUri"] == detail["installUri"]
