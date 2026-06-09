/**
 * @extsync/release-schema — canonical release metadata + Ed25519 signing.
 *
 * The canonical form MUST match the Python and .NET implementations byte-for-byte.
 * See README.md for the exact rules. Do NOT use JSON.stringify for signing.
 */
import * as ed from "@noble/ed25519";

export const RELEASE_SCHEMA_VERSION = 1 as const;

export type Channel = "stable" | "beta" | "nightly";

export interface ArtifactRef {
  url: string;
  size: number;
  sha256: string;
}

/** Release metadata without the signature (the part that gets signed). */
export interface UnsignedReleaseMetadata {
  schema: 1;
  releaseId: string;
  projectId: string;
  extensionId: string;
  version: string;
  channel: Channel;
  minimumAgentVersion: string;
  artifact: ArtifactRef;
  sequence: number;
  rollback?: boolean;
  rolloutPercentage: number;
  permissionsChanged: boolean;
  requiresUserApproval: boolean;
  publishedAt: string;
  keyId: string;
}

export interface ReleaseMetadata extends UnsignedReleaseMetadata {
  signature: string; // base64(Ed25519(canonical(unsigned)))
}

type JsonValue =
  | string
  | number
  | boolean
  | JsonValue[]
  | { [k: string]: JsonValue };

/**
 * Produce the canonical JSON string for `value`.
 * Restricted type set (no floats, no null): integers, booleans, strings,
 * arrays, and string-keyed objects with keys sorted by code unit.
 */
export function canonicalize(value: JsonValue): string {
  if (value === null) {
    throw new Error("canonicalize: null is not allowed in signed metadata");
  }
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`canonicalize: non-integer number not allowed: ${value}`);
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  if (t === "object") {
    const obj = value as { [k: string]: JsonValue };
    const keys = Object.keys(obj).sort(); // default sort = UTF-16 code unit
    const parts = keys.map(
      (k) => JSON.stringify(k) + ":" + canonicalize(obj[k]),
    );
    return "{" + parts.join(",") + "}";
  }
  throw new Error(`canonicalize: unsupported type ${t}`);
}

/** Canonical UTF-8 bytes that get signed (signature field excluded). */
export function canonicalBytes(meta: UnsignedReleaseMetadata): Uint8Array {
  // Strip any accidental `signature` before canonicalizing.
  const { ...rest } = meta as Record<string, unknown>;
  delete (rest as Record<string, unknown>).signature;
  return new TextEncoder().encode(canonicalize(rest as JsonValue));
}

function b64decode(s: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64encode(b: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(b).toString("base64");
  let bin = "";
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** Sign metadata with a 32-byte Ed25519 private seed (base64). */
export async function signMetadata(
  meta: UnsignedReleaseMetadata,
  privateKeyB64: string,
): Promise<ReleaseMetadata> {
  const msg = canonicalBytes(meta);
  const sig = await ed.signAsync(msg, b64decode(privateKeyB64));
  return { ...meta, signature: b64encode(sig) };
}

/**
 * Verify a signed metadata object against a map of {keyId -> base64 public key}.
 * Returns true only if keyId is known and the signature is valid.
 */
export async function verifyMetadata(
  meta: ReleaseMetadata,
  publicKeys: Record<string, string>,
): Promise<boolean> {
  const pub = publicKeys[meta.keyId];
  if (!pub) return false;
  try {
    const msg = canonicalBytes(meta);
    return await ed.verifyAsync(b64decode(meta.signature), msg, b64decode(pub));
  } catch {
    return false;
  }
}

/**
 * Deterministic rollout bucket in [0,100). A device installs a release when
 * bucket(projectId, deviceId) < rolloutPercentage. Same algorithm as the
 * server (Python) so client and server agree. Uses FNV-1a over the key.
 */
export function rolloutBucket(projectId: string, deviceId: string): number {
  const key = `${projectId}:${deviceId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}
