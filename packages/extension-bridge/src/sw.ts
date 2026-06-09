/**
 * ExtSync Bridge — classic service worker entry (for a non-module service worker).
 * Load it FIRST in your classic SW via importScripts, then call the global:
 *
 *   importScripts("extsync-bridge.sw.js");
 *   const bridge = self.initializeExtSync({ projectId: "ext_123", channel: "stable" });
 *
 * This file is bundled to a single classic script (no import/export) by the build.
 */
import { initializeExtSync, type ExtSyncHandle } from "./index.js";
import type { ExtSyncOptions } from "./core.js";

declare const self: {
  initializeExtSync?: (opts: ExtSyncOptions) => ExtSyncHandle;
};

// Expose the initializer on the global scope for classic service workers.
self.initializeExtSync = initializeExtSync;

export {};
