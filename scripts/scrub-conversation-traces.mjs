#!/usr/bin/env node
/**
 * 清理代码注释与文档里的**对话痕迹**（2026-10-26）。
 *
 * ## 为什么需要
 *
 * 注释里长期写着「需求：…」「需求…」「实际情况…」这类句子，把
 * 「谁在什么时候提的」写进了技术文档。读者关心的是**行为与理由**，不是对话记录。
 *
 * ## 改写规则（保守：只删对话框架，技术内容一律保留）
 *
 * | 原文形态 | 改写为 |
 * | --- | --- |
 * | `需求：「原话」` | `需求：「原话」`（保留引号内的实际要求） |
 * | `` | `（按需求实现）` → 再简化为删掉该括号 |
 * | `需求：「…」` | `需求：「…」` |
 * | `（实际情况：…）` | `（实际现象：…）` |
 * | `需求「…」` | `需求「…」` |
 * | 孤立的 `` | 整段删除 |
 *
 * **不删**引号/句号之后的技术描述 —— 那些才是注释的价值。
 *
 * ## 用法
 *
 *   node scripts/scrub-conversation-traces.mjs --dry-run   # 只看改什么（默认）
 *   node scripts/scrub-conversation-traces.mjs --apply     # 真的改
 *   node scripts/scrub-conversation-traces.mjs --apply --dir src   # 只改某个目录
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 要扫的目录。 */
const ROOTS = ["src", "tests", "docs", "scripts"];

/** 扩展名白名单。 */
const EXTS = [".ts", ".mts", ".mjs", ".md"];

/** 痕迹的出现判据。 */
const TRACE = /用户 20\d\d-\d\d-\d\d|用户要求|用户报障|用户原话/;

/**
 * 一条痕迹的改写规则表（顺序敏感：先匹配更具体的）。
 *
 * 每条是 `[正则, 替换]`。替换串里 `$1` 之类引用捕获组 —— 那些捕获组装的正是
 * **要保留的技术内容**（引号里的原话、括号里的说明）。
 */
const RULES = [
  // 1) 括号里「日期 + 实际情况 + 引号内容」：整个括号删掉。
  //    形如 `` → 整段消失。
  //    为什么连引号内容一起删：那句引号里写的是**现象的名字**，删掉后原句仍然完整
  //    （`存在的理由：空名称/空密钥时…` 自己就说明了问题）。
  [/\s*（20\d\d-\d\d-\d\d 用户报障「[^」]*」）/g, ""],
  [/\s*（20\d\d-\d\d-\d\d 用户报障[^）]*）/g, ""],
  [/\s*\(20\d\d-\d\d-\d\d 用户报障[^)]*\)/g, ""],
  // 1b) 不在括号里的「实际情况：内容」：保留内容、去掉标注。
  [/用户报障[：:]/g, "实际情况："],
  // 2) 括号里的「用户 + 日期 + 任意内容」：整个括号删掉（它只标注了「谁什么时候提的」）。
  [/\s*（用户 20\d\d-\d\d-\d\d[^）]*）/g, ""],
  [/\s*\(用户 20\d\d-\d\d-\d\d[^)]*\)/g, ""],
  // 3) 括号里「日期 + 需求」：整个括号删掉。
  [/\s*（20\d\d-\d\d-\d\d 用户要求[^）]*）/g, ""],
  [/\s*（20\d\d-\d\d-\d\d[^）]*用户要求[^）]*）/g, ""],
  // 4) 句首的「日期 需求：」→「需求：」
  [/20\d\d-\d\d-\d\d 用户要求[：:]/g, "需求："],
  // 5) 「用户 日期：」/「用户 日期 要求…」/「用户 日期 指定…」→「需求」
  [/用户 20\d\d-\d\d-\d\d[^：:，。]{0,6}[：:]/g, "需求："],
  [/用户 20\d\d-\d\d-\d\d 要求/g, "需求"],
  [/用户 20\d\d-\d\d-\d\d 指定/g, "需求"],
  [/用户 20\d\d-\d\d-\d\d/g, "需求"],
  // 6) 「需求：」→「需求：」；「需求」→「需求」
  [/用户要求[：:]/g, "需求："],
  [/用户要求/g, "需求"],
  // 7) 「实际情况」→「实际情况」
  [/用户报障[：:]/g, "实际情况："],
  [/用户报障/g, "实际情况"],
  // 8) 「需求」→「需求」
  [/用户原话/g, "需求"],
  // 9) 收尾：把规则 1 产生的空括号去掉。
  [/（\s*）/g, ""],
  [/\(\s*\)/g, ""],
];

/** 递归收集文件。 */
function collect(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      collect(full, out);
      continue;
    }
    if (EXTS.some((ext) => name.endsWith(ext))) out.push(full);
  }
}

/** 对一段文本应用全部规则。 */
function scrub(text) {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}

/** 主流程。 */
function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const dirAt = argv.indexOf("--dir");
  const roots = dirAt >= 0 ? [argv[dirAt + 1]] : ROOTS;

  const files = [];
  for (const root of roots) collect(root, files);

  let changedFiles = 0;
  let changedLines = 0;
  const samples = [];

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!TRACE.test(text)) continue;

    const lines = text.split("\n");
    let touched = false;
    const nextLines = lines.map((line) => {
      if (!TRACE.test(line)) return line;
      /**
       * **只改注释行。**
       *
       * 这是 2026-10-26 第一版踩到的坑：规则匹配到了**字符串内部**，于是
       * `it("…",  => {` 被改成 `it("…",  => {`
       * —— 少一个参数，变成语法错误（tsc 报 TS1135）。
       *
       * 判据：去掉行首空白后必须是 `*` / `//` / `/*` / `#` 之一。代码行里出现的
       * 「需求」这类字样（测试名、字符串字面量、断言文本）**不是**注释，
       * 改了会破坏语义甚至语法。
       */
      const trimmed = line.trimStart();
      if (!/^(\*|\/\/|\/\*|#)/.test(trimmed)) return line;

      const next = scrub(line);
      if (next === line) return line;
      touched = true;
      changedLines += 1;
      if (samples.length < 12) samples.push({ file, before: line.trim(), after: next.trim() });
      return next;
    });
    if (!touched) continue;

    changedFiles += 1;
    if (apply) writeFileSync(file, nextLines.join("\n"), "utf8");
  }

  if (samples.length > 0) {
    console.log(`\n样例（前 ${samples.length} 处）：`);
    for (const item of samples) {
      console.log(`  ${item.file}`);
      console.log(`    - ${item.before.slice(0, 88)}`);
      console.log(`    + ${item.after.slice(0, 88)}`);
    }
  }

  const verb = apply ? "已改写" : "将改写";
  console.log(`\n${verb}：${changedFiles} 个文件，${changedLines} 行`);
  if (!apply) console.log("这是 dry-run。确认后加 --apply 真正写入。");
}

main();
