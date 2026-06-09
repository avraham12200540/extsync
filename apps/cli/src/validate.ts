/**
 * Local (CI-facing) extension validation over an unpacked directory.
 * Mirrors the authoritative server-side checks; returns findings + an exit code.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";

export type Severity = "error" | "warning";

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  file?: string;
}

export interface ValidateResult {
  ok: boolean;
  findings: Finding[];
  manifest: {
    name?: string;
    version?: string;
    manifestVersion?: number;
    serviceWorker?: string;
    serviceWorkerType?: "classic" | "module";
    hasBridge: boolean;
  };
  permissions: string[];
  hostPermissions: string[];
  fileCount: number;
}

const BINARY_EXT = new Set([
  ".exe", ".dll", ".msi", ".bat", ".cmd", ".com", ".scr", ".sh", ".ps1",
  ".jar", ".so", ".dylib", ".bin",
]);
const TEXT_EXT = new Set([".js", ".mjs", ".cjs", ".html", ".htm", ".css"]);
const IGNORED_DIRS = new Set(["node_modules", ".git", ".github", "dist", ".vscode"]);
const VERSION_RE = /^\d{1,9}(\.\d{1,9}){0,3}$/;
const REMOTE_IMPORT = /importScripts\s*\(\s*['"]https?:\/\//i;
const REMOTE_SCRIPT = /<script[^>]+src\s*=\s*['"](?:https?:)?\/\//i;
const EVAL_RE = /\beval\s*\(/;
const NEW_FUNCTION_RE = /\bnew\s+Function\s*\(/;

function walk(dir: string, base: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push(relative(base, full).split(sep).join("/"));
  }
}

export function validateDirectory(root: string): ValidateResult {
  const findings: Finding[] = [];
  const add = (code: string, severity: Severity, message: string, file?: string) =>
    findings.push({ code, severity, message, file });

  const result: ValidateResult = {
    ok: false,
    findings,
    manifest: { hasBridge: false },
    permissions: [],
    hostPermissions: [],
    fileCount: 0,
  };

  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) {
    add("INVALID_MANIFEST", "error", "לא נמצא manifest.json בתיקייה.");
    return result;
  }

  let files: string[] = [];
  walk(root, root, files);
  result.fileCount = files.length;
  const fileSet = new Set(files);

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    add("INVALID_MANIFEST", "error", "ה-manifest.json אינו JSON תקין.");
    return result;
  }

  if (manifest.manifest_version !== 3) {
    add("MANIFEST_VERSION", "error", "נדרש manifest_version = 3.");
  } else {
    result.manifest.manifestVersion = 3;
  }
  if (typeof manifest.name === "string" && manifest.name.trim()) result.manifest.name = manifest.name;
  else add("MANIFEST_NAME", "error", "שדה name חסר או ריק.");
  if (typeof manifest.version === "string" && VERSION_RE.test(manifest.version)) {
    result.manifest.version = manifest.version;
  } else {
    add("MANIFEST_VERSION_FIELD", "error", "שדה version חסר או לא תקין.");
  }

  // icons
  const icons = manifest.icons as Record<string, string> | undefined;
  if (icons) {
    for (const p of Object.values(icons)) {
      if (!fileSet.has(p)) add("ICON_MISSING", "warning", `קובץ אייקון חסר: ${p}`, p);
    }
  }

  // service worker
  const bg = manifest.background as { service_worker?: string; type?: string } | undefined;
  if (bg?.service_worker) {
    result.manifest.serviceWorker = bg.service_worker;
    result.manifest.serviceWorkerType = bg.type === "module" ? "module" : "classic";
    if (!fileSet.has(bg.service_worker)) {
      add("SERVICE_WORKER_MISSING", "error", `service worker חסר: ${bg.service_worker}`, bg.service_worker);
    }
  }

  // content scripts
  const cs = manifest.content_scripts as Array<{ js?: string[]; css?: string[] }> | undefined;
  if (Array.isArray(cs)) {
    for (const entry of cs) {
      for (const f of [...(entry.js ?? []), ...(entry.css ?? [])]) {
        if (!fileSet.has(f)) add("CONTENT_SCRIPT_MISSING", "error", `קובץ content script חסר: ${f}`, f);
      }
    }
  }

  result.permissions = Array.isArray(manifest.permissions) ? (manifest.permissions as string[]) : [];
  result.hostPermissions = Array.isArray(manifest.host_permissions)
    ? (manifest.host_permissions as string[])
    : [];

  // file-level checks + static analysis
  for (const rel of files) {
    const ext = extname(rel).toLowerCase();
    if (BINARY_EXT.has(ext)) {
      add("DISALLOWED_BINARY", "error", `קובץ בינארי/הרצה אסור: ${rel}`, rel);
      continue;
    }
    if (rel.toLowerCase().includes("extsync-bridge")) result.manifest.hasBridge = true;
    if (TEXT_EXT.has(ext)) {
      const text = readFileSync(join(root, rel), "utf-8");
      if (REMOTE_IMPORT.test(text) || REMOTE_SCRIPT.test(text)) {
        add("REMOTE_CODE", "error", "טעינת קוד מכתובת חיצונית אסורה.", rel);
      }
      if (EVAL_RE.test(text)) add("EVAL_USAGE", "warning", "שימוש ב-eval().", rel);
      if (NEW_FUNCTION_RE.test(text)) add("NEW_FUNCTION", "warning", "שימוש ב-new Function().", rel);
    }
  }

  result.ok = findings.every((f) => f.severity !== "error");
  return result;
}
