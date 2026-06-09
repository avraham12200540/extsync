/** Build a clean ZIP (excluding node_modules/.git/secrets), with SHA-256 + report.json. */
import archiver from "archiver";
import { createWriteStream, createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { validateDirectory, type ValidateResult } from "./validate.js";

const EXCLUDES = [
  "node_modules/**", ".git/**", ".github/**", "*.pem", "*.key",
  ".env", ".env.*", "**/*.map", "**/.DS_Store", "extsync-report.json",
];

export interface PackResult {
  zipPath: string;
  sha256: string;
  size: number;
  fileCount: number;
  validation: ValidateResult;
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

export async function pack(srcDir: string, outZip: string): Promise<PackResult> {
  const validation = validateDirectory(srcDir);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outZip);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);
    archive.glob("**/*", { cwd: srcDir, ignore: EXCLUDES, dot: false });
    archive.finalize();
  });

  const sha256 = await sha256File(outZip);
  const size = readFileSync(outZip).length;

  const report = {
    name: validation.manifest.name,
    version: validation.manifest.version,
    manifestVersion: validation.manifest.manifestVersion,
    serviceWorker: validation.manifest.serviceWorker,
    serviceWorkerType: validation.manifest.serviceWorkerType,
    hasBridge: validation.manifest.hasBridge,
    permissions: validation.permissions,
    hostPermissions: validation.hostPermissions,
    fileCount: validation.fileCount,
    size,
    sha256,
    ok: validation.ok,
    errors: validation.findings.filter((f) => f.severity === "error"),
    warnings: validation.findings.filter((f) => f.severity === "warning"),
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(srcDir, "extsync-report.json"), JSON.stringify(report, null, 2));

  return { zipPath: outZip, sha256, size, fileCount: validation.fileCount, validation };
}
