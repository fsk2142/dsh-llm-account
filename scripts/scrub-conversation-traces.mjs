#!/usr/bin/env node
/**
 * 清理代码注释与文档里的**对话痕迹**。
 *
 * 读者关心的是行为与理由，不是「谁在什么时候提的」。因此只删除对话归属，
 * 引号、括号与句号之后的技术说明一律保留。
 *
 * ## 改写规则
 *
 * | 原文形态 | 改写为 |
 * | --- | --- |
 * | `（2026-11-03 用户要求：必须升档）` | `（必须升档）` |
 * | `（2026-11-04 外部审查 U06；用户要求两条线都支持）` | `（外部审查 U06；两条线都支持）` |
 * | `（2026-11-03 用户要求）` | 整段删除 |
 * | `用户报障原话是「模型不能发图片」` | `实际现象是「模型不能发图片」` |
 * | `用户要求：保留技术说明` | `需求：保留技术说明` |
 * | `用户原话：「原始描述」` | `原始描述：「原始描述」` |
 *
 * TS/JS 只清洗 parser 识别出的注释 token；字符串、模板字符串与正则不会被动到。
 * Markdown 的围栏代码、缩进代码与行内代码受到保护，其余正文按同一套规则清洗。
 *
 * ## 用法
 *
 *   node scripts/scrub-conversation-traces.mjs --dry-run   # 只看改什么（默认）
 *   node scripts/scrub-conversation-traces.mjs --apply     # 真的改
 *   node scripts/scrub-conversation-traces.mjs --apply --dir src
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** 要扫的目录。 */
export const ROOTS = ["src", "tests", "docs", "scripts"];

/** 扩展名白名单。 */
export const EXTS = [".ts", ".mts", ".mjs", ".md"];

/** 普通正文里归属词的边界：行首、空白、注释标记或常见标点。 */
const ATTRIBUTION_BOUNDARY = String.raw`(^|[\s*#/（(，,。；;：:>|\-])`;

/**
 * 清洗一段普通正文（已排除行内代码）。
 *
 * 括号按完整文本做平衡扫描，支持跨行与嵌套；归属单独占满括号时整段删除，
 * 还有技术内容时只删归属并保留原括号。
 * @param text - 一段普通正文。
 * @returns 清洗后的正文。
 */
export function scrubProse(text) {
  const parenthetical = scrubBalancedParentheses(text);
  return rewriteAttribution(parenthetical, false);
}

/**
 * 递归清洗平衡括号。
 * @param text - 普通正文。
 * @returns 括号归属已清洗的正文。
 */
function scrubBalancedParentheses(text) {
  let out = "";
  let cursor = 0;
  for (let index = 0; index < text.length; index += 1) {
    const opener = text[index];
    if (opener !== "（" && opener !== "(") continue;
    const end = matchingParen(text, index, opener);
    if (end === -1) continue;
    const closer = opener === "（" ? "）" : ")";
    const originalInner = text.slice(index + 1, end);
    const inner = scrubBalancedParentheses(originalInner);
    // 内层全是归属被递归删空时，外层也只是归属框架；普通空括号/函数调用不受影响。
    if (inner.trim() === "" && originalInner.trim() !== "") {
      out += text.slice(cursor, index).replace(/[ \t]+$/, "");
    } else {
      const kept = scrubParentheticalContent(inner);
      if (kept === undefined) {
        out += `${text.slice(cursor, index)}${opener}${inner}${closer}`;
      } else if (kept === "") {
        out += text.slice(cursor, index).replace(/[ \t]+$/, "");
      } else {
        out += `${text.slice(cursor, index)}${opener}${kept}${closer}`;
      }
    }
    cursor = end + 1;
    index = end;
  }
  return out + text.slice(cursor);
}

/**
 * 找一个括号的配对位置，支持中英文括号混合嵌套。
 * @param text - 正文。
 * @param start - 开括号位置。
 * @param opener - 开括号字符。
 * @returns 闭括号位置；未配对时返回 -1。
 */
function matchingParen(text, start, opener) {
  const expected = [opener === "（" ? "）" : ")"];
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "（" || char === "(") {
      expected.push(char === "（" ? "）" : ")");
      continue;
    }
    if (char !== "）" && char !== ")") continue;
    if (char !== expected.at(-1)) continue;
    expected.pop();
    if (expected.length === 0) return index;
  }
  return -1;
}

/**
 * 清洗括号内容：删掉对话归属，保留剩余技术说明。
 * @param content - 括号内原文。
 * @returns 剩余内容；没有对话归属时返回 undefined，归属单独占满括号时返回空串。
 */
function scrubParentheticalContent(content) {
  // JSDoc 跨行括号里常有 `*` 行前缀；先归一化才能匹配跨行归属短语。
  const normalized = content.replace(/\r?\n[ \t]*\*[ \t]?/g, " ");
  const rewritten = rewriteAttribution(normalized, true);
  // 没有对话归属的技术括号必须原样保留，包括换行、空括号与 JSDoc 行前缀。
  if (rewritten === normalized) return undefined;
  // 归属和技术说明同段时，段首日期也属于对话框架；没有归属的普通日期不能动。
  const withoutAttributionDate = rewritten.replace(/^20\d\d-\d\d-\d\d[ \t]*/, "");
  const kept = withoutAttributionDate
    .replace(/^[：:；;][ \t]*/, "")
    .replace(/[ \t]*[；;]$/, "")
    .replace(/[；;][ \t]*[；;]/g, "；")
    .trim();
  const attributionOnly = /^(?:需求|按需求(?:改|实现)?|问题：?|实际现象：?|原始描述：?)$/;
  return attributionOnly.test(kept) ? "" : kept;
}

/**
 * 改写对话归属词。
 * @param text - 普通正文或括号内容。
 * @param parenthetical - 是否位于括号内；括号内纯归属词要删掉。
 * @returns 改写后的正文。
 */
function rewriteAttribution(text, parenthetical) {
  const label = (kept) => (parenthetical ? "" : kept);
  return text
    .replace(/用户报障原话是/g, "实际现象是")
    .replace(/20\d\d-\d\d-\d\d[ \t]*用户(?:提出(?:的)?|提的)[：:]?/g, "")
    .replace(/20\d\d-\d\d-\d\d[ \t]*用户选的/g, "选定")
    .replace(/20\d\d-\d\d-\d\d[ \t]*用户诉求/g, label("需求"))
    .replace(/20\d\d-\d\d-\d\d[ \t]*用户报障原话[：:]?/g, "实际现象：")
    .replace(/20\d\d-\d\d-\d\d[ \t]*用户报障[：:]?/g, "实际现象：")
    .replace(/20\d\d-\d\d-\d\d[ \t]*用户提问[：:]?/g, "问题：")
    .replace(/20\d\d-\d\d-\d\d[ \t]*用户需求/g, label("需求"))
    .replace(/20\d\d-\d\d-\d\d[ \t]*用户要求[：:]?/g, label("需求"))
    .replace(/20\d\d-\d\d-\d\d[ \t]*用户原话[：:]?/g, "原始描述：")
    .replace(/用户[ \t]*20\d\d-\d\d-\d\d[ \t]*(报障原话|报障|提问|需求|要求|原话|指定)?[：:]?/g, (_whole, kind) => {
      if (kind === "报障原话" || kind === "报障") return "实际现象：";
      if (kind === "提问") return "问题：";
      if (kind === "原话") return "原始描述：";
      return label("需求");
    })
    .replace(/20\d\d-\d\d-\d\d[ \t]*用户/g, "")
    .replace(new RegExp(`${ATTRIBUTION_BOUNDARY}用户(?:提出(?:的)?|提的)[：:]?`, "g"), "$1")
    .replace(new RegExp(`${ATTRIBUTION_BOUNDARY}用户报障原话[：:]?`, "g"), "$1实际现象：")
    .replace(new RegExp(`${ATTRIBUTION_BOUNDARY}用户报障[：:]?`, "g"), "$1实际现象：")
    .replace(new RegExp(`${ATTRIBUTION_BOUNDARY}用户提问[：:]?`, "g"), "$1问题：")
    .replace(new RegExp(`${ATTRIBUTION_BOUNDARY}用户诉求`, "g"), `$1${label("需求")}`)
    .replace(new RegExp(`${ATTRIBUTION_BOUNDARY}用户需求`, "g"), `$1${label("需求")}`)
    .replace(/按用户要求/g, "按需求")
    .replace(new RegExp(`${ATTRIBUTION_BOUNDARY}用户要求`, "g"), `$1${label("需求")}`)
    .replace(new RegExp(`${ATTRIBUTION_BOUNDARY}用户原话[：:]?`, "g"), "$1原始描述：");
}

/**
 * 只清洗行内代码之外的片段。
 * @param text - 一段文本。
 * @returns 行内代码保持原样，其余片段交给 prose scrubber。
 */
function scrubOutsideInlineCode(text) {
  let out = "";
  let cursor = 0;
  for (const match of text.matchAll(/(`+)([\s\S]*?)\1/g)) {
    const index = match.index ?? 0;
    out += scrubProse(text.slice(cursor, index));
    out += match[0];
    cursor = index + match[0].length;
  }
  return out + scrubProse(text.slice(cursor));
}

/**
 * 用 TypeScript parser 收集真实注释范围，只变换注释 token。
 * @param text - TS/JS 文件原文。
 * @returns 清洗后的文件原文。
 */
function scrubCode(text) {
  const source = ts.createSourceFile("scrub-input.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const comments = new Map();
  const addRanges = (ranges) => {
    for (const range of ranges ?? []) comments.set(`${range.pos}:${range.end}`, range);
  };
  const walk = (node) => {
    addRanges(ts.getLeadingCommentRanges(text, node.pos));
    addRanges(ts.getTrailingCommentRanges(text, node.end));
    for (const child of node.getChildren(source)) walk(child);
  };
  walk(source);

  let out = "";
  let cursor = 0;
  for (const range of [...comments.values()].sort((left, right) => left.pos - right.pos)) {
    if (range.pos < cursor) continue;
    out += text.slice(cursor, range.pos);
    out += scrubOutsideInlineCode(text.slice(range.pos, range.end));
    cursor = range.end;
  }
  return out + text.slice(cursor);
}

/**
 * 识别 Markdown 围栏 opener。
 * @param line - 一行文本。
 * @returns 围栏信息；不是 opener 时返回 undefined。
 */
function fenceOpener(line) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ""));
  if (match === null) return undefined;
  const marker = match[1];
  // CommonMark：反引号围栏的 info string 不能含反引号，单行 code span 不是 opener。
  if (marker[0] === "`" && match[2].includes("`")) return undefined;
  return { char: marker[0], length: marker.length };
}

/**
 * 判断一行是否为有效围栏 closer。
 * @param line - 一行文本。
 * @param fence - opener 信息。
 * @returns 是否为 closer。
 */
function fenceCloser(line, fence) {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line.replace(/\r$/, ""));
  return match !== null && match[1][0] === fence.char && match[1].length >= fence.length;
}

/**
 * 清洗 Markdown：围栏代码、缩进代码原样保留，其余正文按完整段处理。
 * @param text - Markdown 原文。
 * @returns 清洗后的 Markdown。
 */
function scrubMarkdown(text) {
  const lines = text.split("\n");
  const out = [];
  let prose = [];
  let fence;
  const flush = () => {
    if (prose.length === 0) return;
    out.push(scrubOutsideInlineCode(prose.join("\n")));
    prose = [];
  };
  for (const line of lines) {
    if (fence !== undefined) {
      out.push(line);
      if (fenceCloser(line, fence)) fence = undefined;
      continue;
    }
    const opener = fenceOpener(line);
    if (opener !== undefined) {
      flush();
      out.push(line);
      fence = opener;
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) {
      flush();
      out.push(line);
      continue;
    }
    prose.push(line);
  }
  flush();
  return out.join("\n");
}

/**
 * 按扩展名清洗文件。
 * @param text - 文件原文。
 * @param ext - 扩展名。
 * @returns 清洗后的文件原文。
 */
export function scrubText(text, ext) {
  return ext === ".md" ? scrubMarkdown(text) : scrubCode(text);
}

/**
 * 递归收集白名单扩展名的文件。
 * @param dir - 起始目录。
 * @param out - 收集结果。
 */
function collect(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, out);
      continue;
    }
    if (entry.isFile() && EXTS.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
}

/** 主流程。 */
function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const dirAt = argv.indexOf("--dir");
  if (dirAt >= 0 && (argv[dirAt + 1] === undefined || argv[dirAt + 1].startsWith("--"))) {
    throw new Error("--dir 需要一个目录参数");
  }
  const roots = dirAt >= 0 ? [argv[dirAt + 1]] : ROOTS;
  if (dirAt >= 0 && !statSync(roots[0]).isDirectory()) throw new Error(`--dir 不是目录：${roots[0]}`);

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

    const beforeLines = text.split("\n");
    const ext = file.slice(file.lastIndexOf("."));
    const nextLines = scrubText(text, ext).split("\n");
    let touched = false;
    for (let index = 0; index < Math.max(beforeLines.length, nextLines.length); index += 1) {
      const beforeLine = beforeLines[index] ?? "";
      const afterLine = nextLines[index] ?? "";
      if (afterLine === beforeLine) continue;
      touched = true;
      changedLines += 1;
      if (samples.length < 12) samples.push({ file, before: beforeLine.trim(), after: afterLine.trim() });
    }
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

if (process.argv[1] !== undefined) {
  const invoked = resolve(process.argv[1]);
  const self = fileURLToPath(import.meta.url);
  if (invoked === self || (process.platform === "win32" && invoked.toLowerCase() === self.toLowerCase())) main();
}
