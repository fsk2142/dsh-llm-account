/**
 * **账号是否已失效**的判定（`/billing/summary` 负载 → 布尔）。
 *
 * ## 用户口径（2026-11-23 定稿）
 *
 * 「订阅失效 **并且** 余额小于 1 美元就认为账号失效」。余额可能是负数，所以判据是
 * `< 1` 而不是 `<= 0`。
 *
 * ## 为什么两个条件都必须满足
 *
 * 真机实测（2026-11-22）两个免费号：`membershipTier: null` + `totalAvailableCreditsUsd: "0"`，
 * 而 go 会员号的余额**同样是 0** —— 但它有生效订阅，照样能发请求。
 * 只看余额会把付了钱的账号也判死；只看订阅会把「没订阅但充了钱」的按量付费账号判死。
 *
 * ## 为什么读不到就不判
 *
 * 这是一条**会永久排除账号**的判定：判错一次，那个账号再也不会被选中。所以：
 * - 摘要读失败 → 不判（保留上次结论，交给下次成功的读取更新）；
 * - 余额字段缺失/非数字 → 不判（宁可不标，也不许错杀）。
 *
 * 这与「余额不足」的额度展示是两件事：那里缺失就什么都不画，这里有缺失就什么都不改。
 * @module dsh-llm-account/src/vendors/opendesign/liveness
 */
import type { LivenessVerdict } from "../../core/adapter";

/** 判死门槛：可用余额低于这个美元数就算「不够用」。 */
export const DEAD_BALANCE_USD = 1;

/** 订阅状态里明确表示「不再服务」的取值（去除非字母数字后小写比对）。 */
const DEAD_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "cancelled",
  "expired",
  "inactive",
  "pastdue",
  "unpaid",
  "suspended",
  "ended",
  "terminated",
]);

/** 判定一个值是否为普通对象（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读一个非空字符串（去首尾空白）。 */
function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * 读数字：接受数字与数字字符串（`"0.0000"` 是线上真实形状）。
 *
 * **不把 `null` 读成 0** —— 那是「厂商没报」，不是「余额是零」。把没报当零会误杀账号。
 * @param value - 原始字段值。
 * @returns 有限数值，或 `undefined`。
 */
function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const text = stringValue(value);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 读负载本体：`{ data: … }` 包一层与平铺两种形状都认。 */
function payloadRecord(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  return isRecord(payload.data) ? payload.data : payload;
}

/** 按候选名单取第一个存在的值（含 `subscription` 子对象）。 */
function pick(record: Record<string, unknown>, names: readonly string[]): unknown {
  const nested = isRecord(record.subscription) ? record.subscription : undefined;
  for (const name of names) {
    const value = record[name] ?? nested?.[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * 读可用余额（美元）。
 *
 * 优先 `totalAvailableCreditsUsd`（厂商直接给的美元数），其次 `balanceUsd`，
 * 最后用 `balances.totalAvailableCredits ÷ creditsPerUsd` 折出来 —— 与额度窗口
 * 用的是同一套换算率（见 `quota.ts` 的 `creditsPerUsdOf`）。
 * @param record - 账单摘要记录。
 * @returns 美元余额；读不到时为 `undefined`。
 */
function availableUsdOf(record: Record<string, unknown>): number | undefined {
  const direct = numberValue(pick(record, ["totalAvailableCreditsUsd", "availableBalanceUsd", "balanceUsd"]));
  if (direct !== undefined) return direct;
  const balances = record.balances;
  if (!isRecord(balances)) return undefined;
  const credits = numberValue(balances.totalAvailableCredits);
  if (credits === undefined) return undefined;
  const perUsd = numberValue(record.creditsPerUsd);
  return perUsd !== undefined && perUsd > 0 ? credits / perUsd : undefined;
}

/**
 * 判定账号是否因为「没订阅 + 没钱」而不可用。
 *
 * @param summary - `/billing/summary` 的负载（**必须是成功读取的那一份**）。
 * @returns 判定结果；无法判定时 `{ decided: false }`（调用方保留上次结论）。
 */
export function livenessOf(summary: unknown): LivenessVerdict {
  const record = payloadRecord(summary);
  if (record === undefined) return { decided: false };

  const tier = stringValue(pick(record, ["membershipTier", "membership", "tier", "plan", "subscriptionTier"]));
  const statusRaw = stringValue(
    pick(record, ["subscriptionStatus", "status", "subscriptionState", "subscriptionEntitlementStatus"]),
  );
  const status = statusRaw?.replace(/[^a-z0-9]/gi, "").toLowerCase();

  /*
   * 有没有**生效中的订阅**：
   * - 有档位且状态不是「明确不再服务」→ 有（状态缺失时也按有：档位存在说明买过）；
   * - 状态明确是取消/过期/欠费 → 没有（即使档位字段还留着旧值）。
   */
  const hasSubscription =
    tier !== undefined && (status === undefined || !DEAD_SUBSCRIPTION_STATUSES.has(status));

  const usd = availableUsdOf(record);
  if (usd === undefined) {
    // 余额读不到：**不判**。「买过订阅但状态栏空了」这类模糊负载也不判。
    return { decided: false };
  }

  if (hasSubscription) {
    // 有生效订阅：无论余额多少都不算失效（go 会员的余额也是 0，但能正常发请求）。
    return { decided: true, dead: false };
  }

  if (usd >= DEAD_BALANCE_USD) {
    // 没订阅但有余额：按量付费照样能用，不能判死。
    return { decided: true, dead: false };
  }

  return {
    decided: true,
    dead: true,
    reason:
      tier === undefined
        ? `未订阅，且可用余额 $${usd.toFixed(2)} 低于 $${DEAD_BALANCE_USD}`
        : `订阅状态为「${statusRaw ?? "未知"}」，且可用余额 $${usd.toFixed(2)} 低于 $${DEAD_BALANCE_USD}`,
  };
}
