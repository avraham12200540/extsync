/**
 * ExtSync Bridge — ES Module entry (for `"background": { "service_worker": "...",
 * "type": "module" }`). Import and initialize once in your service worker:
 *
 *   import { initializeExtSync } from "extsync-bridge";
 *   const bridge = initializeExtSync({ projectId: "ext_123", channel: "stable" });
 *   bridge.onUpdateCompleted(() => console.log("updated"));
 */
import { ExtSyncBridge, type ExtSyncOptions } from "./core.js";

export { ExtSyncBridge } from "./core.js";
export type { ExtSyncOptions, ChromeLike, NativePort, BridgeEvent } from "./core.js";
export { PROTOCOL_VERSION, NATIVE_HOST_NAME } from "./protocol.js";

export interface ExtSyncHandle {
  bridge: ExtSyncBridge;
  onAgentConnected(cb: () => void): void;
  onAgentDisconnected(cb: (info?: unknown) => void): void;
  onUpdatePrepared(cb: (info?: unknown) => void): void;
  onReloadRequested(cb: (info?: unknown) => void): void;
  onUpdateCompleted(cb: (info?: unknown) => void): void;
  onUpdateFailed(cb: (info?: unknown) => void): void;
  reload(): void;
  reportStatus(status: "success" | "failed", detail?: Record<string, unknown>): void;
}

export function initializeExtSync(options: ExtSyncOptions): ExtSyncHandle {
  const bridge = new ExtSyncBridge(options);
  // Connect on the next tick so listeners attached synchronously still fire.
  Promise.resolve().then(() => bridge.connect());
  return {
    bridge,
    onAgentConnected: (cb) => bridge.on("agentConnected", () => cb()),
    onAgentDisconnected: (cb) => bridge.on("agentDisconnected", cb),
    onUpdatePrepared: (cb) => bridge.on("updatePrepared", cb),
    onReloadRequested: (cb) => bridge.on("reloadRequested", cb),
    onUpdateCompleted: (cb) => bridge.on("updateCompleted", cb),
    onUpdateFailed: (cb) => bridge.on("updateFailed", cb),
    reload: () => bridge.reload(),
    reportStatus: (status, detail) => bridge.reportStatus(status, detail),
  };
}
