// Demo service worker (ES module) that integrates the ExtSync Bridge.
// IMPORTANT: replace PROJECT_ID with your real project id (ext_...) before
// publishing — the Agent routes reload messages by projectId.
import { initializeExtSync } from "./extsync-bridge.mjs";

const PROJECT_ID = "REPLACE_WITH_PROJECT_ID";

const bridge = initializeExtSync({ projectId: PROJECT_ID, channel: "stable" });

bridge.onAgentConnected(() => console.log("[hello-extsync] ExtSync Agent connected"));
bridge.onAgentDisconnected(() => console.log("[hello-extsync] Agent disconnected"));
bridge.onReloadRequested(() => console.log("[hello-extsync] reload requested by Agent"));
bridge.onUpdateCompleted((info) => console.log("[hello-extsync] updated", info));
bridge.onUpdateFailed((info) => console.warn("[hello-extsync] update failed", info));

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ installedAt: Date.now() });
});
