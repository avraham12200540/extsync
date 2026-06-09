/**
 * ExtSync Bridge core. Framework-free, with an injectable `chrome` so it can be
 * unit-tested without a browser. Works in both a classic service worker and an
 * ES module service worker (see index.ts / sw.ts wrappers).
 */
import {
  BaseMessage,
  MessageType,
  NATIVE_HOST_NAME,
  PROTOCOL_VERSION,
  isBaseMessage,
  newRequestId,
} from "./protocol.js";

export type BridgeEvent =
  | "agentConnected"
  | "agentDisconnected"
  | "updatePrepared"
  | "reloadRequested"
  | "updateCompleted"
  | "updateFailed";

export interface ExtSyncOptions {
  projectId: string;
  channel: "stable" | "beta" | "nightly";
  /** Injected for tests; defaults to globalThis.chrome. */
  chrome?: ChromeLike;
  /** Set false to require an explicit reload() call instead of auto-reload. */
  autoReload?: boolean;
  logger?: (level: string, msg: string, extra?: unknown) => void;
}

/** The minimal slice of the chrome API the Bridge uses. */
export interface ChromeLike {
  runtime: {
    id?: string;
    lastError?: { message?: string } | undefined;
    connectNative(name: string): NativePort;
    getManifest(): { version?: string };
    reload(): void;
  };
}

export interface NativePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(cb: (msg: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

type Listener = (data?: unknown) => void;

export class ExtSyncBridge {
  private readonly opts: ExtSyncOptions;
  private readonly chrome: ChromeLike;
  private port: NativePort | null = null;
  private connected = false;
  private pendingReloadNonce: string | null = null;
  private reconnectAttempts = 0;
  private readonly listeners = new Map<BridgeEvent, Set<Listener>>();

  constructor(opts: ExtSyncOptions) {
    this.opts = { autoReload: true, ...opts };
    const c = opts.chrome ?? (globalThis as { chrome?: ChromeLike }).chrome;
    if (!c) throw new Error("chrome API not available");
    this.chrome = c;
  }

  on(event: BridgeEvent, cb: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  private emit(event: BridgeEvent, data?: unknown): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch {
        /* listener errors must not break the bridge */
      }
    });
  }

  private log(level: string, msg: string, extra?: unknown): void {
    this.opts.logger?.(level, `[extsync] ${msg}`, extra);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private get extensionId(): string {
    return this.chrome.runtime.id ?? "";
  }

  private get currentVersion(): string {
    return this.chrome.runtime.getManifest().version ?? "0.0.0";
  }

  /** Connect to the local Agent. Never throws — failures emit agentDisconnected. */
  connect(): void {
    try {
      this.port = this.chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch (err) {
      this.log("warn", "agent not installed / connectNative failed", err);
      this.handleDisconnect();
      return;
    }
    this.port.onMessage.addListener((msg) => this.handleMessage(msg));
    this.port.onDisconnect.addListener(() => this.handleDisconnect());
    this.connected = true;
    this.reconnectAttempts = 0;
    this.emit("agentConnected");
    this.send("extension.register", {
      version: this.currentVersion,
      channel: this.opts.channel,
    });
    this.log("info", "connected to agent");
  }

  private send(type: MessageType, payload: Record<string, unknown>, requestId?: string): void {
    if (!this.port) return;
    const message: BaseMessage = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: requestId ?? newRequestId(),
      timestamp: Date.now(),
      projectId: this.opts.projectId,
      extensionId: this.extensionId,
      type,
      payload,
    };
    try {
      this.port.postMessage(message);
    } catch (err) {
      this.log("warn", "postMessage failed", err);
      this.handleDisconnect();
    }
  }

  private handleMessage(raw: unknown): void {
    if (!isBaseMessage(raw)) {
      this.log("warn", "ignoring malformed native message");
      return;
    }
    if (raw.protocolVersion !== PROTOCOL_VERSION) {
      this.log("warn", `protocol mismatch: ${raw.protocolVersion}`);
      return;
    }
    // Only accept messages addressed to this project.
    if (raw.projectId && raw.projectId !== this.opts.projectId) return;

    switch (raw.type) {
      case "agent.status":
        this.emit("agentConnected", raw.payload);
        break;
      case "update.success":
        this.emit("updatePrepared", raw.payload);
        break;
      case "update.reload_ready":
        this.handleReloadReady(raw);
        break;
      case "update.failed":
        this.emit("updateFailed", raw.payload);
        break;
      default:
        this.log("debug", `unhandled message type ${raw.type}`);
    }
  }

  /**
   * The Agent has staged a verified, signed update and asks us to reload.
   * We ACK with the same nonce (proving the handshake) and then reload. The
   * message arrives only via the trusted Native Messaging port (origin-bound).
   */
  private handleReloadReady(msg: BaseMessage): void {
    const nonce = String(msg.payload.nonce ?? "");
    if (!nonce) {
      this.log("warn", "reload_ready without nonce — ignored");
      return;
    }
    this.pendingReloadNonce = nonce;
    this.emit("reloadRequested", { nonce });
    // Acknowledge so the Agent records that reload was honored.
    this.send("update.reload_ack", { nonce }, msg.requestId);
    this.emit("updateCompleted", { version: msg.payload.version });
    if (this.opts.autoReload) {
      this.reload(nonce);
    }
  }

  /** Manually trigger reload for a previously requested nonce. */
  reload(nonce?: string): void {
    if (nonce && nonce !== this.pendingReloadNonce) {
      this.log("warn", "reload nonce mismatch — refusing");
      return;
    }
    this.log("info", "reloading extension");
    this.chrome.runtime.reload();
  }

  /** Report local update result back to the Agent. */
  reportStatus(status: "success" | "failed", detail?: Record<string, unknown>): void {
    this.send(status === "success" ? "update.success" : "update.failed", {
      version: this.currentVersion,
      ...detail,
    });
  }

  private handleDisconnect(): void {
    const lastError = this.chrome.runtime.lastError?.message;
    this.connected = false;
    this.port = null;
    this.emit("agentDisconnected", { lastError });
    this.log("info", "disconnected from agent", lastError);
  }
}
