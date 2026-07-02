"""Build the validated, immutable artifact (§11, ADR-0005):

  1. RE-ROOT so manifest.json sits at the archive root (Chrome + the Agent require
     it there; developer ZIPs often wrap everything in a single top folder).
  2. Inject the stable manifest `key` (gives the extension a fixed ID).
  3. Auto-inject the ExtSync update Bridge so updates reload in place with no
     developer integration (unless the extension already ships its own bridge).
  4. Repack deterministically (sorted, fixed timestamps) for reproducible hashes.
"""
from __future__ import annotations

import hashlib
import io
import json
import zipfile

from .bridge import has_bridge_files, inject_bridge


def find_manifest_path(zf: zipfile.ZipFile) -> str | None:
    candidates = [n for n in zf.namelist() if n.endswith("manifest.json")]
    if not candidates:
        return None
    candidates.sort(key=lambda n: n.count("/"))
    return candidates[0]


def _read_rerooted(zip_bytes: bytes) -> tuple[dict[str, bytes], str]:
    """Return ({archive_path: data}, manifest_path) with files re-rooted so
    manifest.json is at the top level."""
    src = zipfile.ZipFile(io.BytesIO(zip_bytes))
    manifest_path = find_manifest_path(src)
    if manifest_path is None:
        raise ValueError("manifest.json not found while building artifact")
    prefix = manifest_path[: -len("manifest.json")]

    files: dict[str, bytes] = {}
    total = 0
    cap = 314_572_800  # ~300MB, matches the validator's max_extracted ceiling (defense in depth)
    for info in src.infolist():
        if info.is_dir():
            continue
        name = info.filename
        new = name[len(prefix):] if prefix and name.startswith(prefix) else name
        if not new or new in files:
            continue
        data = src.read(name)
        total += len(data)
        if total > cap:
            raise ValueError("extracted artifact exceeds the size cap")
        files[new] = data
    return files, "manifest.json"


def _repack(files: dict[str, bytes]) -> tuple[bytes, str]:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for name in sorted(files):  # deterministic order
            zi = zipfile.ZipInfo(filename=name, date_time=(1980, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            dst.writestr(zi, files[name])
    data = out.getvalue()
    return data, hashlib.sha256(data).hexdigest()


def build_validated_artifact(
    zip_bytes: bytes, public_key_b64: str, *, project_id: str, channel: str,
    add_bridge: bool = True,
) -> tuple[bytes, str, bool]:
    """Return (artifact_bytes, sha256_hex, bridge_injected)."""
    files, manifest_path = _read_rerooted(zip_bytes)
    manifest = json.loads(files[manifest_path].decode("utf-8"))
    manifest["key"] = public_key_b64

    bridge_injected = False
    if add_bridge and not has_bridge_files(files):
        bridge_injected = inject_bridge(files, manifest, project_id, channel)

    files[manifest_path] = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
    data, sha = _repack(files)
    return data, sha, bridge_injected


def inject_manifest_key(zip_bytes: bytes, public_key_b64: str) -> tuple[bytes, str]:
    """Re-root + inject the manifest key only (no bridge). Retained for callers
    that don't need bridge injection."""
    data, sha, _ = build_validated_artifact(
        zip_bytes, public_key_b64, project_id="", channel="stable", add_bridge=False
    )
    return data, sha


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
