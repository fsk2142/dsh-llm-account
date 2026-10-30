/**
 * `scripts/release-cli.mjs` 与 `release-git.mjs` 的类型声明。
 *
 * 脚本是纯 `.mjs`（Node 直接跑），但测试要 import —— 没有声明文件时 tsc 会把它们
 * 当 `any` 并连带报一串隐式 any。这里给出真实签名。
 */

/** 发版 CLI 的解析结果。 */
export interface ReleaseArgs {
  mode: "dry-run" | "release-only" | "full";
  dryRun: boolean;
  tag: string | undefined;
  note: string;
}

/**
 * 解析发版 CLI 参数。
 * @param argv - `process.argv.slice(2)`。
 * @returns 解析结果；冲突/缺值/未知 flag 抛错。
 */
export declare function parseReleaseArgs(argv: readonly string[]): ReleaseArgs;
