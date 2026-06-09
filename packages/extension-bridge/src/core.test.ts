import { test } from "node:test";
import assert from "node:assert/strict";
import { ExtSyncBridge, type ChromeLike, type NativePort } from "./core.ts";
import { PROTOCOL_VERSION } from "./protocol.ts";

class FakePort implements NativePort {
  sent: any[] = [];
  private msgCb: ((m: unknown) => void) | null = null;
  private discCb: (() => void) | null = null;
  postMessage(m: unknown) {
    this.sent.push(m);
  }
  disconnect() {
    this.discCb?.();
  }
  onMessage = { addListener: (cb: (m: unknown) => void) => (this.msgCb = cb) };
  onDisconnect = { addListener: (cb: () => void) => (this.discCb = cb) };
  deliver(m: unknown) {
    this.msgCb?.(m);
  }
  fireDisconnect() {
    this.discCb?.();
  }
}

function makeChrome(opts: { failConnect?: boolean } = {}): { chrome: ChromeLike; port: FakePort; reloaded: () => number } {
  const port = new FakePort();
  let reloads = 0;
  const chrome: ChromeLike = {
    runtime: {
      id: "abcdefghijklmnopabcdefghijklmnop",
      lastError: undefined,
      connectNative: () => {
        if (opts.failConnect) throw new Error("not installed");
        return port;
      },
      getManifest: () => ({ version: "1.2.3" }),
      reload: () => {
        reloads++;
      },
    },
  };
  return { chrome, port, reloaded: () => reloads };
}

function reloadReady(nonce: string, projectId = "ext_1") {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: "req_x",
    timestamp: Date.now(),
    projectId,
    extensionId: "abcdefghijklmnopabcdefghijklmnop",
    type: "update.reload_ready",
    payload: { nonce, version: "2.0.0" },
  };
}

test("connect sends extension.register with version + channel", () => {
  const { chrome, port } = makeChrome();
  const b = new ExtSyncBridge({ projectId: "ext_1", channel: "stable", chrome });
  const events: string[] = [];
  b.on("agentConnected", () => events.push("connected"));
  b.connect();
  assert.ok(b.isConnected);
  assert.equal(port.sent.length, 1);
  assert.equal(port.sent[0].type, "extension.register");
  assert.equal(port.sent[0].payload.version, "1.2.3");
  assert.equal(port.sent[0].payload.channel, "stable");
  assert.deepEqual(events, ["connected"]);
});

test("reload_ready triggers ack + reload + events (verified nonce)", () => {
  const { chrome, port, reloaded } = makeChrome();
  const b = new ExtSyncBridge({ projectId: "ext_1", channel: "stable", chrome });
  const seen: string[] = [];
  b.on("reloadRequested", () => seen.push("reloadRequested"));
  b.on("updateCompleted", () => seen.push("updateCompleted"));
  b.connect();
  port.deliver(reloadReady("nonce-123"));
  const ack = port.sent.find((m) => m.type === "update.reload_ack");
  assert.ok(ack, "should send reload_ack");
  assert.equal(ack.payload.nonce, "nonce-123");
  assert.equal(reloaded(), 1, "should call chrome.runtime.reload once");
  assert.deepEqual(seen, ["reloadRequested", "updateCompleted"]);
});

test("does not auto-reload when autoReload is false", () => {
  const { chrome, port, reloaded } = makeChrome();
  const b = new ExtSyncBridge({ projectId: "ext_1", channel: "stable", chrome, autoReload: false });
  b.connect();
  port.deliver(reloadReady("n1"));
  assert.equal(reloaded(), 0);
  b.reload("n1"); // manual
  assert.equal(reloaded(), 1);
});

test("reload refuses mismatched nonce", () => {
  const { chrome, port, reloaded } = makeChrome();
  const b = new ExtSyncBridge({ projectId: "ext_1", channel: "stable", chrome, autoReload: false });
  b.connect();
  port.deliver(reloadReady("real"));
  b.reload("forged");
  assert.equal(reloaded(), 0, "must not reload on wrong nonce");
});

test("ignores reload_ready without a nonce", () => {
  const { chrome, port, reloaded } = makeChrome();
  const b = new ExtSyncBridge({ projectId: "ext_1", channel: "stable", chrome });
  b.connect();
  const msg = reloadReady("");
  port.deliver(msg);
  assert.equal(reloaded(), 0);
});

test("ignores messages for a different project", () => {
  const { chrome, port, reloaded } = makeChrome();
  const b = new ExtSyncBridge({ projectId: "ext_1", channel: "stable", chrome });
  b.connect();
  port.deliver(reloadReady("n", "ext_OTHER"));
  assert.equal(reloaded(), 0);
});

test("ignores malformed messages", () => {
  const { chrome, port, reloaded } = makeChrome();
  const b = new ExtSyncBridge({ projectId: "ext_1", channel: "stable", chrome });
  b.connect();
  port.deliver({ garbage: true });
  port.deliver(null);
  assert.equal(reloaded(), 0);
});

test("connect failure (agent not installed) does not throw, emits disconnected", () => {
  const { chrome } = makeChrome({ failConnect: true });
  const b = new ExtSyncBridge({ projectId: "ext_1", channel: "stable", chrome });
  let disconnected = false;
  b.on("agentDisconnected", () => (disconnected = true));
  assert.doesNotThrow(() => b.connect());
  assert.equal(b.isConnected, false);
  assert.ok(disconnected);
});

test("port disconnect emits agentDisconnected", () => {
  const { chrome, port } = makeChrome();
  const b = new ExtSyncBridge({ projectId: "ext_1", channel: "stable", chrome });
  let info: any = null;
  b.on("agentDisconnected", (d) => (info = d));
  b.connect();
  port.fireDisconnect();
  assert.equal(b.isConnected, false);
  assert.ok(info !== null);
});
