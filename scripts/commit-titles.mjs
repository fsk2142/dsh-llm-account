/**
 * 提交标题规则的**纯逻辑**（可 import，无副作用）。
 *
 * ## 为什么拆出来
 *
 * `scripts/release-git.mjs` 的那次教训（第五轮复审 F03）：把逻辑**复制**进测试文件
 * 再测副本，等于测了个假货 —— 生产代码改坏了测试照样绿。这里同理，标题规则必须
 * 被测试直接调用**同一份实现**。
 *
 * 所以：本模块只导出纯函数；`check-commit-titles.mjs` 负责读 git 与打印。
 *
 * @module dsh-llm-account/scripts/commit-titles
 */

/** 允许的 type 前缀。 */
export const TYPES = ["feat", "fix", "chore", "docs", "test", "refactor", "style", "build", "perf", "revert"];

/** 标题硬上限（GitHub 会截断）。 */
export const MAX_LEN = 72;
/** 建议上限（超了给提示，不失败）。 */
export const SOFT_LEN = 50;

/**
 * **已发布历史里已知超长的提交**（按 SHA 精确豁免，2026-11-05）。
 *
 * ## 为什么需要例外
 *
 * 2026-11-04 的 1.9.12 提交标题是 74 字符：
 *
 * ```
 * fix: project assistant history images without blocking compaction (1.9.12)
 * ```
 *
 * 它已经随 `v1.9.12` / `v2.0.0` 发布。`--limit 5` 会把它扫进来，于是 CI 的
 * 「提交标题规范」步骤**每次都红**，v2.0.0 的 Release 就挂着一个失败徽章。
 *
 * 两条路：
 *
 * 1. 改写历史重打已发布的 tag —— 所有协作者得重新 clone，风险远大于收益；
 * 2. **按 SHA 精确豁免这一条**，未来提交仍必须 ≤ 72。
 *
 * 选 2。豁免必须写成完整 40 位 SHA：短 SHA 会随仓库增长产生歧义，也可能被将来的
 * 提交撞上。集合**只增不改**。
 *
 * ## 什么时候可以删
 *
 * 当 `--limit N` 的窗口彻底滑过这些提交之后（它们不再是「最近 N 条」），条目就再也
 * 匹配不到任何输入，那时可以清空。
 */
export const GRANDFATHERED = new Set([
  // 1.9.12：74 字符，已随 v1.9.12 / v2.0.0 发布。
  "d9036c3ea20363231ce16af6c3185e12cf6c9ff9",
]);

/**
 * 标题里的**硬问题**（任何一条都让检查失败）。
 * @param subject - 提交首行。
 * @returns 问题描述列表；空数组表示合规。
 */
export function problemsOf(subject) {
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
  return problems;
}

/**
 * 标题里的「软信号」：不阻塞，但值得提醒。
 *
 * ` + ` 只在**两侧都是动宾短语**时才算「做了两件事」。像
 * `重写为「功能 + 操作」两段结构` 里的 ` + ` 是在描述一个结构名，
 * 不是两件事 —— 直接当错误会误伤。所以这条降级为提示。
 * @param subject - 提交首行。
 * @returns 提示文本，或 `undefined`。
 */
export function hintOf(subject) {
  if (!/ \+ /.test(subject)) return undefined;
  // 去掉引号/括号里的内容再看：`「功能 + 操作」` 这种不算两件事。
  const outside = subject.replace(/「[^」]*」|\([^)]*\)|（[^）]*）/g, "");
  return / \+ /.test(outside) ? "标题里出现「 + 」，确认是否一个提交做了两件事" : undefined;
}

/**
 * 把「提交列表」分区成 失败 / 超长提示 / 软信号提示。
 *
 * **豁免按 SHA 判定，不按标题**：同一个标题如果将来被另一个提交原样复用，
 * 那个新提交必须重新受长度约束。
 * @param commits - `{ sha, subject }` 列表。
 * @returns 分区结果（含被豁免的条数）。
 */
export function partition(commits) {
  const failed = [];
  const long = [];
  const hinted = [];
  let exempted = 0;

  for (const commit of commits) {
    if (GRANDFATHERED.has(commit.sha)) {
      exempted += 1;
      continue;
    }
    const problems = problemsOf(commit.subject);
    if (problems.length > 0) {
      failed.push({ subject: commit.subject, problems });
      continue;
    }
    if (commit.subject.length > SOFT_LEN) long.push({ subject: commit.subject, len: commit.subject.length });
    const hint = hintOf(commit.subject);
    if (hint !== undefined) hinted.push({ subject: commit.subject, hint });
  }

  return { failed, long, hinted, exempted, checked: commits.length - exempted };
}
