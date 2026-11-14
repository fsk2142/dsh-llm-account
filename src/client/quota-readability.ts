/**
 * 额度读数的「可读性」判定（2026-11-14 修「账号额度经常读取失效」）。
 *
 * ## 这个模块解决什么问题
 *
 * 三家的额度读数都带一个 `failures: string[]`。原来客户端一刀切：**只要有任一条**，
 * 就判这份读数不可信 —— 界面显示「读取失效」、缓存不更新、轮询退避翻倍。
 *
 * 但那两类失败的意义完全不同：
 *
 * | 类别 | 例子 | 余额/窗口还准吗 |
 * | --- | --- | --- |
 * | **致命** | 账单摘要读失败、账号整个读不到 | **不准** |
 * | **非致命** | 周期额度（5 小时/周）读不到、vela 身份不匹配 | **仍然准** |
 *
 * `opendesign/quota.ts` 的失败文案里自己就写着「（余额与套餐仍然准确）」，
 * 而同一个仓库的判定代码却把它当致命 —— 两处自相矛盾。
 *
 * ## 修法：多一个字段，而不是改语义
 *
 * 读数新增可选的 `failuresFatal`（只有真正让余额/窗口不可信的那些）。
 * `failures` 保持**全部**文案（界面照旧一条不丢）。判定只读 `failuresFatal`。
 *
 * ## 为什么老宿主回落到旧语义
 *
 * 不带 `failuresFatal` 的读数来自**旧版宿主**。对它一律按「`failures` 非空即不可信」
 * 处理 —— 宁可保守，也不要让一个不认识新字段的版本突然把坏数据当成可信。
 * 只有**明确给出**空数组（新宿主说「没有致命失败」）才放宽。
 *
 * @module dsh-llm-account/src/client/quota-readability
 */

/** 判定只看这两个字段（其余字段不影响可读性）。 */
export interface QuotaReadabilityInput {
  /** 额度窗口；空数组表示「这块没数据」。 */
  windows?: unknown;
  /** 全部失败文案。 */
  failures?: unknown;
  /**
   * **致命**失败（让余额/窗口不可信的那些）。
   *
   * 缺省 ≠ 空数组：
   * - `undefined`（含字段不存在）→ 老宿主，回落到旧语义；
   * - `[]` → 新宿主明确说「没有致命失败」，只看其余条件。
   */
  failuresFatal?: unknown;
}

/** 字符串数组守卫（边界值形状不可信）。 */
function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * 这份额度读数是否可信。
 *
 * 三个条件全部满足才算可读：
 * 1. 有至少一个窗口（没有窗口就是「没数据」，与「有数据但为 0」不同）；
 * 2. 没有**致命**失败；
 * 3. （老宿主）没有**任何**失败。
 *
 * @param quota - 一个账号的额度读数（形状不可信，逐字段收窄）。
 * @returns 是否可读。
 */
export function readableQuotaOf(quota: QuotaReadabilityInput | undefined): boolean {
  if (quota === undefined || typeof quota !== "object" || quota === null) return false;
  if (!Array.isArray(quota.windows) || quota.windows.length === 0) return false;

  const fatalRaw = quota.failuresFatal;
  if (fatalRaw !== undefined) {
    // 新宿主：只认致命项。形状不认识时按「有致命失败」保守处理。
    return isStringArray(fatalRaw) && fatalRaw.length === 0;
  }

  /*
   * 老宿主（没有 `failuresFatal`）：回落旧语义 —— `failures` 非空即不可信。
   * 形状不认识时同样保守（不认识的读数不该被当成可信）。
   */
  if (!isStringArray(quota.failures)) return quota.failures === undefined;
  return quota.failures.length === 0;
}
