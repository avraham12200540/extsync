import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  canonicalize,
  canonicalBytes,
  signMetadata,
  verifyMetadata,
  rolloutBucket,
  type ReleaseMetadata,
  type UnsignedReleaseMetadata,
} from "./index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(here, "..", "schema", "vectors.json"), "utf-8"),
);

test("canonicalize matches Python vectors byte-for-byte", () => {
  for (const c of vectors.canonicalCases) {
    assert.equal(canonicalize(c.input), c.canonical, `case ${c.name}`);
  }
});

test("sample canonical bytes match Python", () => {
  const got = new TextDecoder().decode(canonicalBytes(vectors.sampleMetadata));
  assert.equal(got, vectors.sampleCanonical);
});

test("verifyMetadata accepts the Python-produced signature", async () => {
  const pubs = { [vectors.keyId]: vectors.publicKeyB64 };
  const ok = await verifyMetadata(vectors.sampleSigned as ReleaseMetadata, pubs);
  assert.equal(ok, true);
});

test("TS signature is identical to Python (Ed25519 is deterministic)", async () => {
  const meta = vectors.sampleMetadata as UnsignedReleaseMetadata;
  const signed = await signMetadata(meta, vectors.privateSeedB64);
  assert.equal(signed.signature, vectors.sampleSigned.signature);
});

test("verifyMetadata rejects tampered metadata", async () => {
  const pubs = { [vectors.keyId]: vectors.publicKeyB64 };
  const tampered = { ...vectors.sampleSigned, version: "9.9.9" } as ReleaseMetadata;
  assert.equal(await verifyMetadata(tampered, pubs), false);
});

test("verifyMetadata rejects unknown keyId", async () => {
  const ok = await verifyMetadata(vectors.sampleSigned as ReleaseMetadata, {
    other: vectors.publicKeyB64,
  });
  assert.equal(ok, false);
});

test("rolloutBucket matches Python and is deterministic", () => {
  for (const s of vectors.rolloutSamples) {
    assert.equal(rolloutBucket(s.projectId, s.deviceId), s.bucket);
  }
});
