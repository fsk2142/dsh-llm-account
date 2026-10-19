/**
 * 「**最近一次请求是哪个账号**」—— 侧边栏跟随当前会话的依据。
 *
 * 需求（用户 2026-10-19）：「改成我当前前端显示的是哪个会话页面就根据该会话的模型所属账号
 * 显示当前账号信息，就不需要进行轮播显示了」。
 *
 * ## 为什么不是「当前显示的会话」
 *
 * 宿主的 `remote.session` 只能**按 sessionId 查询**（`session.prompt` / `session.follow` /
 * `session.page` 等都要显式传 `sessionId`），**没有**「前端当前打开的是哪个会话」这种接口
 * ——2026-10-19 扫描过 asar 里全部 `remote.session` 调用点与 `activeSession` /
 * `currentSession` 这类状态名，都不存在。侧边栏是独立于会话页面的组件，拿不到那个状态。
 *
 * ## 所以用「最近一次请求」代替
 *
 * 每次请求都带着 `sessionId` 与 `model`，而**刚刚发过请求的那个会话，几乎必然就是用户正在
 * 看的那个**（他刚在里面打了字）。台账里每条记录都有 `vendor` / `account` / `model` / `at`，
 * 所以这件事不需要任何新接口，也**不需要额外网络请求**。
 *
 * 措辞纪律：这是「最近一次请求的账号」，不是「当前会话的账号」。两者在绝大多数时候相同，
 * 但用户如果只是翻看一个旧会话而没发消息，显示的会是上一次真正发过请求的账号。界面上的
 * 文案必须说清这一点，不能假装它是实时跟随。
 * @module dsh-llm-account/src/core/last-used
 */
import type { UsageRecord } from "./usage-stats";

/** 一次「最近使用的账号」读数。 */
export interface LastUsedAccount {
  /** 厂商 id。 */
  vendor: string;
  /** 账号 ref。 */
  account: string;
  /** 那次请求用的模型（可能为空串：匿名或未知）。 */
  model: string;
  /** 那次请求的时刻（epoch 毫秒）。 */
  at: number;
}

/**
 * 从台账记录里找出**最近一次**（按时刻）属于**已登记账号**的请求。
 *
 * 为什么要过滤 `known`：台账里可能留着已经被删掉的账号（ref 不再存在），或者匿名的失败记录
 * （`account` 为空串）。拿它去侧边栏显示会得到一个对不上的名字。
 *
 * @param records - 台账记录（任意顺序）。
 * @param known - 判断一个 (vendor, account) 是否仍然存在；缺省表示全收。
 * @returns 最近一次读数；没有可用记录时 `undefined`。
 */
export function lastUsedAccountOf(
  records: readonly UsageRecord[],
  known?: (vendor: string, account: string) => boolean,
): LastUsedAccount | undefined {
  let best: UsageRecord | undefined;
  for (const record of records) {
    if (typeof record.account !== "string" || record.account === "") continue;
    if (typeof record.vendor !== "string" || record.vendor === "") continue;
    if (!Number.isFinite(record.at) || record.at <= 0) continue;
    if (known !== undefined && !known(record.vendor, record.account)) continue;
    if (best === undefined || record.at > best.at) best = record;
  }
  if (best === undefined) return undefined;
  return {
    vendor: best.vendor,
    account: best.account,
    model: typeof best.model === "string" ? best.model : "",
    at: best.at,
  };
}

/**
 * 这次读数还「新鲜」吗（用于决定要不要作为「当前账号」显示）。
 *
 * 为什么需要期限：如果用户一整天没发过请求，那「最近一次」是昨天的 —— 把它当成「当前」显示
 * 会误导。超过期限就退回轮播（或按标签页顺序显示第一家）。
 * @param at - 那次请求的时刻（epoch 毫秒）。
 * @param now - 现在。
 * @param ttlMs - 期限（毫秒）；缺省 30 分钟。
 * @returns 是否仍然新鲜。
 */
export function isLastUsedFresh(at: number, now: number, ttlMs: number = DEFAULT_FRESH_TTL_MS): boolean {
  if (!Number.isFinite(at) || at <= 0) return false;
  const age = now - at;
  // 时钟回拨（age 为负）也当作新鲜：宁可显示刚用过的那一个，也不要在时钟抖动时闪回第一家。
  return age <= ttlMs;
}

/** 「最近用过」的默认新鲜期：30 分钟。 */
export const DEFAULT_FRESH_TTL_MS = 30 * 60_000;
