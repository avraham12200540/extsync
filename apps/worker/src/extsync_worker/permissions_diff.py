"""Permission diff + approval policy between releases (§15)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

SENSITIVE_PERMISSIONS = {
    "tabs", "webRequest", "webRequestBlocking", "cookies", "debugger", "proxy",
    "nativeMessaging", "management", "downloads", "history", "bookmarks",
    "clipboardRead", "scripting", "declarativeNetRequest", "browsingData",
    "privacy", "vpnProvider", "desktopCapture", "pageCapture",
}
BROAD_HOSTS = {"<all_urls>", "*://*/*", "http://*/*", "https://*/*", "http://*/", "https://*/"}


@dataclass
class PermissionDiff:
    added_permissions: list[str] = field(default_factory=list)
    removed_permissions: list[str] = field(default_factory=list)
    added_hosts: list[str] = field(default_factory=list)
    removed_hosts: list[str] = field(default_factory=list)
    added_native_messaging: bool = False
    added_all_urls: bool = False
    requires_user_approval: bool = False
    risk_level: str = "low"  # low | medium | high
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "addedPermissions": self.added_permissions,
            "removedPermissions": self.removed_permissions,
            "addedHosts": self.added_hosts,
            "removedHosts": self.removed_hosts,
            "addedNativeMessaging": self.added_native_messaging,
            "addedAllUrls": self.added_all_urls,
            "requiresUserApproval": self.requires_user_approval,
            "riskLevel": self.risk_level,
            "reasons": self.reasons,
        }


def diff_permissions(previous: dict | None, current: dict) -> PermissionDiff:
    """Compute the permission diff and the approval requirement.

    `previous`/`current` are PermissionSnapshot dicts (camelCase keys as produced
    by the validator). `previous` is None for the first release.
    """
    prev = previous or {}
    prev_perms = set(prev.get("permissions", []))
    cur_perms = set(current.get("permissions", []))
    prev_hosts = set(prev.get("hostPermissions", []))
    cur_hosts = set(current.get("hostPermissions", []))

    d = PermissionDiff()
    d.added_permissions = sorted(cur_perms - prev_perms)
    d.removed_permissions = sorted(prev_perms - cur_perms)
    d.added_hosts = sorted(cur_hosts - prev_hosts)
    d.removed_hosts = sorted(prev_hosts - cur_hosts)
    d.added_native_messaging = "nativeMessaging" in (cur_perms - prev_perms)
    d.added_all_urls = bool((cur_hosts - prev_hosts) & BROAD_HOSTS)

    # Approval policy (§15): additions of sensitive scope require user approval;
    # removals and code-only changes do not.
    added_sensitive = set(d.added_permissions) & SENSITIVE_PERMISSIONS
    if added_sensitive:
        d.requires_user_approval = True
        d.reasons.append("נוספו הרשאות רגישות: " + ", ".join(sorted(added_sensitive)))
    if d.added_all_urls:
        d.requires_user_approval = True
        d.reasons.append("נוספה גישה לכל האתרים")
    if d.added_native_messaging:
        d.requires_user_approval = True
        d.reasons.append("נוספה הרשאת nativeMessaging")

    if d.requires_user_approval:
        d.risk_level = "high" if (d.added_all_urls or d.added_native_messaging) else "medium"
    elif d.added_permissions or d.added_hosts:
        d.risk_level = "medium"
    else:
        d.risk_level = "low"
    return d


def permissions_changed(previous: dict | None, current: dict) -> bool:
    d = diff_permissions(previous, current)
    return bool(
        d.added_permissions or d.removed_permissions or d.added_hosts or d.removed_hosts
    )
