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
import { homedir } from "node:os";
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

/**
 * 进程检测：**失败就中止**，不再「假定应用没运行」。
 *
 * 原来 `catch {}` 之后直接继续 —— 如果 `tasklist` 本身不可用（企业策略、精简系统），
 * 而应用其实开着，就会在数据库被写入的同时改它：可能损坏库、也可能让改动被应用
 * 覆盖回去。这种「不确定就动手」的做法在动用户真实数据时不该有。
 */
let appState = "unknown";
try {
  const tasks = execFileSync(
    "tasklist",
    ["/FI", "IMAGENAME eq DeepSeek Harness.exe", "/FO", "CSV", "/NH"],
    { encoding: "utf8" },
  );
  appState = /DeepSeek Harness\.exe/i.test(tasks) ? "running" : "stopped";
} catch {
  appState = "unknown";
}
if (appState === "running") {
  console.error("DeepSeek Harness is running. Quit the app first, then run this again.");
  process.exit(2);
}
/**
 * `--force`：**显式**绕过「无法确认进程状态」这一道。
 *
 * 第七轮复审 BUG-02 指出：上一版的错误提示让用户「加 `--force` 重跑」，但代码
 * **从来没读过 `--force`** —— 提示是假的，加不加都 `exit(3)`。
 *
 * 现在真的实现了。它**只**绕过「状态未知」这一种情况（`tasklist` 不可用），
 * 不绕过「确认在运行」—— 那个必须让用户先退出应用，`--force` 也不该覆盖。
 */
const forced = process.argv.includes("--force");
if (appState === "unknown" && !forced) {
  console.error(
    [
      "无法确认 DeepSeek Harness 是否在运行（tasklist 不可用）。",
      "改动 Cookie 数据库时如果应用仍在写它，可能损坏数据或被覆盖回去。",
      "",
      "请先手动确认应用已完全退出，然后加 --force 重跑：",
      "  node scripts/clear-desktop-auth-cookies.mjs --force",
    ].join("\n"),
  );
  process.exit(3);
}
if (appState === "unknown" && forced) {
  console.warn("⚠ 已按 --force 跳过进程检测。请确认 DeepSeek Harness 已完全退出。");
}

/**
 * 备份策略：**默认不备份**（第七轮复审 SEC-03）。
 *
 * 原来无条件把**整个 Chromium Cookie 数据库**复制到系统临时目录
 * （`%TEMP%/dsh-cookie-backups/`），按时间戳累积、没有权限限制、没有清理期限。
 * 那份副本里不只有待删的 `dsh-auth-*`，还有该浏览器配置下的其它全部 Cookie。
 *
 * 现在：
 * - 默认不备份（这个脚本的用途是清掉过期登录态，本来就不需要保留它）；
 * - 真要备份时加 `--backup`，并落到**用户目录**（不是公共临时区），文件名带时间戳；
 * - 备份后打印明确路径与「用完请删除」的提示。
 */
const wantsBackup = process.argv.includes("--backup");
if (wantsBackup) {
  const backupDirectory = join(homedir(), ".dsh", "cookie-backups");
  mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = join(backupDirectory, `Cookies-${stamp}.sqlite`);
  copyFileSync(databasePath, backupPath);
  console.log("Backup:", backupPath);
  console.log("注意：该副本含整个 Cookie 库，恢复完请自行删除。");
} else {
  console.log("（未备份。需要备份请加 --backup，副本会落到 ~/.dsh/cookie-backups/）");
}

const database = new DatabaseSync(databasePath);
const removed = database
  .prepare("SELECT COUNT(*) AS n FROM cookies WHERE name LIKE 'dsh-auth-%'")
  .get().n;
database.exec("DELETE FROM cookies WHERE name LIKE 'dsh-auth-%'");
const remaining = database.prepare("SELECT COUNT(*) AS n FROM cookies").get().n;
database.close();

console.log(`Removed ${removed} stale dsh-auth cookie(s); cookies remaining: ${remaining}.`);
console.log("Start DeepSeek Harness again; it will mint one fresh local cookie.");
