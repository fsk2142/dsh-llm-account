/**
 * `scripts/release-git.mjs` 的类型声明。
 *
 * 脚本本身是纯 `.mjs`（Node 直接跑，不经 tsc），但测试要 import 它 —— 没有声明
 * 文件的话 tsc 会把它当 `any` 并连带报一串隐式 any。这里给出真实签名。
 */
export declare function git(cwd: string, args: string[], options?: Record<string, unknown>): string;

export declare function refExists(cwd: string, ref: string): boolean;

export declare function parseNulList(raw: string): string[];

/** 一条工作树变更记录。重命名/复制时 `from` 是原路径。 */
export interface StatusEntry {
  path: string;
  status: string;
  from?: string;
}

export declare function statusEntries(cwd: string): StatusEntry[];

export declare function statusPaths(cwd: string): string[];

export declare function existingPaths(cwd: string, candidates: readonly string[]): string[];

/** 正式发布标签的形态。 */
export declare const RELEASE_TAG: RegExp;

export declare function previousTagOf(cwd: string, tag: string): string | undefined;
