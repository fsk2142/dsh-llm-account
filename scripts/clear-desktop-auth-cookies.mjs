#!/usr/bin/env node
/**
 * Clear stale DSH Desktop local-host authentication cookies.
 *
 * Background (see docs/operations.md):
 * every Desktop launch mints a cookie named `dsh-auth-<sha256(authority)>` where
 * authority is `127.0.0.1:<random port>`. Cookies persist for 30 days and the
 * port changes on every launch, so the Chromium cookie jar accumulates one row
 * per launch. Chromium sends ALL of them in one `Cookie:` header; once that
 * header (plus normal request headers) exceeds Node's 16 KB HTTP header limit,
 * the Host answers 431 and the Desktop aborts startup with
 * "desktop welcome: Web authentication failed".
 *
 * These cookies are useless after the Host process exits (the signing secret is
 * generated per process), so deleting them is safe. Closing and reopening the
 * app recreates a single fresh one.
 *
 * Usage:
 *   node scripts/clear-desktop-auth-cookies.mjs
 *   npm run fix:desktop-cookies
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const appData = process.env.APPDATA;
if (appData === undefined || appData === "") {
  console.error("APPDATA is not set; this script only supports Windows.");
  process.exit(1);
}

const databasePath = join(appData, "@deepseek-ai", "dsh-desktop", "Network", "Cookies");
if (!existsSync(databasePath)) {
  console.log("No DSH Desktop cookie store found at", databasePath);
  console.log("Nothing to clean.");
  process.exit(0);
}

try {
  const tasks = execFileSync(
    "tasklist",
    ["/FI", "IMAGENAME eq DeepSeek Harness.exe", "/FO", "CSV", "/NH"],
    { encoding: "utf8" },
  );
  if (/DeepSeek Harness\.exe/i.test(tasks)) {
    console.error("DeepSeek Harness is running. Quit the app first, then run this again.");
    process.exit(2);
  }
} catch {
  // tasklist unavailable: proceed; the app is probably not running anyway.
}

const backupDirectory = join(tmpdir(), "dsh-cookie-backups");
mkdirSync(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const backupPath = join(backupDirectory, `Cookies-${stamp}.sqlite`);
copyFileSync(databasePath, backupPath);
console.log("Backup:", backupPath);

const database = new DatabaseSync(databasePath);
const removed = database
  .prepare("SELECT COUNT(*) AS n FROM cookies WHERE name LIKE 'dsh-auth-%'")
  .get().n;
database.exec("DELETE FROM cookies WHERE name LIKE 'dsh-auth-%'");
const remaining = database.prepare("SELECT COUNT(*) AS n FROM cookies").get().n;
database.close();

console.log(`Removed ${removed} stale dsh-auth cookie(s); cookies remaining: ${remaining}.`);
console.log("Start DeepSeek Harness again; it will mint one fresh local cookie.");
