"""Build the validated, immutable artifact: inject the stable manifest `key`,
RE-ROOT so manifest.json sits at the top level, and repack deterministically
(§11, ADR-0005). Re-rooting is essential: Chrome (and the Agent's local check)
require manifest.json at the root of the loaded folder. Developer ZIPs often
wrap everything in a single top folder (e.g. my-ext/manifest.json); we strip it."""
from __future__ import annotations

import hashlib
import io
import json
import posixpath
import zipfile


def find_manifest_path(zf: zipfile.ZipFile) -> str | None:
    candidates = [n for n in zf.namelist() if n.endswith("manifest.json")]
    if not candidates:
        return None
    candidates.sort(key=lambda n: n.count("/"))
    return candidates[0]


def inject_manifest_key(zip_bytes: bytes, public_key_b64: str) -> tuple[bytes, str]:
    """Return (new_zip_bytes, sha256_hex) with manifest.key set and files re-rooted
    so manifest.json is at the archive root. Files outside the manifest's folder
    (rare) are kept at their original path."""
    src = zipfile.ZipFile(io.BytesIO(zip_bytes))
    manifest_path = find_manifest_path(src)
    if manifest_path is None:
        raise ValueError("manifest.json not found while building artifact")

    # The wrapper prefix to strip, e.g. "my-ext/" (empty if manifest already at root).
    prefix = manifest_path[: -len("manifest.json")]

    def reroot(name: str) -> str:
        if prefix and name.startswith(prefix):
            return name[len(prefix):]
        return name

    out_buf = io.BytesIO()
    seen: set[str] = set()
    with zipfile.ZipFile(out_buf, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            if info.is_dir():
                continue
            new_name = reroot(info.filename)
            if not new_name or new_name in seen:
                continue
            seen.add(new_name)
            data = src.read(info.filename)
            if info.filename == manifest_path:
                manifest = json.loads(data.decode("utf-8"))
                manifest["key"] = public_key_b64
                data = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
            # Normalize timestamps for reproducible artifacts.
            zi = zipfile.ZipInfo(filename=new_name, date_time=(1980, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            dst.writestr(zi, data)

    artifact = out_buf.getvalue()
    return artifact, hashlib.sha256(artifact).hexdigest()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
