"""Authoritative extension ZIP validation (§8 step 3, §25).

`validate_extension_zip(data)` performs every check the spec requires, in a
defensive order: cheap structural/zip-bomb checks BEFORE any decompression of
file contents, so a malicious archive can never force us to extract gigabytes.

Pure function: no DB, no network, no filesystem writes. Fully unit-testable.
"""
from __future__ import annotations

import hashlib
import io
import json
import posixpath
import re
import stat
import zipfile
from dataclasses import dataclass

from .result import Finding, ManifestSummary, PermissionSnapshot, Severity, ValidationResult

# Text file extensions we statically analyze.
_TEXT_EXT = {".js", ".mjs", ".cjs", ".html", ".htm", ".css"}
# Outright-disallowed (binary / executable) extensions.
_BINARY_EXT = {
    ".exe", ".dll", ".msi", ".bat", ".cmd", ".com", ".scr", ".sh", ".ps1",
    ".jar", ".so", ".dylib", ".bin", ".app", ".deb", ".rpm", ".vbs", ".apk",
}
_MAX_SCAN_BYTES = 2 * 1024 * 1024  # don't scan files larger than 2MB
_LARGE_FILE_WARN = 16 * 1024 * 1024
_VERSION_RE = re.compile(r"^\d{1,9}(\.\d{1,9}){0,3}$")

# Static-analysis patterns.
_EVAL_RE = re.compile(r"\beval\s*\(")
_NEW_FUNCTION_RE = re.compile(r"\bnew\s+Function\s*\(")
_REMOTE_IMPORT_RE = re.compile(r"""importScripts\s*\(\s*['"]https?://""", re.IGNORECASE)
_REMOTE_SCRIPT_RE = re.compile(
    r"""<script[^>]+src\s*=\s*['"](?:https?:)?//""", re.IGNORECASE
)
# Fast threat heuristics (high-signal patterns common in malicious extensions).
# Encoded dynamic execution, e.g. eval(atob(...)) / Function(unescape(...)).
_ENCODED_EVAL_RE = re.compile(
    r"""(?:eval|Function)\s*\(\s*(?:atob|unescape|decodeURIComponent|String\.fromCharCode)\s*\(""",
    re.IGNORECASE,
)
# Fetch-then-eval the response (downloading and running code).
_FETCH_EVAL_RE = re.compile(r"""\.then\s*\(\s*[\w$]*\s*=>\s*eval\b""", re.IGNORECASE)
# Known crypto-miner libraries / keywords.
_MINER_RE = re.compile(
    r"\b(coinhive|cryptonight|webminerpool|deepminer|coinimp|minero|jsecoin|crypto-?loot)\b",
    re.IGNORECASE,
)
_DOC_WRITE_RE = re.compile(r"document\.write\s*\(")


@dataclass
class Limits:
    max_extracted_bytes: int = 209_715_200
    max_file_count: int = 5_000
    max_dir_depth: int = 20
    max_compression_ratio: int = 120  # per-file compressed->uncompressed ratio


def _is_unsafe_path(name: str) -> bool:
    if not name:
        return True
    if "\\" in name:  # backslashes not allowed (Windows path injection)
        return True
    if name.startswith("/") or re.match(r"^[A-Za-z]:", name):  # absolute path
        return True
    norm = posixpath.normpath(name)
    parts = norm.split("/")
    return ".." in parts or norm.startswith("../") or norm.startswith("/")


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0xFFFF
    return stat.S_ISLNK(mode)


def validate_extension_zip(data: bytes, limits: Limits | None = None) -> ValidationResult:
    limits = limits or Limits()
    result = ValidationResult()
    result.sha256 = hashlib.sha256(data).hexdigest()

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        result.add(Finding("INVALID_ARCHIVE", Severity.error, "הקובץ אינו ZIP תקין."))
        return result

    infos = [i for i in zf.infolist() if not i.is_dir()]
    result.file_count = len(infos)

    # ---- structural checks (no decompression of content yet) ----
    if result.file_count == 0:
        result.add(Finding("INVALID_ARCHIVE", Severity.error, "החבילה ריקה."))
        return result
    if result.file_count > limits.max_file_count:
        result.add(Finding("TOO_MANY_FILES", Severity.error,
                           f"החבילה מכילה יותר מדי קבצים ({result.file_count})."))

    total = 0
    names: set[str] = set()
    for info in infos:
        name = info.filename
        if _is_unsafe_path(name):
            result.add(Finding("PATH_TRAVERSAL", Severity.error,
                               "נמצא נתיב קובץ לא בטוח בחבילה.", file=name))
            continue
        if _is_symlink(info):
            result.add(Finding("SYMLINK", Severity.error,
                               "נמצא קישור סימבולי חשוד בחבילה.", file=name))
            continue
        if name.lower() in names:
            result.add(Finding("DUPLICATE_FILE", Severity.warning,
                               "קובץ כפול בחבילה.", file=name))
        names.add(name.lower())

        if name.count("/") > limits.max_dir_depth:
            result.add(Finding("DIR_TOO_DEEP", Severity.error,
                               "מבנה התיקיות עמוק מדי.", file=name))

        ext = posixpath.splitext(name)[1].lower()
        if ext in _BINARY_EXT:
            result.add(Finding("DISALLOWED_BINARY", Severity.error,
                               f"קובץ בינארי/הרצה אסור: {ext}", file=name))

        total += info.file_size
        # ZIP-bomb: extreme per-file ratio.
        if info.compress_size > 0 and info.file_size / info.compress_size > limits.max_compression_ratio \
                and info.file_size > 1_000_000:
            result.add(Finding("ZIP_BOMB", Severity.error,
                               "יחס דחיסה חריג — ייתכן ZIP bomb.", file=name,
                               detail={"ratio": round(info.file_size / max(info.compress_size, 1))}))
        if info.file_size > _LARGE_FILE_WARN:
            result.add(Finding("LARGE_FILE", Severity.warning,
                               "קובץ גדול באופן חריג.", file=name,
                               detail={"size": info.file_size}))
        result.file_inventory.append({"path": name, "size": info.file_size})

    result.total_uncompressed_size = total
    if total > limits.max_extracted_bytes:
        result.add(Finding("ZIP_BOMB", Severity.error,
                           "הגודל הכולל לאחר חילוץ חורג מהמותר.",
                           detail={"total": total, "limit": limits.max_extracted_bytes}))
        return result  # do not proceed to read contents

    # ---- manifest ----
    manifest_name = _find_manifest(zf)
    if manifest_name is None:
        result.add(Finding("INVALID_MANIFEST", Severity.error, "לא נמצא manifest.json."))
        return result
    try:
        manifest = json.loads(zf.read(manifest_name).decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        result.add(Finding("INVALID_MANIFEST", Severity.error, "ה-manifest.json אינו JSON תקין."))
        return result
    if not isinstance(manifest, dict):
        result.add(Finding("INVALID_MANIFEST", Severity.error, "מבנה ה-manifest שגוי."))
        return result

    prefix = manifest_name[: -len("manifest.json")]  # support nested root folder
    _validate_manifest(manifest, zf, prefix, result)

    # ---- static analysis ----
    _static_analysis(zf, infos, prefix, result)

    # ---- bridge detection ----
    result.has_bridge = _detect_bridge(infos, manifest)

    return result


def _find_manifest(zf: zipfile.ZipFile) -> str | None:
    candidates = [n for n in zf.namelist() if n.endswith("manifest.json")]
    if not candidates:
        return None
    # Prefer the shallowest (root or single wrapper folder).
    candidates.sort(key=lambda n: n.count("/"))
    top = candidates[0]
    # Reject if manifest is deeper than one wrapper directory.
    if top.count("/") > 1:
        return None
    return top


def _exists(zf: zipfile.ZipFile, prefix: str, rel: str) -> bool:
    rel = rel.lstrip("./")
    target = posixpath.normpath(prefix + rel)
    names = {posixpath.normpath(n) for n in zf.namelist()}
    return target in names


def _validate_manifest(manifest: dict, zf: zipfile.ZipFile, prefix: str,
                       result: ValidationResult) -> None:
    summary = result.manifest
    perms = result.permissions

    mv = manifest.get("manifest_version")
    summary.manifest_version = mv if isinstance(mv, int) else 0
    if mv != 3:
        result.add(Finding("MANIFEST_VERSION", Severity.error,
                           "נדרש manifest_version = 3 (Manifest V3)."))

    name = manifest.get("name")
    if not isinstance(name, str) or not name.strip():
        result.add(Finding("MANIFEST_NAME", Severity.error, "שדה name חסר או ריק ב-manifest."))
    else:
        summary.name = name.strip()

    version = manifest.get("version")
    if not isinstance(version, str) or not _VERSION_RE.match(version):
        result.add(Finding("MANIFEST_VERSION_FIELD", Severity.error,
                           "שדה version חסר או לא תקין (1-4 מספרים מופרדים בנקודה)."))
    else:
        summary.version = version

    summary.description = str(manifest.get("description", ""))[:280]
    summary.default_locale = manifest.get("default_locale")

    # icons
    icons = manifest.get("icons")
    if isinstance(icons, dict):
        summary.icons = {str(k): str(v) for k, v in icons.items()}
        for path in summary.icons.values():
            if not _exists(zf, prefix, path):
                result.add(Finding("ICON_MISSING", Severity.warning,
                                   "קובץ אייקון המוזכר ב-manifest חסר.", file=path))
    else:
        result.add(Finding("ICON_MISSING", Severity.warning, "לא הוגדרו אייקונים."))

    # background service worker
    bg = manifest.get("background", {})
    if isinstance(bg, dict) and bg.get("service_worker"):
        sw = str(bg["service_worker"])
        summary.service_worker = sw
        summary.service_worker_type = "module" if bg.get("type") == "module" else "classic"
        if not _exists(zf, prefix, sw):
            result.add(Finding("SERVICE_WORKER_MISSING", Severity.error,
                               "קובץ ה-service worker המוגדר אינו קיים בחבילה.", file=sw))

    # action / side panel
    summary.has_action = "action" in manifest
    summary.has_side_panel = "side_panel" in manifest
    if not summary.has_action and not summary.has_side_panel and summary.service_worker is None:
        result.add(Finding("NO_ENTRYPOINT", Severity.warning,
                           "לתוסף אין action, side_panel או service worker."))

    # content scripts
    cs = manifest.get("content_scripts", [])
    if isinstance(cs, list):
        for entry in cs:
            if not isinstance(entry, dict):
                continue
            matches = entry.get("matches", [])
            if isinstance(matches, list):
                perms.content_scripts_matches.extend(str(m) for m in matches)
            for key in ("js", "css"):
                for f in entry.get(key, []) or []:
                    if not _exists(zf, prefix, str(f)):
                        result.add(Finding("CONTENT_SCRIPT_MISSING", Severity.error,
                                           f"קובץ content script חסר: {f}", file=str(f)))

    # permissions
    perms.permissions = _str_list(manifest.get("permissions"))
    perms.optional_permissions = _str_list(manifest.get("optional_permissions"))
    perms.host_permissions = _str_list(manifest.get("host_permissions"))
    perms.optional_host_permissions = _str_list(manifest.get("optional_host_permissions"))
    perms.uses_native_messaging = "nativeMessaging" in perms.permissions
    ec = manifest.get("externally_connectable")
    perms.externally_connectable = ec if isinstance(ec, dict) else None
    war = manifest.get("web_accessible_resources", [])
    if isinstance(war, list):
        flat: list[str] = []
        for item in war:
            if isinstance(item, dict):
                flat.extend(str(r) for r in item.get("resources", []) or [])
            else:
                flat.append(str(item))
        perms.web_accessible_resources = flat


def _str_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value if isinstance(v, (str, int))]
    return []


def _static_analysis(zf: zipfile.ZipFile, infos: list[zipfile.ZipInfo], prefix: str,
                     result: ValidationResult) -> None:
    for info in infos:
        ext = posixpath.splitext(info.filename)[1].lower()
        if ext not in _TEXT_EXT or info.file_size > _MAX_SCAN_BYTES:
            continue
        try:
            text = zf.read(info.filename).decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            continue
        if _REMOTE_IMPORT_RE.search(text) or _REMOTE_SCRIPT_RE.search(text):
            result.add(Finding("REMOTE_CODE", Severity.error,
                               "התוסף מנסה לטעון קוד מכתובת חיצונית — אסור.", file=info.filename))
        # ---- fast threat heuristics ----
        if _ENCODED_EVAL_RE.search(text) or _FETCH_EVAL_RE.search(text):
            result.add(Finding("OBFUSCATED_EVAL", Severity.error,
                               "זוהתה הרצת קוד מוצפן/מפוענח דינמית (eval על atob/unescape או fetch) — "
                               "דפוס נפוץ בתוכנות זדוניות.", file=info.filename))
        if _MINER_RE.search(text):
            result.add(Finding("CRYPTO_MINER", Severity.error,
                               "זוהו דפוסי כריית-מטבעות (crypto miner) — אסור.", file=info.filename))
        if _EVAL_RE.search(text):
            result.add(Finding("EVAL_USAGE", Severity.warning,
                               "שימוש ב-eval() — מהווה סיכון אבטחה.", file=info.filename))
        if _NEW_FUNCTION_RE.search(text):
            result.add(Finding("NEW_FUNCTION", Severity.warning,
                               "שימוש ב-new Function() — מהווה סיכון אבטחה.", file=info.filename))
        if _DOC_WRITE_RE.search(text):
            result.add(Finding("DOC_WRITE", Severity.warning,
                               "שימוש ב-document.write() — מומלץ להימנע.", file=info.filename))
        longest_line = max((len(ln) for ln in text.splitlines()), default=0)
        if longest_line > 40_000 or (text.count("\\x") + text.count("\\u")) > 2_000:
            result.add(Finding("POSSIBLE_OBFUSCATION", Severity.warning,
                               "הקוד נראה מעורפל מאוד (obfuscated) — ודא שזה לגיטימי.", file=info.filename))


def _detect_bridge(infos: list[zipfile.ZipInfo], manifest: dict) -> bool:
    for info in infos:
        low = info.filename.lower()
        if "extsync-bridge" in low or low.endswith("extsync_bridge.js"):
            return True
    return False
