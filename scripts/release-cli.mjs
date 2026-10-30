#!/usr/bin/env node
/**
 * 发版 CLI 的**参数解析**（纯函数，可导入、可测试）。
 *
 * ## 为什么需要它
 *
 * 原来 `main()` 里是这样读参数的：
 *
 * ```js
 * const dryRun = argv.includes("--dry-run");
 * const i = argv.indexOf("--release-only");
 * const tag = i >= 0 ? (argv[i + 1] ?? "") : undefined;
 * if (tag !== undefined && tag !== "") { await publishRelease(...); return; }  // ← 先返回
 * if (dryRun) return;                                                        // ← 永远走不到
 * ```
 *
 * 两个安全缺陷（第六轮复审 V55-01）：
 *
 * 1. **`--dry-run` 对 `--release-only` 完全无效** —— 那个分支在 dryRun 检查之前
 *    就执行并返回了。`node scripts/release.mjs --release-only v1.5.5 --dry-run`
 *    真的会去 POST 建 Release。
 * 2. **`--release-only` 漏传 tag 会掉进完整发版** —— 那个位置是 `undefined`，
 *    转成空串后分支不成立，于是继续往下走版本计算、构建、推送。
 *
 * ## 做法
 *
 * 把参数解析成**互斥模式**，在任何 Git/HTTP 动作之前校验完毕：
 * - `dry-run`：只读预览；
 * - `release-only`：只补建 Release（必须带 tag）；
 * - `full`：完整发版。
 *
 * 冲突、缺值、未知 flag 一律抛错 —— 不做「猜用户想要什么」。
 * @module scripts/release-cli
 */

/** 认识的 flag。出现别的 `--xxx` 一律报错（防手误拼错后静默进入另一模式）。 */
const KNOWN_FLAGS = ["--dry-run", "--release-only", "--note"];

/**
 * 解析发版 CLI 参数。
 *
 * 模式判定（互斥，按此顺序）：
 *
 * 1. 出现 `--release-only` → `release-only`（必须带一个 `v...` 形态的值）；
 * 2. 否则出现 `--dry-run` → `dry-run`；
 * 3. 否则 → `full`。
 *
 * `--dry-run --release-only <tag>` 的组合**允许**，返回
 * `{ mode: "release-only", dryRun: true }` —— 调用方必须据此只预览、不发起任何
 * 写操作。这比「静默忽略 dry-run」安全：用户明确表达了「我要演练」。
 * @param {readonly string[]} argv - `process.argv.slice(2)`。
 * @returns {{ mode: "dry-run" | "release-only" | "full", dryRun: boolean, tag: string | undefined, note: string }} 解析结果。
 */
export function parseReleaseArgs(argv) {
  /** 逐项扫描，把 `--flag` 与其可选值配对。 */
  const values = new Map();
  const bare = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) {
      bare.push(arg);
      continue;
    }
    if (!KNOWN_FLAGS.includes(arg)) {
      throw new Error(
        `未知参数 ${arg}。认识的参数：${KNOWN_FLAGS.join(" / ")}。` +
          `（不认识就报错，免得拼错之后静默落进另一个模式。）`,
      );
    }
    // `--dry-run` 是开关；`--release-only` 与 `--note` 需要一个值。
    if (arg === "--dry-run") {
      values.set(arg, true);
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      const usage = arg === "--note" ? '--note "说明"' : "--release-only v1.5.0";
      throw new Error(`${arg} 缺少值。用法：${usage}`);
    }
    values.set(arg, next);
    index += 1;
  }
  if (bare.length > 0) {
    throw new Error(`多余的参数：${bare.join(" ")}。所有选项都以 -- 开头。`);
  }

  const rawNote = values.get("--note");
  const note = typeof rawNote === "string" ? rawNote : "";
  const dryRun = values.get("--dry-run") === true;
  const rawTag = values.get("--release-only");

  if (rawTag !== undefined) {
    const tag = String(rawTag).trim();
    if (tag === "") throw new Error("--release-only 需要一个 tag，收到空值。");
    if (!/^v\d+\.\d+\.\d+/u.test(tag)) {
      throw new Error(`--release-only 需要一个版本 tag（如 v1.5.0），收到：${tag}`);
    }
    return { mode: "release-only", dryRun, tag, note };
  }
  return { mode: dryRun ? "dry-run" : "full", dryRun, tag: undefined, note };
}
