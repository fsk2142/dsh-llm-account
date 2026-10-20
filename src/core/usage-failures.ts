/**
 * 失败明细：把台账里的失败记录按**分类**收成几行（纯函数）。
 *
 * 为什么需要：台账早就在记 `failureKind`（实测出现过 `network`），但界面从来没有读过它 ——
 * 用户只看到一个「成功率 99.6%」的百分比，报障时无从判断是网络抖动、限额，还是凭据失效。
 * 这一类问题的排查成本几乎全在「区分原因」上，而原因其实已经落盘了。
 *
 * 纪律与项目其余部分一致：
 * - **缺失不是 0**：没有 `failureKind` 的失败单独归成 `unknown`，绝不悄悄丢掉；
 * - 一条失败都没有时返回**空数组**，不返回一条全 0 的行（界面据此不渲染这一块）。
 * @module dsh-llm-account/src/core/usage-failures
 */
import type { UsageRecord } from "./usage-stats";

/** 没有分类名时的归类键（不是空串：界面要能对它取词）。 */
export const UNKNOWN_FAILURE_KIND = "unknown";

/** 一类失败。 */
export interface FailureKindRow {
  /** 分类键（`FailureKind` 的成员，或 {@link UNKNOWN_FAILURE_KIND}）。 */
  kind: string;
  /** 这条分类下的失败次数。 */
  count: number;
}

/** 一类失败 + 最近一次的线索（报障时用来对时间/账号）。 */
export interface FailureKindSummary extends FailureKindRow {
  /** 这一类里**最近一次**失败的时刻（epoch 毫秒）。 */
  lastAt: number;
  /** 最近一次失败发生在哪个账号。 */
  lastAccount: string;
}

/** 一条失败的分类键：缺了就归 `unknown`。 */
function kindOf(record: UsageRecord): string {
  const kind = record.failureKind;
  return typeof kind === "string" && kind.trim() !== "" ? kind.trim() : UNKNOWN_FAILURE_KIND;
}

/**
 * 按分类计数（只统计失败记录）。
 *
 * 排序：次数降序 → 分类名升序。第二个键不是装饰：没有它时同次数的两类谁在前取决于记录顺序，
 * 而记录顺序会随台账重读变化，界面就会莫名跳动。
 * @param records - 台账记录（成功的会被忽略）。
 * @returns 计数行；没有失败时为空数组。
 */
export function groupFailuresByKind(records: readonly UsageRecord[]): FailureKindRow[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.outcome !== "failure") continue;
    const kind = kindOf(record);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]): FailureKindRow => ({ kind, count }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
}

/**
 * 按分类计数，并带上**最近一次**失败的线索。
 * @param records - 台账记录。
 * @returns 汇总行；没有失败时为空数组。
 */
export function failureBreakdownOf(records: readonly UsageRecord[]): FailureKindSummary[] {
  const rows = new Map<string, FailureKindSummary>();
  for (const record of records) {
    if (record.outcome !== "failure") continue;
    const kind = kindOf(record);
    const existing = rows.get(kind);
    if (existing === undefined) {
      rows.set(kind, { kind, count: 1, lastAt: record.at, lastAccount: record.account });
      continue;
    }
    existing.count += 1;
    // 「最近」按时刻比，不按记录顺序：台账按时间升序读，但调用方可能先排序/裁剪过。
    if (record.at >= existing.lastAt) {
      existing.lastAt = record.at;
      existing.lastAccount = record.account;
    }
  }
  return [...rows.values()].sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
}
