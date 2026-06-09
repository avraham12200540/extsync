#!/usr/bin/env node
/** ExtSync developer CLI. Run via `npx extsync <command>`. */
import { Command } from "commander";
import {
  readFileSync, writeFileSync, existsSync, copyFileSync, statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { api, type ApiError } from "./api.js";
import { loadConfig, saveConfig, clearToken } from "./config.js";
import { validateDirectory } from "./validate.js";
import { pack } from "./pack.js";
import {
  CLASSIC_BRIDGE_JS, MODULE_BRIDGE_JS, classicSnippet, moduleSnippet,
} from "./bridge-template.js";

const program = new Command();
program.name("extsync").description("ExtSync developer CLI").version("0.1.0");

function ok(msg: string) { console.log(`✓ ${msg}`); }
function info(msg: string) { console.log(msg); }
function fail(msg: string): never { console.error(`✗ ${msg}`); process.exit(1); }

// ---------------------------------------------------------------- login/logout
program.command("login")
  .description("התחברות באמצעות API token")
  .option("--token <token>", "API token (exsk_...)")
  .option("--api <url>", "כתובת ה-API")
  .action(async (opts) => {
    const cfg = loadConfig();
    if (opts.api) cfg.apiUrl = opts.api;
    const token = opts.token ?? process.env.EXTSYNC_TOKEN;
    if (!token) fail("ספקו טוקן עם --token (צרו אחד בלוח הבקרה > API).");
    try {
      const me = await api.me<{ email: string }>(token);
      cfg.token = token;
      saveConfig(cfg);
      ok(`מחובר כ-${me.email} (${cfg.apiUrl})`);
    } catch (e) {
      fail(`ההתחברות נכשלה: ${(e as ApiError).message}`);
    }
  });

program.command("logout").description("ניתוק").action(() => {
  clearToken();
  ok("התנתקת.");
});

program.command("whoami").description("מי מחובר").action(async () => {
  try {
    const me = await api.get<{ email: string; role: string }>("/auth/me");
    ok(`${me.email} (${me.role})`);
  } catch {
    fail("לא מחובר. הריצו: extsync login --token ...");
  }
});

// ---------------------------------------------------------------- validate
program.command("validate")
  .description("בדיקת תקינות תוסף (תיקייה לא ארוזה)")
  .argument("[dir]", "תיקיית התוסף", ".")
  .action((dir) => {
    const root = resolve(dir);
    const res = validateDirectory(root);
    for (const f of res.findings) {
      const tag = f.severity === "error" ? "ERROR" : "WARN";
      console.log(`  [${tag}] ${f.code} ${f.message}${f.file ? ` (${f.file})` : ""}`);
    }
    if (res.manifest.name) info(`\n${res.manifest.name} v${res.manifest.version} — MV${res.manifest.manifestVersion}, ${res.fileCount} קבצים`);
    if (res.ok) { ok("הבדיקה עברה."); process.exit(0); }
    else { console.error("✗ נמצאו שגיאות."); process.exit(1); }
  });

// ---------------------------------------------------------------- pack
program.command("pack")
  .description("אריזת ZIP נקי + חישוב SHA-256 + report")
  .argument("[dir]", "תיקיית התוסף", ".")
  .option("--out <file>", "נתיב ה-ZIP", "")
  .action(async (dir, opts) => {
    const root = resolve(dir);
    const out = opts.out || join(tmpdir(), `extsync-${Date.now()}.zip`);
    const res = await pack(root, out);
    info(`ZIP: ${res.zipPath}`);
    info(`SHA-256: ${res.sha256}`);
    info(`גודל: ${res.size} בייט, ${res.fileCount} קבצים`);
    if (!res.validation.ok) fail("האריזה הושלמה אך הבדיקה נכשלה — תקנו שגיאות לפני העלאה.");
    ok("נארז בהצלחה.");
  });

// ---------------------------------------------------------------- init
program.command("init")
  .description("שילוב ExtSync Bridge בתוסף")
  .argument("[dir]", "תיקיית התוסף", ".")
  .option("--project <id>", "מזהה הפרויקט")
  .option("--channel <channel>", "ערוץ", "stable")
  .option("-y, --yes", "כתיבה בפועל (ללא דגל זה — תצוגה בלבד)", false)
  .action((dir, opts) => {
    const root = resolve(dir);
    const manifestPath = join(root, "manifest.json");
    if (!existsSync(manifestPath)) fail("לא נמצא manifest.json.");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const bg = manifest.background || {};
    const sw: string | undefined = bg.service_worker;
    const isModule = bg.type === "module";
    if (!sw) {
      info("לא זוהה service worker. שילוב ידני:");
      info("1. צרו קובץ service worker והגדירו אותו ב-manifest.background.service_worker");
      info("2. הוסיפו את הקוד:\n" + (isModule ? moduleSnippet() : classicSnippet()));
      return;
    }
    const bridgeFile = isModule ? "extsync-bridge.mjs" : "extsync-bridge.js";
    const bridgeContent = isModule ? MODULE_BRIDGE_JS : CLASSIC_BRIDGE_JS;
    const snippet = (isModule ? moduleSnippet() : classicSnippet())
      .replace("REPLACE_PROJECT_ID", opts.project || manifest.key || "YOUR_PROJECT_ID")
      .replace(/channel: "stable"/, `channel: "${opts.channel}"`);

    info("השינויים המתוכננים:");
    info(`  + ${bridgeFile} (קובץ ה-Bridge)`);
    info(`  ~ ${sw} (הוספת אתחול ה-Bridge בראש הקובץ)`);
    info(`  ~ manifest.json (הוספת הרשאת nativeMessaging)`);
    info(`  + extsync.config.json`);
    info("\nקוד שיתווסף ל-service worker:\n" + snippet + "\n");

    if (!opts.yes) {
      info("הרצה ללא כתיבה. להחלה: extsync init --yes");
      return;
    }
    // Backups before any modification (never delete existing code).
    copyFileSync(manifestPath, manifestPath + ".bak");
    const swPath = join(root, sw);
    if (existsSync(swPath)) copyFileSync(swPath, swPath + ".bak");

    writeFileSync(join(root, bridgeFile), bridgeContent, "utf-8");
    const existingSw = existsSync(swPath) ? readFileSync(swPath, "utf-8") : "";
    writeFileSync(swPath, snippet + "\n\n" + existingSw, "utf-8");
    const perms: string[] = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    if (!perms.includes("nativeMessaging")) perms.push("nativeMessaging");
    manifest.permissions = perms;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    writeFileSync(join(root, "extsync.config.json"),
      JSON.stringify({ projectId: opts.project || null, channel: opts.channel }, null, 2));
    ok("ה-Bridge שולב. גיבויים נשמרו כ-*.bak.");
  });

// ---------------------------------------------------------------- upload
program.command("upload")
  .description("העלאת גרסה כ-Draft")
  .argument("[dir]", "תיקיית התוסף", ".")
  .requiredOption("--project <id>", "מזהה הפרויקט")
  .option("--channel <channel>", "ערוץ", "stable")
  .option("--version <v>", "גרסה (ברירת מחדל מה-manifest)")
  .option("--notes <notes>", "הערות גרסה")
  .action(async (dir, opts) => {
    const root = resolve(dir);
    const out = join(tmpdir(), `extsync-${Date.now()}.zip`);
    const res = await pack(root, out);
    if (!res.validation.ok) fail("הבדיקה נכשלה — לא מעלים.");
    const version = opts.version || res.validation.manifest.version;
    if (!version) fail("לא נמצאה גרסה.");
    const buf = readFileSync(out);
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "application/zip" }), "extension.zip");
    form.append("version", version);
    form.append("channel", opts.channel);
    if (opts.notes) form.append("release_notes", opts.notes);
    try {
      const r = await api.upload<{ id: string; status: string }>(
        `/projects/${opts.project}/releases`, form);
      ok(`הועלה (release ${r.id}, סטטוס ${r.status}).`);
      info(`${loadConfig().apiUrl.replace(/:8000$/, ":3000")}/app/projects/${opts.project}/releases/${r.id}`);
    } catch (e) {
      fail(`ההעלאה נכשלה: ${(e as ApiError).message}`);
    }
  });

// ---------------------------------------------------------------- publish
program.command("publish")
  .description("פרסום גרסה")
  .requiredOption("--project <id>")
  .requiredOption("--release <id>")
  .option("--rollout <pct>", "אחוז הפצה", "100")
  .action(async (opts) => {
    try {
      const r = await api.post<{ status: string; sequence: number }>(
        `/projects/${opts.project}/releases/${opts.release}/publish`,
        { rolloutPercentage: Number(opts.rollout) });
      ok(`פורסם (סטטוס ${r.status}, sequence ${r.sequence}).`);
    } catch (e) {
      fail(`הפרסום נכשל: ${(e as ApiError).message}`);
    }
  });

// ---------------------------------------------------------------- status
program.command("status")
  .description("סטטוס גרסאות של פרויקט")
  .requiredOption("--project <id>")
  .action(async (opts) => {
    try {
      const releases = await api.get<any[]>(`/projects/${opts.project}/releases`);
      if (!releases.length) return info("אין גרסאות.");
      for (const r of releases) {
        info(`  ${r.version}  ${r.channel}  ${r.status}  seq=${r.sequence ?? "-"}  risk=${r.riskScore}`);
      }
    } catch (e) {
      fail(`שגיאה: ${(e as ApiError).message}`);
    }
  });

// ---------------------------------------------------------------- link
program.command("link")
  .description("יצירת קישור התקנה")
  .requiredOption("--project <id>")
  .option("--channel <channel>", "ערוץ", "stable")
  .option("--type <type>", "סוג הקישור", "public")
  .action(async (opts) => {
    try {
      const link = await api.post<{ url: string; token: string }>(
        `/projects/${opts.project}/install-links`,
        { channel: opts.channel, linkType: opts.type });
      ok("נוצר קישור התקנה:");
      info(link.url);
    } catch (e) {
      fail(`שגיאה: ${(e as ApiError).message}`);
    }
  });

// ---------------------------------------------------------------- doctor
program.command("doctor")
  .description("אבחון סביבה וחיבור")
  .action(async () => {
    const cfg = loadConfig();
    info(`API: ${cfg.apiUrl}`);
    info(`Node: ${process.version}`);
    const major = Number(process.version.slice(1).split(".")[0]);
    if (major < 18) console.log("  [WARN] מומלץ Node 18+");
    else ok("גרסת Node תקינה");
    info(`טוקן: ${cfg.token ? "מוגדר" : "חסר (הריצו extsync login)"}`);
    try {
      const res = await fetch(`${cfg.apiUrl}/health/live`);
      if (res.ok) ok("השרת מגיב"); else console.log(`  [WARN] השרת החזיר ${res.status}`);
    } catch {
      console.log("  [WARN] לא ניתן להגיע לשרת");
    }
    if (cfg.token) {
      try { const me = await api.get<{ email: string }>("/auth/me"); ok(`מחובר כ-${me.email}`); }
      catch { console.log("  [WARN] הטוקן אינו תקף"); }
    }
  });

program.parseAsync(process.argv).catch((e) => fail(e.message));
