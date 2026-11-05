/**
 * `scripts/commit-titles.mjs` 的类型声明。
 *
 * 为什么需要：那个脚本是 `.mjs`（无类型），而 `tests/scripts/commit-titles.test.ts`
 * 要 import 它来测规则。没有这份声明，`tsc` 会报 TS7016（隐式 any）—— 那会让
 * `typecheck` 失败，也会让测试里的 `result.failed[0]?.problems` 之类访问失去检查。
 */

/** 一条待检查的提交。 */
export interface CommitRow {
  /** 完整 40 位 SHA（豁免按它精确匹配）。 */
  sha: string;
  /** 提交首行。 */
  subject: string;
}

/** 一条硬问题的归属。 */
export interface TitleFailure {
  subject: string;
  problems: string[];
}

/** 一条「超过建议长度」的提示。 */
export interface TitleLongHint {
  subject: string;
  len: number;
}

/** 一条「疑似两件事」的软提示。 */
export interface TitleHint {
  subject: string;
  hint: string;
}

/** `partition()` 的结论。 */
export interface PartitionResult {
  /** 有硬问题、会让检查失败的提交。 */
  failed: TitleFailure[];
  /** 超过建议长度（不阻塞）。 */
  long: TitleLongHint[];
  /** 含 ` + ` 的可疑标题（不阻塞）。 */
  hinted: TitleHint[];
  /** 按 SHA 豁免掉的条数。 */
  exempted: number;
  /** 实际参与判定的条数（总数减豁免）。 */
  checked: number;
}

/** 允许的 type 前缀。 */
export declare const TYPES: readonly string[];
/** 标题硬上限（GitHub 的截断点）。 */
export declare const MAX_LEN: number;
/** 建议上限（超了只提示）。 */
export declare const SOFT_LEN: number;
/** 已发布、按 SHA 精确豁免的提交。 */
export declare const GRANDFATHERED: ReadonlySet<string>;

/**
 * 一条标题的硬问题。
 * @param subject - 提交首行。
 * @returns 问题列表；空数组表示合规。
 */
export declare function problemsOf(subject: string): string[];

/**
 * 一条标题的软信号。
 * @param subject - 提交首行。
 * @returns 提示或 `undefined`。
 */
export declare function hintOf(subject: string): string | undefined;

/**
 * 把提交列表分区成失败 / 超长 / 软提示。
 * @param commits - `{ sha, subject }` 列表。
 * @returns 分区结论。
 */
export declare function partition(commits: readonly CommitRow[]): PartitionResult;
