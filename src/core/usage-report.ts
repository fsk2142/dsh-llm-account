/**
 * 用量统计的**查询层**：把台账里的记录整理成界面要的形状。
 *
 * 界面的要求（用户原话）：「每个账号只统计自己的记账周期，然后单独有一个总的记录」。
 * 于是这里产出两块：
 * 1. {@link AccountUsage}：每个账号一条，按**它自己的周期**聚合；
 * 2. {@link TotalUsage}：跨账号的总账，按用户选的时间窗口聚合。
 *
 * 周期与窗口是**两件不同的事**，不要混：周期回答「这个账号本周期用了多少」，窗口回答
 * 「最近 N 天我一共用了多少」。两者各有各的比率与成本，分别算。
 * @module dsh-llm-account/src/core/usage-report
 */
import { periodAt, periodKindOf, type BillingPeriod } from "./billing-period";
import { officialPriceOf, vendorPriceOf } from "./pricing";
import { aggregateUsage, withinWindow, windowStart, type UsageBucket, type UsageRecord, type UsageWindow } from "./usage-stats";

/** 一个账号在它自己周期内的用量。 */
export interface AccountUsage {
  vendor: string;
  account: string;
  /** 该账号的记账周期。 */
  period: BillingPeriod;
  /** 周期内聚合。 */
  bucket: UsageBucket;
  /** 同一批记录按**时间窗口**聚合（用户切 7 天/30 天时用）。 */
  windowed: UsageBucket;
  /**
   * 厂商自己公布的**本周期已消耗金额**（美元），来自额度窗口的 `used`。
   *
   * 这是**权威数字**：订阅制厂商不公布逐 token 单价，但额度端点直接按美元记账
   * （Command Code 的窗口 `unit: "usd"`；OpenDesign 给了 `creditsPerUsd` 换算）。
   * 有它就不必用 token×单价去反推 —— 反推出来的数只会比它更不准。
   * 缺失（额度读不到、或厂商只给百分比）时为 `undefined`。
   */
  spent?: number;
  /** 该金额来自哪个窗口（显示成「5 小时窗口已用 $3.20」）。 */
  spentWindow?: string;
  /** 周期内**最近一次请求**的时刻（epoch 毫秒）；周期内没有记录时缺失。 */
  lastAt?: number;
}

/** 总账。 */
export interface TotalUsage {
  /** 选中的窗口。 */
  window: UsageWindow;
  /** 全部账号在该窗口内的合计。 */
  bucket: UsageBucket;
  /** 按厂商拆开（界面上分组显示）。 */
  byVendor: { vendor: string; bucket: UsageBucket }[];
  /**
   * 窗口内**最近一次请求**的时刻（epoch 毫秒）。
   *
   * 为什么值得单独给：用户发完一轮对话会来看这里，需要能确认「刚才那次算进去了」。
   * 没有记录时为 `undefined`。
   */
  lastAt?: number;
}

/**
 * 一次查询的入参。
 */
export interface UsageQuery {
  records: readonly UsageRecord[];
  /** 窗口。 */
  window: UsageWindow;
  /** 「现在」（注入，便于测试）。 */
  now: number;
  /**
   * 每账号的周期粒度来源：`vendor` → 该厂商额度里**最细的那一档**窗口 key。
   *
   * 为什么由调用方给：额度窗口是活的（`status()` 读回来的），统计层不该自己去读网络。
   */
  periodWindowOf?: (vendor: string, account: string) => string | undefined;
  /** 每账号该档窗口的重置时间（epoch 毫秒），用于把周期锚到厂商的真实边界。 */
  resetAtOf?: (vendor: string, account: string) => number | undefined;
  /**
   * 每账号该档窗口的**已用美元金额**（厂商权威口径）。
   *
   * 只在窗口的 `unit === "usd"` 时有值 —— 那是厂商按美元记账的事实；百分比口径的窗口
   * 不能拿来当钱（会算出一个不存在的数字）。
   */
  spentOf?: (vendor: string, account: string) => { amount: number; window: string } | undefined;
}

/** 空桶（没有记录时也要有形状）。 */
function emptyBucket(period: string, since: number): UsageBucket {
  return aggregateUsage([], period, since, () => undefined, () => undefined);
}

/**
 * 生成报表。
 * @param query - 见 {@link UsageQuery}。
 * @returns 每账号明细 + 总账。
 */
export function buildUsageReport(query: UsageQuery): { accounts: AccountUsage[]; total: TotalUsage } {
  const { records, window, now } = query;
  const priceOf = (vendor: string) => vendorPriceOf(vendor);
  const official = (model: string) => officialPriceOf(model);

  // 1) 按（厂商, 账号）分组，同时保留该账号的全部记录（用于周期聚合）。
  const groups = new Map<string, { vendor: string; account: string; items: UsageRecord[] }>();
  for (const record of records) {
    const key = `${record.vendor}\u0000${record.account}`;
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, { vendor: record.vendor, account: record.account, items: [record] });
    else existing.items.push(record);
  }

  const accounts: AccountUsage[] = [];
  for (const group of groups.values()) {
    // 周期粒度：优先用调用方给的窗口 key，缺省按月。
    const windowKey = query.periodWindowOf?.(group.vendor, group.account);
    const kind = periodKindOf(windowKey ?? "monthly");
    const resetAt = query.resetAtOf?.(group.vendor, group.account);
    const period = periodAt(kind, now, resetAt);
    // 周期内：只取落在 [start, end) 的记录。
    const inPeriod = group.items.filter(
      (record) => record.at >= period.start && (period.end === undefined || record.at < period.end),
    );
    const bucket = aggregateUsage(inPeriod, period.key, period.start, priceOf(group.vendor), official);
    const windowed = aggregateUsage(withinWindow(group.items, window, now), window, startOf(window, now), priceOf(group.vendor), official);
    // 厂商权威金额：只取 `unit === "usd"` 的窗口（百分比窗口不能当钱）。
    const spent = query.spentOf?.(group.vendor, group.account);
    // 周期内最近一次请求：账号行要能显示「刚刚」—— 这是「刚才那次算进去了」的唯一凭据。
    const lastAt = inPeriod.reduce<number | undefined>(
      (latest, record) => (latest === undefined || record.at > latest ? record.at : latest),
      undefined,
    );
    accounts.push({
      vendor: group.vendor,
      account: group.account,
      period,
      bucket,
      windowed,
      ...(spent === undefined ? {} : { spent: spent.amount, spentWindow: spent.window }),
      ...(lastAt === undefined ? {} : { lastAt }),
    });
  }
  // 稳定的显示顺序：厂商 name 升序，账号升序。
  accounts.sort((left, right) => left.vendor.localeCompare(right.vendor) || left.account.localeCompare(right.account));

  // 2) 总账：全部记录按窗口聚合；再按厂商拆开。
  const windowRecords = withinWindow(records, window, now);
  const lastAt = windowRecords.reduce<number | undefined>(
    (latest, record) => (latest === undefined || record.at > latest ? record.at : latest),
    undefined,
  );
  const total: TotalUsage = {
    window,
    bucket: aggregateUsage(windowRecords, window, startOf(window, now), () => undefined, official),
    byVendor: [],
    ...(lastAt === undefined ? {} : { lastAt }),
  };
  const vendors = new Map<string, UsageRecord[]>();
  for (const record of windowRecords) {
    const list = vendors.get(record.vendor);
    if (list === undefined) vendors.set(record.vendor, [record]);
    else list.push(record);
  }
  for (const [vendor, items] of [...vendors.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    total.byVendor.push({
      vendor,
      bucket: aggregateUsage(items, window, startOf(window, now), priceOf(vendor), official),
    });
  }

  return { accounts, total };
}

/** 窗口的起点（`all` 用 0）。 */
function startOf(window: UsageWindow, now: number): number {
  return windowStart(window, now) ?? 0;
}

/** 报表为空时的形状（界面在「还没有记录」时用它，避免到处判空）。 */
export function emptyReport(window: UsageWindow, now: number): { accounts: AccountUsage[]; total: TotalUsage } {
  return {
    accounts: [],
    total: { window, bucket: emptyBucket(window, startOf(window, now)), byVendor: [] },
  };
}
