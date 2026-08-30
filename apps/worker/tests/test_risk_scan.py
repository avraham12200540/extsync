"""The bypass scanner: does it catch what it claims, and does it stay quiet?

Both halves matter. A scanner that misses real proxy code is useless, and one
that fires on ordinary JavaScript gets ignored - and an ignored scanner is worse
than no scanner, because it looks like coverage.
"""
from __future__ import annotations

import pytest

from extsync_worker.validation.risk_scan import (
    CRITICAL,
    HIGH,
    INFO,
    MEDIUM,
    RiskScan,
    scan_manifest,
    scan_text,
)
from extsync_worker.validation.result import PermissionSnapshot


def codes(signals) -> set[str]:
    return {s.code for s in signals}


def levels(signals) -> dict[str, str]:
    return {s.code: s.level for s in signals}


# --------------------------------------------------------------- true positives

@pytest.mark.parametrize("code,snippet", [
    ("CODE_PROXY_API", "chrome.proxy.settings.set({value: cfg, scope: 'regular'});"),
    ("CODE_PROXY_API", "await browser.proxy.settings.get({});"),
    ("CODE_PAC_SCRIPT", "function FindProxyForURL(url, host) { return 'SOCKS5 1.2.3.4:1080'; }"),
    ("CODE_PAC_SCRIPT", "const cfg = {mode: 'pac_script', pacScript: {data: src}};"),
    ("CODE_PROXY_MODE", "const cfg = {mode: 'fixed_servers', rules: r};"),
    ("CODE_SOCKS", "const url = 'socks5://198.51.100.7:1080';"),
    ("CODE_VPN_PROTOCOL", "import { connect } from './shadowsocks-client.js';"),
    ("CODE_VPN_PROTOCOL", "const backend = 'wireguard';"),
    ("CODE_TUNNEL_URI", "const sub = 'vmess://eyJhZGQiOiJleGFtcGxlIn0=';"),
    ("CODE_DOH", "fetch('https://cloudflare-dns.com/dns-query?name=' + host);"),
    ("CODE_DNR_DYNAMIC", "chrome.declarativeNetRequest.updateDynamicRules({addRules: rules});"),
    ("CODE_WEBREQUEST_REDIRECT", "return {redirectUrl: target};"),
    ("CODE_NATIVE_MESSAGING", "const port = chrome.runtime.connectNative('com.example.helper');"),
])
def test_catches_real_bypass_code(code, snippet):
    assert code in codes(scan_text("bg.js", snippet)), snippet


def test_proxy_api_is_critical():
    """The strongest signals must be ranked so a reviewer sees them first."""
    sig = levels(scan_text("bg.js", "chrome.proxy.settings.set({});"))
    assert sig["CODE_PROXY_API"] == CRITICAL


def test_webrtc_datachannel_pair_is_detected():
    text = """
      const pc = new RTCPeerConnection(config);
      pc.onicecandidate = handle;
      const chan = pc.createDataChannel('tunnel');
    """
    assert "CODE_WEBRTC_DATACHANNEL" in codes(scan_text("rtc.js", text))


def test_evidence_shows_the_actual_match():
    """A signal without context makes the reviewer go hunting."""
    sig = scan_text("bg.js", "const a = 1;\nchrome.proxy.settings.set({value: v});\nconst b = 2;")
    ev = next(s.evidence for s in sig if s.code == "CODE_PROXY_API")
    assert "chrome.proxy" in ev
    assert "\n" not in ev  # collapsed to one readable line


# -------------------------------------------------------------- false positives

@pytest.mark.parametrize("snippet", [
    # `Proxy` is a JS builtin and extremely common.
    "const store = new Proxy(target, handler);",
    # `.filter(` is one of the most-used calls in JavaScript.
    "const open = items.filter((i) => !i.done).map((i) => i.id);",
    # Ordinary DOM and fetch work.
    "const res = await fetch('/api/items'); const data = await res.json();",
    "document.querySelectorAll('.row').forEach((el) => el.classList.add('on'));",
    # A word that merely contains a protocol name.
    "const label = 'Progress: crossing the finish line';",
])
def test_stays_quiet_on_ordinary_javascript(snippet):
    assert scan_text("app.js", snippet) == [], snippet


def test_bypass_terminology_is_only_informational():
    """These words appear in legitimate UI copy, so they must not outrank real
    capability signals - they are evidence for a human, not an accusation."""
    sig = levels(scan_text("ui.js", "const msg = 'unblock this site';"))
    assert sig["CODE_BYPASS_TERMS"] == INFO


# ----------------------------------------------------------------------- manifest

def test_proxy_permission_is_critical():
    perms = PermissionSnapshot(permissions=["proxy", "storage"])
    sig = levels(scan_manifest(perms, {}))
    assert sig["PERM_PROXY"] == CRITICAL
    assert "PERM_STORAGE" not in sig  # ordinary permissions are not signals


def test_all_urls_host_permission_is_flagged():
    perms = PermissionSnapshot(host_permissions=["<all_urls>"])
    assert "HOST_ALL_URLS" in codes(scan_manifest(perms, {}))


def test_optional_permissions_are_still_reported():
    """Requesting at runtime is quieter for the user, not less interesting."""
    perms = PermissionSnapshot(permissions=[], optional_permissions=["proxy"])
    sig = next(s for s in scan_manifest(perms, {}) if s.code == "PERM_PROXY")
    assert sig.level == CRITICAL
    assert "אופציונלית" in sig.title


def test_wildcard_externally_connectable_is_flagged():
    perms = PermissionSnapshot(externally_connectable={"matches": ["*://*.example.com/*"]})
    assert "EXTERNALLY_CONNECTABLE_WILDCARD" in codes(scan_manifest(perms, {}))


def test_specific_externally_connectable_is_not_flagged():
    perms = PermissionSnapshot(externally_connectable={"matches": ["https://app.example.com/"]})
    assert "EXTERNALLY_CONNECTABLE_WILDCARD" not in codes(scan_manifest(perms, {}))


def test_static_dnr_rules_are_flagged_with_their_paths():
    manifest = {"declarative_net_request": {"rule_resources": [{"path": "rules/block.json"}]}}
    sig = next(s for s in scan_manifest(PermissionSnapshot(), manifest)
               if s.code == "DNR_STATIC_RULES")
    assert "rules/block.json" in (sig.evidence or "")


def test_benign_manifest_produces_nothing():
    perms = PermissionSnapshot(permissions=["storage", "alarms"],
                               host_permissions=["https://example.com/*"])
    assert scan_manifest(perms, {}) == []


# ------------------------------------------------------------------------ summary

def test_top_level_reports_the_strongest_finding():
    scan = RiskScan()
    scan.add_all(scan_text("a.js", "items.filter(Boolean)"))          # nothing
    scan.add_all(scan_manifest(PermissionSnapshot(permissions=["webRequest"]), {}))
    assert scan.to_dict()["topLevel"] == MEDIUM
    scan.add_all(scan_text("b.js", "chrome.proxy.settings.set({})"))
    assert scan.to_dict()["topLevel"] == CRITICAL


def test_empty_scan_reports_none_not_safe():
    """Silence means 'nothing matched', never 'approved'."""
    assert RiskScan().to_dict()["topLevel"] == "none"


def test_signals_are_sorted_strongest_first():
    scan = RiskScan()
    scan.add_all(scan_text("ui.js", "const m = 'unblock';"))            # info
    scan.add_all(scan_text("bg.js", "chrome.proxy.settings.set({})"))   # critical
    scan.add_all(scan_manifest(PermissionSnapshot(host_permissions=["<all_urls>"]), {}))  # high
    got = [s.level for s in scan.sorted_signals]
    assert got == [CRITICAL, HIGH, INFO]


def test_counts_survive_the_signal_cap():
    """The stored report caps signals, but the counts must stay truthful."""
    scan = RiskScan()
    for i in range(300):
        scan.add_all(scan_text(f"f{i}.js", "chrome.proxy.settings.set({})"))
    d = scan.to_dict()
    assert len(d["signals"]) == 200
    assert d["total"] == 300
    assert d["counts"][CRITICAL] == 300


# ------------------------------------------------------------------- end to end

def _zip(manifest: dict, files: dict[str, str]) -> bytes:
    import io
    import json
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        for name, body in files.items():
            zf.writestr(name, body)
    return buf.getvalue()


def test_signals_reach_the_stored_report_without_rejecting_the_build():
    """The wiring, not the patterns: a proxy extension must surface signals in
    the report AND still validate. If the scan ever starts rejecting builds it
    has stopped being advisory, which is the one thing it must not do."""
    from extsync_worker.validation.validator import Limits, validate_extension_zip

    manifest = {
        "manifest_version": 3,
        "name": "Test Proxy Helper",
        "version": "1.0.0",
        "description": "test",
        "permissions": ["proxy", "storage", "declarativeNetRequest"],
        "host_permissions": ["<all_urls>"],
        "background": {"service_worker": "bg.js"},
    }
    bg = (
        "const cfg = {mode: 'fixed_servers', rules: {}};\n"
        "chrome.proxy.settings.set({value: cfg, scope: 'regular'});\n"
        "const items = [1,2,3].filter(Boolean);\n"
    )
    report = validate_extension_zip(_zip(manifest, {"bg.js": bg}), Limits()).to_report()

    scan = report["riskScan"]
    assert scan["topLevel"] == CRITICAL
    assert {"PERM_PROXY", "HOST_ALL_URLS", "CODE_PROXY_API", "CODE_PROXY_MODE"} <= {
        s["code"] for s in scan["signals"]
    }
    assert report["ok"] is True, "the bypass scan must never reject a build"


def test_benign_extension_produces_an_empty_scan():
    from extsync_worker.validation.validator import Limits, validate_extension_zip

    manifest = {
        "manifest_version": 3,
        "name": "Notes",
        "version": "1.0.0",
        "description": "test",
        "permissions": ["storage"],
        "background": {"service_worker": "bg.js"},
    }
    bg = "chrome.storage.local.get(['notes'], (r) => render(r.notes || []));\n"
    report = validate_extension_zip(_zip(manifest, {"bg.js": bg}), Limits()).to_report()

    assert report["riskScan"]["topLevel"] == "none"
    assert report["riskScan"]["total"] == 0


# ------------------------------------------------- the platform's own bridge

# ExtSync injects this into every extension it packages. Reporting it would mean
# flagging ~100% of the store: measured over all 46 live releases, 45 came out
# `high` on this alone before the exemption existed.
_BRIDGE = """
  var HOST = "com.extsync.agent";
  function connect() { port = chrome.runtime.connectNative(HOST); }
"""


def test_extsync_bridge_alone_is_not_a_signal():
    assert scan_text("bridge.js", _BRIDGE) == []


def test_native_messaging_to_another_host_is_still_reported():
    text = _BRIDGE + "\nchrome.runtime.connectNative('com.vendor.helper');\n"
    sig = next(s for s in scan_text("bg.js", text) if s.code == "CODE_NATIVE_MESSAGING")
    assert sig.level == HIGH
    assert "com.vendor.helper" in (sig.evidence or "")
    # The bridge host must not be presented as a finding alongside it.
    assert "com.extsync.agent" not in (sig.evidence or "")


def test_native_messaging_with_no_host_literal_is_medium():
    """The target is decided elsewhere or at runtime: worth a look, not damning."""
    sig = scan_text("bg.js", "const p = chrome.runtime.connectNative(cfg.host);")
    codes_found = {s.code: s.level for s in sig}
    assert codes_found["CODE_NATIVE_MESSAGING_DYNAMIC"] == MEDIUM


def test_bridge_injection_suppresses_the_native_messaging_permission():
    perms = PermissionSnapshot(permissions=["nativeMessaging", "storage"])
    assert "PERM_NATIVEMESSAGING" not in codes(
        scan_manifest(perms, {}, bridge_injected=True)
    )


def test_developer_requested_native_messaging_is_still_reported():
    perms = PermissionSnapshot(permissions=["nativeMessaging", "storage"])
    sig = next(s for s in scan_manifest(perms, {}, bridge_injected=False)
               if s.code == "PERM_NATIVEMESSAGING")
    assert sig.level == HIGH


def test_a_typical_extsync_extension_scans_clean():
    """The realistic baseline: bridge + a narrow host permission. If this ever
    starts producing signals, the queue fills with noise and stops being read."""
    from extsync_worker.validation.validator import Limits, validate_extension_zip

    manifest = {
        "manifest_version": 3,
        "name": "Helper",
        "version": "1.0.0",
        "description": "test",
        "permissions": ["storage", "nativeMessaging"],
        "host_permissions": ["https://example.com/*"],
        "background": {"service_worker": "bg.js"},
    }
    report = validate_extension_zip(
        _zip(manifest, {"bg.js": _BRIDGE, "extsync-bridge.js": _BRIDGE}), Limits(),
    ).to_report()
    assert report["riskScan"]["topLevel"] == "none", report["riskScan"]["signals"]
