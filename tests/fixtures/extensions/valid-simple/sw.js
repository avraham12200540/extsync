// Minimal classic service worker (no ExtSync Bridge). Updates will require a
// manual reload / Chrome restart since there is no Bridge to call reload().
chrome.runtime.onInstalled.addListener(() => {
  console.log("Simple Valid Extension installed", chrome.runtime.getManifest().version);
});
