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
