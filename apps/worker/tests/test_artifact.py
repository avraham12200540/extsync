"""Artifact builder: key injection + re-rooting (manifest must end up at root)."""
from __future__ import annotations

import io
import json
import zipfile

from extsync_worker.artifact import inject_manifest_key


def _zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


def _names_and_manifest(data: bytes):
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = set(zf.namelist())
    manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
    return names, manifest


def test_reroots_wrapped_extension():
    src = _zip({
        "my-ext/manifest.json": json.dumps({"manifest_version": 3, "name": "X", "version": "2.5.2"}),
        "my-ext/sw.js": "console.log(1)",
        "my-ext/icons/i.png": "x",
    })
    out, sha = inject_manifest_key(src, "PUBKEYB64")
    names, manifest = _names_and_manifest(out)
    # manifest + files are at the root now, wrapper folder stripped
    assert "manifest.json" in names
    assert "sw.js" in names
    assert "icons/i.png" in names
    assert not any(n.startswith("my-ext/") for n in names)
    assert manifest["key"] == "PUBKEYB64"
    assert manifest["version"] == "2.5.2"
    assert len(sha) == 64


def test_keeps_root_extension_unchanged_structure():
    src = _zip({
        "manifest.json": json.dumps({"manifest_version": 3, "name": "X", "version": "1.0.0"}),
        "sw.js": "1",
    })
    out, _ = inject_manifest_key(src, "K")
    names, manifest = _names_and_manifest(out)
    assert names == {"manifest.json", "sw.js"}
    assert manifest["key"] == "K"


# --------------------------------------------------------------------- bridge inject
from extsync_worker.artifact import build_validated_artifact  # noqa: E402


def _build(files: dict[str, str], project_id="ext_abc", channel="stable"):
    out, sha, injected = build_validated_artifact(
        _zip(files), "PUB", project_id=project_id, channel=channel
    )
    zf = zipfile.ZipFile(io.BytesIO(out))
    names = set(zf.namelist())
    manifest = json.loads(zf.read("manifest.json"))
    read = lambda n: zf.read(n).decode("utf-8")
    return names, manifest, injected, read


def test_injects_bridge_as_service_worker_when_no_background():
    files = {
        "manifest.json": json.dumps({
            "manifest_version": 3, "name": "ContentOnly", "version": "1.0.0",
            "permissions": ["storage"],
            "content_scripts": [{"matches": ["https://x.com/*"], "js": ["c.js"]}],
        }),
        "c.js": "// content",
    }
    names, manifest, injected, read = _build(files, project_id="ext_xyz")
    assert injected is True
    assert "extsync-bridge.js" in names
    assert manifest["background"]["service_worker"] == "extsync-bridge.js"
    assert "nativeMessaging" in manifest["permissions"]
    assert "storage" in manifest["permissions"]
    # content scripts -> scripting permission for the refresh toast + baked matches
    assert "scripting" in manifest["permissions"]
    bridge_src = read("extsync-bridge.js")
    assert "ext_xyz" in bridge_src                 # projectId baked in
    assert "com.extsync.agent" in bridge_src       # local Agent only
    assert "https://x.com/*" in bridge_src         # toast targets the content-script hosts


def test_no_scripting_permission_without_content_scripts():
    files = {
        "manifest.json": json.dumps({
            "manifest_version": 3, "name": "PopupOnly", "version": "1.0.0",
            "action": {"default_popup": "p.html"},
        }),
        "p.html": "<html></html>",
    }
    _names, manifest, injected, read = _build(files)
    assert injected is True
    assert "nativeMessaging" in manifest["permissions"]
    assert "scripting" not in manifest["permissions"]   # nothing to refresh
    assert "var MATCHES = []" in read("extsync-bridge.js")


def test_injects_bridge_into_existing_module_service_worker():
    files = {
        "manifest.json": json.dumps({
            "manifest_version": 3, "name": "HasSW", "version": "1.0.0",
            "background": {"service_worker": "bg/worker.js", "type": "module"},
        }),
        "bg/worker.js": "console.log('mine');",
    }
    names, manifest, injected, read = _build(files)
    assert injected is True
    # bridge placed next to the developer's worker and imported first
    assert "bg/extsync-bridge.js" in names
    assert read("bg/worker.js").startswith('import "./extsync-bridge.js";')
    assert "console.log('mine');" in read("bg/worker.js")
    assert manifest["background"]["service_worker"] == "bg/worker.js"  # unchanged


def test_injects_bridge_into_existing_classic_service_worker():
    files = {
        "manifest.json": json.dumps({
            "manifest_version": 3, "name": "Classic", "version": "1.0.0",
            "background": {"service_worker": "sw.js"},
        }),
        "sw.js": "self.x=1;",
    }
    _names, _manifest, injected, read = _build(files)
    assert injected is True
    assert read("sw.js").startswith('try{importScripts("extsync-bridge.js");}catch(e){}')


def test_skips_injection_when_extension_ships_its_own_bridge():
    files = {
        "manifest.json": json.dumps({
            "manifest_version": 3, "name": "OwnBridge", "version": "1.0.0",
            "background": {"service_worker": "sw.js", "type": "module"},
            "permissions": ["nativeMessaging"],
        }),
        "sw.js": "import './extsync-bridge.mjs';",
        "extsync-bridge.mjs": "// dev's own bridge",
    }
    names, _manifest, injected, _read = _build(files)
    assert injected is False
    assert "extsync-bridge.js" not in names  # we didn't add ours
