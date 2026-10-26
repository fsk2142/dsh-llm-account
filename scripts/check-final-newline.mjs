#!/usr/bin/env node
/**
 * 检查 `src/` 与 `tests/` 下每个文本文件的**末尾换行**。
 *
 * ## 为什么需要（2026-10-23）
 *
 * 这个卫生问题已经回归过两次：
 *
 * - 2026-10-22：扫全 `src` 补齐过一次（提交 `4006d9e`）；
 * - 2026-10-23：删行改代码时又丢了两个文件（`search-provider.ts`、`copy.ts`）。
 *
 * 靠人手扫不可靠 —— 编辑器与 `.editorconfig` 只在装了扩展时生效，而「删掉最后一行」
 * 的动作任何工具都不会拦。所以交给一个能跑在测试里的检查。
 *
 * ## 判据
 *
 * 只看**最后一个字节是不是 `\n`（0x0A）**。空文件跳过（没有内容就无所谓末尾换行）。
 *
 * 用法：
 *   node scripts/check-final-newline.mjs        # 检查，有问题则退出码 1
 *   node scripts/check-final-newline.mjs --fix  # 顺手补上
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 要检查的目录（相对仓库根）。
 *
 * `scripts/` 也纳入（2026-10-26 补）：`mutation-check.py` 曾在扫描范围之外，
 * 缺末尾换行只能靠人工发现。
 */
const ROOTS = ["src", "tests", "scripts"];

/** 扩展名白名单：只查我们手写的文本文件。 */
const EXTENSIONS = [".ts", ".mts", ".mjs", ".json", ".py"];

/** 递归收集文件。 */
function collect(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      collect(full, out);
      continue;
    }
    if (EXTENSIONS.some((ext) => name.endsWith(ext))) out.push(full);
  }
}

/** 主流程。 */
function main() {
  const fix = process.argv.includes("--fix");
  const files = [];
  for (const root of ROOTS) collect(root, files);

  const bad = [];
  for (const file of files) {
    let bytes;
    try {
      bytes = readFileSync(file);
    } catch {
      continue;
    }
    // 空文件跳过：没有内容就无所谓末尾换行。
    if (bytes.length === 0) continue;
    if (bytes[bytes.length - 1] === 0x0a) continue;

    bad.push(file);
    if (fix) writeFileSync(file, `${bytes.toString("utf8")}\n`, "utf8");
  }

  if (bad.length === 0) {
    console.log(`末尾换行：${files.length} 个文件全部正常`);
    return;
  }

  if (fix) {
    console.log(`末尾换行：已补齐 ${bad.length} 个文件`);
    for (const file of bad) console.log(`  + ${file}`);
    return;
  }

  console.error(`末尾换行：${bad.length} 个文件缺少（用 --fix 补齐）`);
  for (const file of bad) console.error(`  - ${file}`);
  process.exitCode = 1;
}

main();
