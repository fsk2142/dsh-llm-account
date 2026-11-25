#!/usr/bin/env node
/**
 * 一次性历史重写驱动：对 `HEAD` 可达的历史重写**提交信息**。
 *
 * 该脚本属于已归档的历史操作，不是长期发版工具。它会改变所有 SHA；任何已推送仓库
 * 运行前都必须先读 `docs/SCRUB-COMMIT-HISTORY.md`，并完成仓库外备份与协作者协调。
 * @module dsh-llm-account/scripts/archive/run-msg-scrub
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const filterScript = join(here, "..", "scrub-commit-msg.mjs").replace(/\\/gu, "/");

console.log(`filter 脚本：${filterScript}`);
execFileSync("git", ["filter-branch", "-f", "--msg-filter", `node "${filterScript}"`, "--", "HEAD"], {
  stdio: "inherit",
  env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: "1" },
});
