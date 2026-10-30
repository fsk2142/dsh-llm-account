#!/usr/bin/env node
/**
 * 一次性：把 `ad93eea..HEAD` 的**提交信息**重新脱敏（第八轮复审 SEC-01）。
 *
 * ## 背景
 *
 * `ad93eea` 的提交信息为了说明「上一版把真实账号标识写进了源码」，**把那个标识
 * 又原样写了一遍**。它在 GitHub 上公开可见。
 *
 * ## 做法
 *
 * 用 `filter-branch --msg-filter` 重写 `cb4e1ea..HEAD` 这一段（即 `ad93eea` 与
 * `0c7d51b` 两个提交），只改提交信息、不动文件内容。
 *
 * 完成后需要：重打 `v1.6.0` tag → 强推 main 与 tag → 重建 v1.6.0 Release。
 * @module dsh-llm-account/scripts/run-msg-id-scrub
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const filter = join(here, "scrub-commit-message-ids.mjs").replace(/\\/gu, "/");

/** 重写的起点：`ad93eea` 的父提交（`cb4e1ea`），即 v1.5.9 的发布提交。 */
const BASE = "cb4e1ea";

console.log(`filter: ${filter}`);
console.log(`范围: ${BASE}..HEAD`);
execFileSync("git", ["filter-branch", "-f", "--msg-filter", `node "${filter}"`, "--", `${BASE}..HEAD`], {
  stdio: "inherit",
  env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: "1" },
});
