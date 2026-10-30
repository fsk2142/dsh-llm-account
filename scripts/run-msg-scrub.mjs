#!/usr/bin/env node
/**
 * 一次性：对 `HEAD` 可达的历史重写**提交信息**（`git filter-branch --msg-filter`）。
 *
 * 单独写成一个脚本是为了避开命令行引号转义 —— `filter-branch` 会把 `--msg-filter`
 * 的值丢给 shell 执行，Windows 上反斜杠与引号的组合很容易被吃掉。
 *
 * 只改提交信息，**不动文件内容**（`filter-branch` 会在之后用 tree 校验确认）。
 * @module dsh-llm-account/scripts/run-msg-scrub
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const filterScript = join(here, "scrub-commit-msg.mjs").replace(/\\/gu, "/");

console.log(`filter 脚本：${filterScript}`);
execFileSync("git", ["filter-branch", "-f", "--msg-filter", `node "${filterScript}"`, "--", "HEAD"], {
  stdio: "inherit",
  env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: "1" },
});
