/**
 * 价格表：**厂商真实价** 与 **DeepSeek 官方价**（两种口径）。
 *
 * 两条纪律：
 * 1. **只写能确证的价格**。厂商没公开逐模型 token 单价的（Command Code 是订阅 credit 制），
 *    宁可不填 —— `undefined` 在界面上显示成「价格未知」，绝不编一个数字冒充账单。
 * 2. 价格随厂商调整。这里集中一处，改价只改这个文件；每条都写明来源与取价日期。
 * @module dsh-llm-account/src/core/pricing
 */
import type { TokenPrice } from "./usage-stats";

/** 一组计价表：模型 id（**小写**比较）→ 每 100 万 token 的美元价。 */
export type PriceTable = Readonly<Record<string, TokenPrice>>;

/**
 * DeepSeek 官方牌价（2026-10-19 取自 api-docs.deepseek.com/quick_start/pricing）。
 *
 * 文档区分**峰谷两档**：高峰为 UTC 周一至周五 01:00–04:00 与 06:00–10:00（不含中国
 * 法定节假日），其余（含周末与节假日）为低谷；低谷是高峰的一半。
 * 这里用**高峰价**折算 —— 折算价值是「最多要花多少」的上界，比用低谷价更诚实的口径；
 * 需要精确到时段的话，后续可以按请求时间判定峰谷。
 *
 * 注意：官方把 `deepseek-flash` 作为模型名（历史名 `deepseek-v4-flash` 仍被接受，
 * 按 Flash 计费），Pro 名为 `deepseek-v4-pro`。
 */
export const DEEPSEEK_OFFICIAL_PRICES: PriceTable = {
  // 1M input（cache hit）$0.006 /（cache miss）$0.30 / output $1.20（高峰价）
  "deepseek-flash": { input: 0.3, cacheRead: 0.006, cacheWrite: 0.3, output: 1.2 },
  "deepseek-v4-flash": { input: 0.3, cacheRead: 0.006, cacheWrite: 0.3, output: 1.2 },
  "deepseek-v4.1-flash": { input: 0.3, cacheRead: 0.006, cacheWrite: 0.3, output: 1.2 },
  // 1M input（cache hit）$0.044 /（cache miss）$1.32 / output $3.96（高峰价）
  "deepseek-v4-pro": { input: 1.32, cacheRead: 0.044, cacheWrite: 1.32, output: 3.96 },
};

/**
 * 厂商真实价（能确证的才写）。
 *
 * - **Command Code**：订阅 + credit 制，官方定价页只给「每月多少 credit」与「约多少次
 *   请求」，**不公布逐模型 token 单价** → 这里留空。额度接口本身就按美元记账
 *   （`quota.ts` 的窗口 `used/cap` 是美元），所以「本周期花了多少钱」可以从额度差直接读，
 *   不需要我们从 token 反推。
 * - **OpenCode Go**：订阅制（免费档 + 付费档），同样不公布逐 token 价 → 留空。
 * - **Open Design**：`vela billing preflight` 直接给美元消耗（`usedCredits`），
 *   也不需要 token×单价。
 *
 * 因此**本表当前是空的**，界面会显示「厂商价未公开」。这不是缺陷：把订阅制的费用
 * 硬摊成 token 单价只会给出假数字。等厂商公布逐模型价时，往这里加即可。
 */
export const VENDOR_PRICES: Readonly<Record<string, PriceTable>> = {};

/** 规范化模型名用于查表（小写、去空白；保留 `/` 与 `.`）。 */
export function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

/**
 * 在一个价格表里查模型价。
 *
 * 依次尝试：完整 id → 最后一段（`deepseek/deepseek-v4.1-flash` → `deepseek-v4.1-flash`）
 * → 去掉 `-`/`.` 的简化形式。厂商在不同接口里对同一模型的写法并不一致，写死一种匹配
 * 会让「明明有价却显示未知」。
 * @param table - 价格表。
 * @param model - 模型 id。
 * @returns 价格，或 `undefined`。
 */
export function lookupPrice(table: PriceTable | undefined, model: string): TokenPrice | undefined {
  if (table === undefined) return undefined;
  const id = normalizeModelId(model);
  if (id === "") return undefined;
  const direct = table[id];
  if (direct !== undefined) return direct;
  const tail = id.slice(id.lastIndexOf("/") + 1);
  if (tail !== id && table[tail] !== undefined) return table[tail]!;
  const loose = (value: string): string => value.replace(/[-.]/gu, "");
  const wanted = loose(tail);
  for (const [key, price] of Object.entries(table)) {
    if (loose(key) === wanted) return price;
  }
  return undefined;
}

/** 取 DeepSeek 官方价。 */
export function officialPriceOf(model: string): TokenPrice | undefined {
  return lookupPrice(DEEPSEEK_OFFICIAL_PRICES, model);
}

/** 取某个厂商的真实价。 */
export function vendorPriceOf(vendor: string): (model: string) => TokenPrice | undefined {
  const table = VENDOR_PRICES[vendor];
  return (model: string) => lookupPrice(table, model);
}
