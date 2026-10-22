#!/usr/bin/env node
/**
 * 修正 Markdown 标题层级：**主题标题保留 H2，子标题降为 H3**。
 *
 * ## 为什么需要（2026-10-22 文档整理）
 *
 * 这些文档是分多次追加写成的：每轮新增章节时都写 `##`，于是「主题」与它下面的
 * 「现象 / 根因 / 修法」变成同一个层级，Markdown 大纲里看不出从属关系 ——
 * 读起来像一堆并列的章节。
 *
 * ## 判定规则（简单且可解释）
 *
 * - 文件里**第一条** `##` 之后的内容属于它，保持 H2；
 * - 出现 `---` 分隔线时，**下一条** `##` 视为新主题，保持 H2；
 * - 其余 `##` 降为 `###`。
 *
 * 这条规则的假设是：作者用 `---` 分隔主题。规则不满足时脚本不会瞎猜 ——
 * 它只做「非主题的 ## → ###」，宁少勿错。
 *
 * 用法：
 *   node scripts/fix-doc-headings.mjs --check   # 只报告会改什么
 *   node scripts/fix-doc-headings.mjs --write   # 真的改
 */
import { readFileSync, writeFileSync } from "node:fs";

/**
 * 处理一份文件的内容。
 * @param text - 原文。
 * @returns 处理后的文本与被降级的标题数。
 */
function normalize(text) {
  const lines = text.split("\n");
  /** 上一个 `##` 之后是否出现过 `---`（出现则下一个 `##` 是新主题）。 */
  let sawSeparator = true; // 文件开头视为「新主题开始」，第一条 ## 保持 H2
  /** 是否已经处理过第一条 ##。 */
  let sawFirstHeading = false;
  let demoted = 0;

  const out = lines.map((line) => {
    if (/^---\s*$/u.test(line)) {
      sawSeparator = true;
      return line;
    }
    if (!line.startsWith("## ") || line.startsWith("### ")) return line;

    // 第一条 ## 或紧随 --- 的 ##：主题标题，保持。
    if (!sawFirstHeading || sawSeparator) {
      sawFirstHeading = true;
      sawSeparator = false;
      return line;
    }

    // 其余是子标题。
    demoted += 1;
    return `#${line}`;
  });

  return { text: out.join("\n"), demoted };
}

/** 主流程。 */
function main() {
  const write = process.argv.includes("--write");
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (files.length === 0) {
    console.error("用法：node scripts/fix-doc-headings.mjs [--write] <file...>");
    process.exitCode = 1;
    return;
  }

  let total = 0;
  for (const file of files) {
    const original = readFileSync(file, "utf8");
    const { text, demoted } = normalize(original);
    if (demoted === 0) {
      console.log(`${file}: 无需修改`);
      continue;
    }
    console.log(`${file}: 降级 ${demoted} 个标题`);
    total += demoted;
    if (write) writeFileSync(file, text, "utf8");
  }
  console.log(write ? `\n共降级 ${total} 个标题。` : `\n（--check 模式，未写入。共 ${total} 个待降级）`);
}

main();
