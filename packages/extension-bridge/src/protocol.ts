/**
 * ExtSync Bridge <-> Native Messaging Host protocol (§27).
 *
 * The Bridge NEVER downloads or executes remote code and NEVER reads page data.
 * It only exchanges these structured messages with the local Agent over Chrome
 * Native Messaging, and calls chrome.runtime.reload() after a verified nonce
 * handshake initiated by the Agent.
 */
export const PROTOCOL_VERSION = 1;
export const NATIVE_HOST_NAME = "com.extsync.agent";

export type MessageType =
  | "extension.register"
  | "extension.status"
  | "extension.version"
  | "update.reload_ready"
  | "update.reload_ack"
  | "update.success"
  | "update.failed"
  | "agent.status";

export interface BaseMessage {
  protocolVersion: number;
  requestId: string;
  timestamp: number;
  projectId: string;
  extensionId: string;
  type: MessageType;
  payload: Record<string, unknown>;
}

export function isBaseMessage(value: unknown): value is BaseMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.type === "string" &&
    typeof m.protocolVersion === "number" &&
    typeof m.requestId === "string" &&
    typeof m.projectId === "string" &&
    typeof m.payload === "object" &&
    m.payload !== null
  );
}

let counter = 0;
export function newRequestId(): string {
  counter = (counter + 1) % 1_000_000;
  // crypto.randomUUID exists in SW + modules; fall back to a counter.
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${counter}`;
  return `req_${rnd}`;
}
