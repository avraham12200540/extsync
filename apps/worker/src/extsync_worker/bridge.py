"""Auto-inject the ExtSync update Bridge into uploaded extensions.

Developers upload an ordinary extension; the platform injects a tiny classic
service-worker script that connects to the Agent over Native Messaging and calls
`chrome.runtime.reload()` when the Agent signals an applied update. This makes
in-place auto-reload work without the developer writing any integration code.

Only MV3 is supported (validation already enforces MV3). The bridge never
downloads or runs remote code — it only talks to the local Agent.
"""
from __future__ import annotations

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

  function onMessage(m) {
    if (!m || m.protocolVersion !== PROTOCOL) return;
    if (m.projectId && m.projectId !== PROJECT_ID) return;
    if (m.type === "update.reload_ready") {
      var nonce = (m.payload || {}).nonce;
      if (!nonce) return;
      send("update.reload_ack", { nonce: nonce }, m.requestId);
      chrome.runtime.reload();
    }
  }

  function connect() {
    if (port) return;
    try { port = chrome.runtime.connectNative(HOST); }
    catch (e) { port = null; return; }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(function () {
      port = null;
      // One delayed retry while the worker is alive; avoids a tight loop if the
      // Agent/native host is not installed.
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


def render_bridge(project_id: str, channel: str) -> str:
    return (
        _BRIDGE_JS
        .replace("__EXTSYNC_PROJECT_ID__", project_id)
        .replace("__EXTSYNC_CHANNEL__", channel)
    )


def has_bridge_files(files: dict[str, bytes]) -> bool:
    """True if the extension already integrates an ExtSync bridge (respect it)."""
    for name in files:
        low = name.lower()
        if "extsync-bridge" in low or low.endswith("extsync_bridge.js"):
            return True
    return False


def inject_bridge(files: dict[str, bytes], manifest: dict, project_id: str, channel: str) -> bool:
    """Mutate ``files`` and ``manifest`` to wire in the bridge. Returns True if
    injection happened. ``files`` maps archive paths -> bytes (re-rooted)."""
    if manifest.get("manifest_version") != 3:
        return False

    bridge = render_bridge(project_id, channel).encode("utf-8")
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
    return True
