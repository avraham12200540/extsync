"""Build the validated, immutable artifact: inject the stable manifest `key`
and repack the ZIP deterministically (§11, ADR-0005)."""
from __future__ import annotations

import hashlib
import io
import json
import zipfile


def find_manifest_path(zf: zipfile.ZipFile) -> str | None:
    candidates = [n for n in zf.namelist() if n.endswith("manifest.json")]
    if not candidates:
        return None
    candidates.sort(key=lambda n: n.count("/"))
    return candidates[0]


def inject_manifest_key(zip_bytes: bytes, public_key_b64: str) -> tuple[bytes, str]:
    """Return (new_zip_bytes, sha256_hex) with manifest.key set to public_key_b64.

    All other files are copied verbatim. The original developer upload is never
    mutated — this produces the separate validated artifact.
    """
    src = zipfile.ZipFile(io.BytesIO(zip_bytes))
    manifest_path = find_manifest_path(src)
    if manifest_path is None:
        raise ValueError("manifest.json not found while building artifact")

    out_buf = io.BytesIO()
    with zipfile.ZipFile(out_buf, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            if info.is_dir():
                continue
            data = src.read(info.filename)
            if info.filename == manifest_path:
                manifest = json.loads(data.decode("utf-8"))
                manifest["key"] = public_key_b64
                data = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
            # Normalize timestamps for reproducible artifacts.
            zi = zipfile.ZipInfo(filename=info.filename, date_time=(1980, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            dst.writestr(zi, data)

    artifact = out_buf.getvalue()
    return artifact, hashlib.sha256(artifact).hexdigest()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
