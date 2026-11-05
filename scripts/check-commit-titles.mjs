#!/usr/bin/env node
/**
 * 检查待发布提交的**标题格式**（2026-10-26）。
 *
 * ## 为什么需要
 *
 * GitHub 文件树悬停显示的是「该路径最后一次提交的标题」—— 标题就是读者看到的第一句话。
 * 太长的标题会被截断，带原因/日期/铺垫的标题会让悬停提示变成废话。
 *
 * 规范见 `docs/RELEASING.md` 第五节：`<type>(<scope>): <一句话>`，目标 ≤ 50 字符。
 *
 * ## 判据
 *
 * 1. **必须有 type 前缀**（`feat` / `fix` / `chore` / `docs` / `test` / `refactor` /
 *    `style` / `build` / `perf` / `revert`）—— 版本计算脚本靠它；
 * 2. **标题 ≤ 72 字符**（GitHub 的截断点）；超过 50 给提示但不失败；
 * 3. **标题里不该有**：日期括号（`（2026-…）`）、多件事的连接符（` + `）、
 *    「一个会误导的」这类评价性尾巴。
 *
 * 规则本体住在 `scripts/commit-titles.mjs`（纯函数，可被测试直接 import）；
 * 本文件只负责**读 git 与打印**。这样测试跑的是生产实现，不是它的副本。
 *
 * 用法：
 *   node scripts/check-commit-titles.mjs              # 检查上一个 tag 之后的提交
 *   node scripts/check-commit-titles.mjs --all        # 检查全部历史
 *   node scripts/check-commit-titles.mjs --limit 20   # 只查最近 20 个
 *
 * 退出码：有问题时 1；全部合规时 0。
 */
import { execFileSync } from "node:child_process";

import { partition } from "./commit-titles.mjs";

/** 读 git 输出。 */
function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/**
 * 取要检查的提交（**带 SHA**：豁免按 SHA 精确匹配，不能只看标题 ——
 * 同一个标题可能被将来的提交原样复用，那时它必须重新受约束）。
 * @param argv - 命令行参数。
 * @returns `{ sha, subject }` 列表。
 */
function commitsOf(argv) {
  const format = "--format=%H%x09%s";
  const toPairs = (raw) =>
    raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf("\t");
        return at < 0 ? { sha: "", subject: line } : { sha: line.slice(0, at), subject: line.slice(at + 1) };
      });

  if (argv.includes("--all")) return toPairs(git(["log", format]));
  const limitAt = argv.indexOf("--limit");
  if (limitAt >= 0) {
    const n = Number(argv[limitAt + 1] ?? "20");
    return toPairs(git(["log", `-${n}`, format]));
  }
  // 默认：上一个 tag 之后（没有 tag 时取全部）。
  let range;
  try {
    const lastTag = git(["describe", "--tags", "--abbrev=0"]);
    range = `${lastTag}..HEAD`;
  } catch {
    range = "HEAD";
  }
  return toPairs(git(["log", range, format]));
}

/** 主流程。 */
function main() {
  const commits = commitsOf(process.argv.slice(2));
  if (commits.length === 0) {
    console.log("提交标题检查：没有待检查的提交");
    return;
  }

  const { failed, long, hinted, exempted, checked } = partition(commits);
  const exemptNote = exempted === 0 ? "" : `（另有 ${exempted} 个已发布提交按 SHA 豁免）`;

  if (hinted.length > 0) {
    console.log(`提交标题：${hinted.length} 个需要确认（不阻塞）${exemptNote}`);
    for (const item of hinted) console.log(`  ? ${item.subject}\n      · ${item.hint}`);
  }

  if (long.length > 0) {
    console.log(`提交标题：${long.length} 个超过建议长度（不阻塞）${exemptNote}`);
    for (const item of long) console.log(`  ${item.len}  ${item.subject}`);
  }

  if (failed.length === 0) {
    console.log(`提交标题：${checked} 个全部合规${exemptNote}`);
    return;
  }

  console.error(`提交标题：${failed.length} / ${checked} 个有问题${exemptNote}`);
  for (const item of failed) {
    console.error(`  ✗ ${item.subject}`);
    for (const problem of item.problems) console.error(`      · ${problem}`);
  }
  console.error("\n规范见 docs/RELEASING.md 第五节。");
  process.exitCode = 1;
}

main();
