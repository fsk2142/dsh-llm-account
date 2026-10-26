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
 * 用法：
 *   node scripts/check-commit-titles.mjs              # 检查上一个 tag 之后的提交
 *   node scripts/check-commit-titles.mjs --all        # 检查全部历史
 *   node scripts/check-commit-titles.mjs --limit 20   # 只查最近 20 个
 *
 * 退出码：有问题时 1；全部合规时 0。
 */
import { execFileSync } from "node:child_process";

/** 允许的 type 前缀。 */
const TYPES = ["feat", "fix", "chore", "docs", "test", "refactor", "style", "build", "perf", "revert"];

/** 标题硬上限（GitHub 会截断）。 */
const MAX_LEN = 72;
/** 建议上限（超了给提示，不失败）。 */
const SOFT_LEN = 50;

/** 读 git 输出。 */
function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** 取要检查的提交范围。 */
function subjectsOf(argv) {
  if (argv.includes("--all")) {
    return git(["log", "--format=%s"]).split("\n").filter(Boolean);
  }
  const limitAt = argv.indexOf("--limit");
  if (limitAt >= 0) {
    const n = Number(argv[limitAt + 1] ?? "20");
    return git(["log", `-${n}`, "--format=%s"]).split("\n").filter(Boolean);
  }
  // 默认：上一个 tag 之后（没有 tag 时取全部）。
  let range;
  try {
    const lastTag = git(["describe", "--tags", "--abbrev=0"]);
    range = `${lastTag}..HEAD`;
  } catch {
    range = "HEAD";
  }
  return git(["log", range, "--format=%s"]).split("\n").filter(Boolean);
}

/** 标题里的具体问题。 */
function problemsOf(subject) {
  const problems = [];
  const prefix = subject.match(/^([a-z]+)(\([^)]*\))?!?[:：]/);
  if (prefix === null) {
    problems.push("缺少 type 前缀（feat/fix/chore/docs/…）");
  } else if (!TYPES.includes(prefix[1])) {
    problems.push(`未知 type「${prefix[1]}」`);
  }
  if (subject.length > MAX_LEN) {
    problems.push(`超过 ${MAX_LEN} 字符（${subject.length}）`);
  }
  // 日期括号：把「什么时候」写进标题属于正文内容。
  if (/（20\d\d-\d\d/.test(subject) || /\(20\d\d-\d\d/.test(subject)) {
    problems.push("标题里有日期，应移到正文");
  }
  // 一个提交做多件事：拆开更好。
  if (/ \+ /.test(subject)) {
    problems.push("标题里出现「 + 」，一个提交应当只做一件事");
  }
  return problems;
}

/** 主流程。 */
function main() {
  const subjects = subjectsOf(process.argv.slice(2));
  if (subjects.length === 0) {
    console.log("提交标题检查：没有待检查的提交");
    return;
  }

  const failed = [];
  const long = [];
  for (const subject of subjects) {
    const problems = problemsOf(subject);
    if (problems.length > 0) failed.push({ subject, problems });
    else if (subject.length > SOFT_LEN) long.push({ subject, len: subject.length });
  }

  if (long.length > 0) {
    console.log(`提交标题：${long.length} 个超过建议长度 ${SOFT_LEN} 字符（不阻塞）`);
    for (const item of long) console.log(`  ${item.len}  ${item.subject}`);
  }

  if (failed.length === 0) {
    console.log(`提交标题：${subjects.length} 个全部合规`);
    return;
  }

  console.error(`提交标题：${failed.length} / ${subjects.length} 个有问题`);
  for (const item of failed) {
    console.error(`  ✗ ${item.subject}`);
    for (const problem of item.problems) console.error(`      · ${problem}`);
  }
  console.error("\n规范见 docs/RELEASING.md 第五节。");
  process.exitCode = 1;
}

main();
