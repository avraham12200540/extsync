// ExtSync Bridge (ES module, standalone). Vendored for the demo extension.
// Mirrors packages/extension-bridge. Never downloads or runs remote code.
const EXTSYNC_PROTOCOL = 1;
const EXTSYNC_HOST = "com.extsync.agent";

function extsyncInit(opts) {
  const listeners = {};
  let port = null;
  let pendingNonce = null;

  const on = (ev, cb) => { (listeners[ev] = listeners[ev] || []).push(cb); };
  const emit = (ev, d) => { (listeners[ev] || []).forEach((cb) => { try { cb(d); } catch (e) {} }); };

  function send(type, payload, reqId) {
    if (!port) return;
    try {
      port.postMessage({
        protocolVersion: EXTSYNC_PROTOCOL,
        requestId: reqId || "req_" + Date.now(),
        timestamp: Date.now(),
        projectId: opts.projectId,
        extensionId: chrome.runtime.id,
        type,
        payload,
      });
    } catch (e) { disconnect(); }
  }

  function disconnect() {
    port = null;
    emit("agentDisconnected", { lastError: (chrome.runtime.lastError || {}).message });
  }

  function onMessage(m) {
    if (!m || typeof m !== "object" || m.protocolVersion !== EXTSYNC_PROTOCOL) return;
    if (m.projectId && m.projectId !== opts.projectId) return;
    if (m.type === "update.reload_ready") {
      const nonce = (m.payload || {}).nonce;
      if (!nonce) return;
      pendingNonce = nonce;
      emit("reloadRequested", { nonce });
      send("update.reload_ack", { nonce }, m.requestId);
      emit("updateCompleted", { version: (m.payload || {}).version });
      if (opts.autoReload !== false) chrome.runtime.reload();
    } else if (m.type === "update.failed") {
      emit("updateFailed", m.payload);
    } else if (m.type === "agent.status") {
      emit("agentConnected", m.payload);
    }
  }

  function connect() {
    try { port = chrome.runtime.connectNative(EXTSYNC_HOST); }
    catch (e) { disconnect(); return; }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(disconnect);
    emit("agentConnected");
    send("extension.register", {
      version: chrome.runtime.getManifest().version,
      channel: opts.channel,
    });
  }

  Promise.resolve().then(connect);

  return {
    onAgentConnected: (cb) => on("agentConnected", cb),
    onAgentDisconnected: (cb) => on("agentDisconnected", cb),
    onUpdatePrepared: (cb) => on("updatePrepared", cb),
    onReloadRequested: (cb) => on("reloadRequested", cb),
    onUpdateCompleted: (cb) => on("updateCompleted", cb),
    onUpdateFailed: (cb) => on("updateFailed", cb),
    reload: (n) => { if (!n || n === pendingNonce) chrome.runtime.reload(); },
    reportStatus: (s, d) =>
      send(s === "success" ? "update.success" : "update.failed",
        Object.assign({ version: chrome.runtime.getManifest().version }, d || {})),
  };
}

export const initializeExtSync = extsyncInit;
