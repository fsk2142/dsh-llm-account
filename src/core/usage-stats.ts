/**
 * 用量统计：**纯数据层**（不碰网络、不碰文件、不碰 React）。
 *
 * 三件事，各自可以被单独测：
 * 1. 一次请求的用量记录（{@link UsageRecord}）如何从 `TokenUsage` 造出来；
 * 2. 按「厂商 + 账号 + 记账周期」聚合（{@link UsageBucket}）：请求数、成功/失败、token、
 *    缓存命中率、按厂商价与官方价两种口径算出的价值；
 * 3. 时间窗口（今日 / 近 7 天 / 近 30 天 / 全部）如何裁。
 *
 * 为什么强调「记账周期」：不同账号的额度窗口不一样（5 小时 / 周 / 月度），把一个账号的
 * token 摊到日历日上会让「本周期用了多少」失真。所以聚合的**第一等公民是周期**，
 * 今日/近 7 天这些只是给它加的一个**可选下界**（`since`）。
 * @module dsh-llm-account/src/core/usage-stats
 */

/** 一次请求的结果。 */
export type RequestOutcome = "success" | "failure";

/** 一次请求的用量记录（一次 adapter 调用一条）。 */
export interface UsageRecord {
  /** 厂商 id（`commandcode` / `dsh-opencode-go` / `opendesign`）。 */
  vendor: string;
  /** 账号 ref；匿名为空串（有些失败发生在选账号之前）。 */
  account: string;
  /** 记录时刻（epoch 毫秒）。 */
  at: number;
  /** 成功或失败。 */
  outcome: RequestOutcome;
  /** 未命中缓存的输入 token。 */
  inputTokens: number;
  /** 输出 token。 */
  outputTokens: number;
  /** 命中缓存的输入 token。 */
  cacheReadTokens: number;
  /** 写入缓存的 token。 */
  cacheWriteTokens: number;
  /** 实际使用的模型 id（计价要用；未知为空串）。 */
  model: string;
  /** 失败的分类（`outcome === "failure"` 时有意义）。 */
  failureKind?: string;
}

/** 一次请求的 token 汇总（与 {@link UsageRecord} 同名同义）。 */
export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** 一个周期的聚合结果。 */
export interface UsageBucket extends TokenCounts {
  /** 周期标识（由调用方给，例如 `2026-10` 或 `weekly`）。 */
  period: string;
  /** 这个周期开始的时间（epoch 毫秒），用于显示与排序。 */
  since: number;
  /** 请求总数。 */
  requests: number;
  /** 成功请求数。 */
  ok: number;
  /** 失败请求数。 */
  failed: number;
  /** 成功率（0–1）；没有请求时为 `undefined`（不是 0 —— 缺失不等于 0）。 */
  successRate: number | undefined;
  /**
   * 缓存命中率（0–1）= 缓存读 /（缓存读 + 未命中输入）。
   *
   * 分母里**不含输出**，也**不含缓存写**：写缓存是「这次没命中、但为下次准备」，
   * 把它算进分母会系统性地低估命中率。没有输入时为 `undefined`。
   */
  cacheHitRate: number | undefined;
  /** 按厂商真实价格算出的价值（美元）；价格表缺该模型时为 `undefined`。 */
  vendorCost: number | undefined;
  /** 同一批 token 按 DeepSeek 官方价折算的价值（美元）。 */
  officialCost: number | undefined;
}

/** 一条价格（每 100 万 token 的美元价）。 */
export interface TokenPrice {
  /** 未命中缓存的输入。 */
  input: number;
  /** 命中缓存的输入。 */
  cacheRead: number;
  /** 写缓存。 */
  cacheWrite: number;
  /** 输出。 */
  output: number;
}

/**
 * 把一份 `TokenUsage` 归一成 {@link TokenCounts}，缺字段按 0（**只在这里**允许补 0：
 * 统计口径需要可加的基准，而「这个字段厂商没报」与「这次用了 0 个」在聚合里等价）。
 * @param usage - 宿主或 adapter 给的用量（可能缺字段）。
 * @returns 四个计数。
 */
export function countsOf(usage?: Partial<TokenCounts> | undefined): TokenCounts {
  const pick = (value: number | undefined): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  return {
    inputTokens: pick(usage?.inputTokens),
    outputTokens: pick(usage?.outputTokens),
    cacheReadTokens: pick(usage?.cacheReadTokens),
    cacheWriteTokens: pick(usage?.cacheWriteTokens),
  };
}

/** 一条记录的 token 总数（分项相加；用于总量显示）。 */
export function totalTokensOf(counts: TokenCounts): number {
  return counts.inputTokens + counts.outputTokens + counts.cacheReadTokens + counts.cacheWriteTokens;
}

/**
 * 按价格表算一次成本（美元）。
 * @param counts - token 计数。
 * @param price - 每百万 token 的单价；`undefined` 表示没有该模型的价格。
 * @returns 美元金额；没有价格时为 `undefined`（**绝不返回 0 冒充「免费」**）。
 */
export function costOf(counts: TokenCounts, price: TokenPrice | undefined): number | undefined {
  if (price === undefined) return undefined;
  const perMillion = 1_000_000;
  return (
    (counts.inputTokens * price.input +
      counts.cacheReadTokens * price.cacheRead +
      counts.cacheWriteTokens * price.cacheWrite +
      counts.outputTokens * price.output) /
    perMillion
  );
}

/** 把若干计数累加进一个累加器（就地修改，纯计算）。 */
function addInto(target: TokenCounts, counts: TokenCounts): void {
  target.inputTokens += counts.inputTokens;
  target.outputTokens += counts.outputTokens;
  target.cacheReadTokens += counts.cacheReadTokens;
  target.cacheWriteTokens += counts.cacheWriteTokens;
}

/**
 * 聚合一批记录。
 *
 * @param records - 已按需要裁好的记录（窗口过滤由调用方做）。
 * @param period - 周期标识，写进结果。
 * @param since - 周期起点（epoch 毫秒）。
 * @param priceOf - 取某个模型的厂商价；没有则返回 `undefined`。
 * @param officialPriceOf - 取某个模型的 DeepSeek 官方价；没有则返回 `undefined`。
 * @returns 聚合结果；`records` 为空时各项计数为 0、比率与成本为 `undefined`。
 */
export function aggregateUsage(
  records: readonly UsageRecord[],
  period: string,
  since: number,
  priceOf: (model: string) => TokenPrice | undefined,
  officialPriceOf: (model: string) => TokenPrice | undefined,
): UsageBucket {
  const totals = countsOf();
  let requests = 0;
  let ok = 0;
  let vendorCost: number | undefined;
  let officialCost: number | undefined;

  for (const record of records) {
    const counts = countsOf(record);
    addInto(totals, counts);
    requests += 1;
    if (record.outcome === "success") ok += 1;
    // 成本逐条累加：不同记录可能是不同模型，不能先合并 token 再套一个价。
    const vendor = costOf(counts, priceOf(record.model));
    if (vendor !== undefined) vendorCost = (vendorCost ?? 0) + vendor;
    const official = costOf(counts, officialPriceOf(record.model));
    if (official !== undefined) officialCost = (officialCost ?? 0) + official;
  }

  const failed = requests - ok;
  // 命中率的分母：命中的 + 未命中的输入。写缓存不算（见字段注释）。
  const promptTokens = totals.cacheReadTokens + totals.inputTokens;
  return {
    period,
    since,
    ...totals,
    requests,
    ok,
    failed,
    successRate: requests === 0 ? undefined : ok / requests,
    cacheHitRate: promptTokens === 0 ? undefined : totals.cacheReadTokens / promptTokens,
    vendorCost,
    officialCost,
  };
}

/** 时间窗口：给聚合结果加一个下界。 */
export type UsageWindow = "today" | "7d" | "30d" | "all";

/** 一次窗口裁切的起点（epoch 毫秒）；`all` 返回 `undefined`。 */
export function windowStart(window: UsageWindow, now: number): number | undefined {
  if (window === "all") return undefined;
  const day = 86_400_000;
  if (window === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  if (window === "7d") return now - 7 * day;
  return now - 30 * day;
}

/**
 * 按窗口裁记录。
 * @param records - 全部记录。
 * @param window - 窗口。
 * @param now - 「现在」（注入，便于测试）。
 * @returns 落在窗口内的记录。
 */
export function withinWindow(records: readonly UsageRecord[], window: UsageWindow, now: number): UsageRecord[] {
  const start = windowStart(window, now);
  if (start === undefined) return [...records];
  return records.filter((record) => record.at >= start);
}
