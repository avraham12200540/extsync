"""Data structures for the extension validation report (§8 step 4, §25)."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class Severity(StrEnum):
    error = "error"
    warning = "warning"
    info = "info"


@dataclass
class Finding:
    code: str
    severity: Severity
    message: str  # Hebrew, user-facing
    file: str | None = None
    detail: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity.value,
            "message": self.message,
            "file": self.file,
            "detail": self.detail or {},
        }


@dataclass
class ManifestSummary:
    name: str = ""
    version: str = ""
    manifest_version: int = 0
    description: str = ""
    service_worker: str | None = None
    service_worker_type: str = "classic"  # classic | module
    default_locale: str | None = None
    has_action: bool = False
    has_side_panel: bool = False
    icons: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "manifestVersion": self.manifest_version,
            "description": self.description,
            "serviceWorker": self.service_worker,
            "serviceWorkerType": self.service_worker_type,
            "defaultLocale": self.default_locale,
            "hasAction": self.has_action,
            "hasSidePanel": self.has_side_panel,
            "icons": self.icons,
        }


@dataclass
class PermissionSnapshot:
    permissions: list[str] = field(default_factory=list)
    optional_permissions: list[str] = field(default_factory=list)
    host_permissions: list[str] = field(default_factory=list)
    optional_host_permissions: list[str] = field(default_factory=list)
    content_scripts_matches: list[str] = field(default_factory=list)
    externally_connectable: dict[str, Any] | None = None
    uses_native_messaging: bool = False
    web_accessible_resources: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "permissions": self.permissions,
            "optionalPermissions": self.optional_permissions,
            "hostPermissions": self.host_permissions,
            "optionalHostPermissions": self.optional_host_permissions,
            "contentScriptsMatches": self.content_scripts_matches,
            "externallyConnectable": self.externally_connectable,
            "usesNativeMessaging": self.uses_native_messaging,
            "webAccessibleResources": self.web_accessible_resources,
        }


@dataclass
class ValidationResult:
    findings: list[Finding] = field(default_factory=list)
    manifest: ManifestSummary = field(default_factory=ManifestSummary)
    permissions: PermissionSnapshot = field(default_factory=PermissionSnapshot)
    file_inventory: list[dict[str, Any]] = field(default_factory=list)
    total_uncompressed_size: int = 0
    file_count: int = 0
    sha256: str = ""
    has_bridge: bool = False

    def add(self, finding: Finding) -> None:
        self.findings.append(finding)

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == Severity.error]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == Severity.warning]

    @property
    def ok(self) -> bool:
        return len(self.errors) == 0

    @property
    def risk_score(self) -> int:
        """0..100 risk score from findings + sensitive permissions."""
        score = 0
        score += 35 * len(self.errors)
        score += 8 * len(self.warnings)
        sensitive = {
            "<all_urls>", "tabs", "webRequest", "webRequestBlocking", "cookies",
            "debugger", "proxy", "nativeMessaging", "management", "downloads",
            "history", "bookmarks", "clipboardRead", "scripting",
        }
        perms = set(self.permissions.permissions)
        score += 6 * len(perms & sensitive)
        if any(h in ("<all_urls>", "*://*/*", "http://*/*", "https://*/*")
               for h in self.permissions.host_permissions):
            score += 20
        if self.permissions.uses_native_messaging:
            score += 10
        return min(score, 100)

    def to_report(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "manifest": self.manifest.to_dict(),
            "permissions": self.permissions.to_dict(),
            "errors": [f.to_dict() for f in self.errors],
            "warnings": [f.to_dict() for f in self.warnings],
            "findings": [f.to_dict() for f in self.findings],
            "fileCount": self.file_count,
            "totalUncompressedSize": self.total_uncompressed_size,
            "sha256": self.sha256,
            "hasBridge": self.has_bridge,
            "riskScore": self.risk_score,
        }
