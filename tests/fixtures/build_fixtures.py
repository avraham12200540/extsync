#!/usr/bin/env python3
"""Generate icons for the example extensions and pack them into ZIPs.

Outputs tests/fixtures/dist/<name>.zip and prints each SHA-256. These ZIPs can be
uploaded via the dashboard or `extsync upload` to drive the end-to-end flow.

Run:  python tests/fixtures/build_fixtures.py
"""
from __future__ import annotations

import hashlib
import struct
import zlib
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "extensions"
DIST = HERE / "dist"


def make_png(size: int, rgb: tuple[int, int, int]) -> bytes:
    """Build a minimal solid-color RGBA PNG (no external deps)."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    r, g, b = rgb
    raw = bytearray()
    row = bytes([r, g, b, 255]) * size
    for _ in range(size):
        raw.append(0)          # filter type 0
        raw.extend(row)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    return png


def ensure_icons(ext_dir: Path) -> None:
    icons = ext_dir / "icons"
    icons.mkdir(exist_ok=True)
    color = (37, 99, 235)  # ExtSync brand blue
    for s in (16, 48, 128):
        (icons / f"icon{s}.png").write_bytes(make_png(s, color))


def pack(ext_dir: Path) -> Path:
    DIST.mkdir(exist_ok=True)
    out = DIST / f"{ext_dir.name}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(ext_dir.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(ext_dir).as_posix())
    return out


def main() -> int:
    if not SRC.exists():
        print(f"no extensions dir at {SRC}")
        return 1
    for ext_dir in sorted(p for p in SRC.iterdir() if p.is_dir()):
        ensure_icons(ext_dir)
        out = pack(ext_dir)
        sha = hashlib.sha256(out.read_bytes()).hexdigest()
        print(f"  {ext_dir.name:20s} -> {out.relative_to(HERE.parent.parent)}  sha256={sha[:16]}…")
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
