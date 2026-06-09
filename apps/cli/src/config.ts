/** CLI config stored at ~/.extsync/config.json (token is never logged). */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";

export interface CliConfig {
  apiUrl: string;
  token?: string;
}

const DIR = join(homedir(), ".extsync");
const FILE = join(DIR, "config.json");
const DEFAULT_API = process.env.EXTSYNC_API_URL ?? "http://localhost:8000";

export function loadConfig(): CliConfig {
  if (process.env.EXTSYNC_TOKEN) {
    return { apiUrl: DEFAULT_API, token: process.env.EXTSYNC_TOKEN };
  }
  if (!existsSync(FILE)) return { apiUrl: DEFAULT_API };
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf-8")) as CliConfig;
    return { apiUrl: parsed.apiUrl || DEFAULT_API, token: parsed.token };
  } catch {
    return { apiUrl: DEFAULT_API };
  }
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(config, null, 2), "utf-8");
  try {
    chmodSync(FILE, 0o600); // restrict — the file holds an API token
  } catch {
    /* best effort on Windows */
  }
}

export function clearToken(): void {
  const cfg = loadConfig();
  delete cfg.token;
  saveConfig(cfg);
}
