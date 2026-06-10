"""Auto-inject the ExtSync update Bridge into uploaded extensions.

Developers upload an ordinary extension; the platform injects a tiny classic
service-worker script that connects to the Agent over Native Messaging and calls
`chrome.runtime.reload()` when the Agent signals an applied update. This makes
in-place auto-reload work without the developer writing any integration code.

For content-script extensions the new code only affects a tab after that tab
reloads (Chrome cannot hot-swap a script already running in a live page). So just
before reloading, the bridge injects an elegant "refresh to apply" toast into the
matching open tabs — one click reloads the page, with no risk of losing the user's
unsaved input. This needs the `scripting` permission, added only when the
extension actually has content scripts.

Only MV3 is supported (validation already enforces MV3). The bridge never
downloads or runs remote code — it only talks to the local Agent.
"""
from __future__ import annotations

import json
import posixpath

BRIDGE_FILENAME = "extsync-bridge.js"

# Classic service-worker script (no import/export) so it can be added either as a
# standalone service worker or loaded into an existing one via importScripts/import.
_BRIDGE_JS = r"""// ExtSync auto-injected update bridge — do not edit. https://extsync.com
// Connects to the local ExtSync Agent and reloads this extension in place when an
// update has been staged. No remote code is ever fetched or executed.
(function () {
  var PROTOCOL = 1;
  var HOST = "com.extsync.agent";
  var PROJECT_ID = "__EXTSYNC_PROJECT_ID__";
  var CHANNEL = "__EXTSYNC_CHANNEL__";
  var MATCHES = __EXTSYNC_MATCHES__;   // content-script match patterns ([] if none)
  var port = null;
  var retried = false;

  function send(type, payload, reqId) {
    if (!port) return;
    try {
      port.postMessage({
        protocolVersion: PROTOCOL,
        requestId: reqId || ("req_" + Date.now()),
        timestamp: Date.now(),
        projectId: PROJECT_ID,
        extensionId: chrome.runtime.id,
        type: type,
        payload: payload || {},
      });
    } catch (e) { port = null; }
  }

  // Injected into the page (MAIN world) so it survives the extension reload and
  // its click handler keeps working. Self-contained: uses only its argument + DOM.
  function extsyncToast(version) {
    try {
      if (document.getElementById("__extsync_toast")) return;
      var wrap = document.createElement("div");
      wrap.id = "__extsync_toast";
      wrap.dir = "rtl";
      wrap.style.cssText = "position:fixed;bottom:24px;inset-inline-start:24px;z-index:2147483647;" +
        "font-family:'Segoe UI',system-ui,sans-serif;";
      var card = document.createElement("div");
      card.style.cssText = "display:flex;align-items:center;gap:12px;background:#111827;color:#fff;" +
        "padding:12px 16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.28);max-width:340px;" +
        "transform:translateY(16px);opacity:0;transition:transform .25s ease,opacity .25s ease;";
      var dot = document.createElement("span");
      dot.style.cssText = "width:8px;height:8px;border-radius:50%;background:#34d399;flex:none;";
      var txt = document.createElement("div");
      txt.style.cssText = "font-size:13px;line-height:1.45;flex:1;";
      txt.textContent = (version ? ("גרסה " + version + " של התוסף הותקנה.") :
        "גרסה חדשה של התוסף הותקנה.") + " רענן כדי להחיל בדף.";
      var btn = document.createElement("button");
      btn.textContent = "רענן עכשיו";
      btn.style.cssText = "background:#3b82f6;color:#fff;border:0;border-radius:8px;padding:7px 12px;" +
        "font-size:13px;font-weight:600;cursor:pointer;flex:none;";
      btn.onclick = function () { location.reload(); };
      var x = document.createElement("button");
      x.textContent = "✕";
      x.setAttribute("aria-label", "סגור");
      x.style.cssText = "background:transparent;color:#9ca3af;border:0;font-size:14px;cursor:pointer;flex:none;";
      x.onclick = function () { wrap.remove(); };
      card.appendChild(dot); card.appendChild(txt); card.appendChild(btn); card.appendChild(x);
      wrap.appendChild(card);
      (document.body || document.documentElement).appendChild(wrap);
      requestAnimationFrame(function () { card.style.transform = "translateY(0)"; card.style.opacity = "1"; });
    } catch (e) { /* never break the page */ }
  }

  // Show the "refresh to apply" toast in every matching open tab, then resolve.
  function showRefreshToasts(version) {
    return new Promise(function (resolve) {
      try {
        if (!MATCHES.length || !chrome.scripting || !chrome.tabs) { resolve(); return; }
        chrome.tabs.query({ url: MATCHES }, function (tabs) {
          var list = (tabs || []).filter(function (t) { return t.id != null; });
          if (!list.length) { resolve(); return; }
          var left = list.length;
          var done = function () { if (--left <= 0) resolve(); };
          list.forEach(function (t) {
            try {
              chrome.scripting.executeScript({
                target: { tabId: t.id }, world: "MAIN", func: extsyncToast, args: [version || ""],
              }, function () { void chrome.runtime.lastError; done(); });
            } catch (e) { done(); }
          });
        });
      } catch (e) { resolve(); }
    });
  }

  function onMessage(m) {
    if (!m || m.protocolVersion !== PROTOCOL) return;
    if (m.projectId && m.projectId !== PROJECT_ID) return;
    if (m.type === "update.reload_ready") {
      var nonce = (m.payload || {}).nonce;
      if (!nonce) return;
      send("update.reload_ack", { nonce: nonce }, m.requestId);
      var go = function () { chrome.runtime.reload(); };
      // Prompt open tabs to refresh first, then reload the extension itself.
      showRefreshToasts((m.payload || {}).version).then(go, go);
    }
  }

  function connect() {
    if (port) return;
    try { port = chrome.runtime.connectNative(HOST); }
    catch (e) { port = null; return; }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(function () {
      port = null;
      if (!retried) { retried = true; setTimeout(connect, 5000); }
    });
    send("extension.register", {
      version: chrome.runtime.getManifest().version,
      channel: CHANNEL,
    });
  }

  try { if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(connect); } catch (e) {}
  try { connect(); } catch (e) {}
})();
"""


def render_bridge(project_id: str, channel: str, matches: list[str]) -> str:
    return (
        _BRIDGE_JS
        .replace("__EXTSYNC_PROJECT_ID__", project_id)
        .replace("__EXTSYNC_CHANNEL__", channel)
        .replace("__EXTSYNC_MATCHES__", json.dumps(matches))
    )


def has_bridge_files(files: dict[str, bytes]) -> bool:
    """True if the extension already integrates an ExtSync bridge (respect it)."""
    for name in files:
        low = name.lower()
        if "extsync-bridge" in low or low.endswith("extsync_bridge.js"):
            return True
    return False


def _content_script_matches(manifest: dict) -> list[str]:
    matches: list[str] = []
    for cs in manifest.get("content_scripts") or []:
        for m in cs.get("matches") or []:
            if m not in matches:
                matches.append(m)
    return matches


def inject_bridge(files: dict[str, bytes], manifest: dict, project_id: str, channel: str) -> bool:
    """Mutate ``files`` and ``manifest`` to wire in the bridge. Returns True if
    injection happened. ``files`` maps archive paths -> bytes (re-rooted)."""
    if manifest.get("manifest_version") != 3:
        return False

    matches = _content_script_matches(manifest)
    bridge = render_bridge(project_id, channel, matches).encode("utf-8")
    bg = manifest.get("background")
    sw = bg.get("service_worker") if isinstance(bg, dict) else None

    if sw:
        # Load the bridge first from inside the developer's existing service worker.
        sw_dir = posixpath.dirname(sw)
        bridge_path = posixpath.join(sw_dir, BRIDGE_FILENAME) if sw_dir else BRIDGE_FILENAME
        files[bridge_path] = bridge
        existing = files.get(sw, b"").decode("utf-8", "replace")
        if BRIDGE_FILENAME not in existing:
            if isinstance(bg, dict) and bg.get("type") == "module":
                loader = 'import "./%s";\n' % BRIDGE_FILENAME
            else:
                loader = 'try{importScripts("%s");}catch(e){}\n' % BRIDGE_FILENAME
            files[sw] = (loader + existing).encode("utf-8")
    else:
        # No background script — the bridge becomes the service worker.
        files[BRIDGE_FILENAME] = bridge
        manifest["background"] = {"service_worker": BRIDGE_FILENAME}

    perms = manifest.setdefault("permissions", [])
    if "nativeMessaging" not in perms:
        perms.append("nativeMessaging")
    # The refresh toast is injected via chrome.scripting into matching tabs.
    if matches and "scripting" not in perms:
        perms.append("scripting")
    return True
