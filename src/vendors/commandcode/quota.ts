/**
 * Command Code 额度：四个 `/alpha/*` 端点 → 归一化的 {@link QuotaSnapshot}。
 *
 * 端点、请求头与负载字段逐条对照旧插件
 * `@mars-sea/dsh-commandcode-provider/lib/index.js`：
 * - 四个端点（`getUsage` 第 7246-7252 行）：`/alpha/whoami`、`/alpha/usage/summary`、
 *   `/alpha/billing/credits`、`/alpha/billing/subscriptions`（带上 whoami 的 `org.id`）；
 * - 请求头（`accountHeaders` 第 6994-7005 行）：`Authorization: Bearer` + 身份编码 +
 *   `x-command-code-version` + `x-cli-environment` + attribution；
 * - 窗口形状（`parseWindowLimit` 第 6384-6393 行）：`{ used, cap, exceeded, resetAt }`
 *   位于 `billing/credits` 的 `windowLimits.fiveHour` / `windowLimits.weekly`；
 * - 月度窗口（`parseUsageTotals` 第 6372 行的消耗 + 旧插件 `monthlyView` 第 5722-5750 行
 *   的套餐配给）：有套餐时 `cap` = 套餐每月额度、`used` = 额度 − `billing/credits` 的
 *   `monthlyCredits` **余额**、`resetAt` = 本期结束；没有套餐时退化成 usage 的
 *   `totalCredits` 当期已消耗 —— 见 `monthlyCreditsWindowOf` / `planOf`；
 * - 预算：与聊天请求同一档（第 7204-7207 行的说明），不用目录的 10 秒探测预算。
 *
 * **纪律**（设计 §12 Review Focus 4）：字段缺失就是「未知」，绝不倒成 0；缺失的窗口
 * 不造出来。**单位**：{@link CommandCodeQuotaKey} 说明每个 key 的 `used`/`cap` 单位；
 * `QuotaWindow.percent` 若填，取值 0–100（超出范围视为端点未报告），`resetAt` 一律是
 * epoch 毫秒（端点给 ISO 字符串时在此转换）。
 * @module dsh-llm-account/src/vendors/commandcode/quota
 */
import { LlmError, attributionHeaders } from "@deepseek-ai/dsh-llm";

import type { QuotaPlan, QuotaPort, QuotaSnapshot, QuotaWindow } from "../../core/adapter";
import { normalizeKey } from "../../core/credentials";
import { estimateReset, type AnchorState } from "../../core/usage/reset-estimate";
import { subscriptionPlanInfo } from "./plans";
import {
  COMMAND_CODE_CLI_VERSION,
  DEFAULT_API_BASE,
  DEFAULT_REQUEST_TIMEOUT_MS,
  IDENTITY_ENCODING_HEADER,
} from "./protocol";

/**
 * 本适配器产出的 `QuotaWindow.key` 词表（`QuotaWindow.key` 是字符串，这里只做文档与
 * 调用方收窄用）。**key 自带单位含义**，本适配器这三种 key 下 `used`/`cap` 一律是**美元
 * 口径的额度**（旧插件把窗口行与总消耗一律按 `$` 排版：窗口行 `lib/client.js` 第 3647 行、
 * `/usage` 面板第 7742 行、`formatMoney` 第 1516 行；线上实测 5 小时上限 14 = GOAT 月度
 * 70 的 1/5）：
 * - `"fiveHour"` / `"weekly"`：端点公布的限额窗口（`windowLimits.fiveHour` / `.weekly`）；
 * - `"monthlyCredits"`：月度窗口。有套餐时是**配给表**（`cap` = 套餐每月额度，`used` =
 *   额度 − 余额，`resetAt` = 本期结束）；没有套餐时退化成当期**已消耗**（只有 `used`，
 *   见 {@link monthlyCreditsWindowOf}）。
 *
 * 本适配器对 `QuotaWindow` 其余字段的用法约定（`QuotaWindow` 在共享内核里，本任务的
 * 改动范围只允许给它之外的 `CredentialPort.describe`，所以契约写在这里）：
 * - `percent` 若填，取值 **0–100**（端点给的范围外的值视为未报告，不夹取）；
 * - `resetAt` 是 **epoch 毫秒**（端点给 ISO 字符串时在本模块转换），缺失保持 `undefined`；
 * - `used` / `cap` / `exceeded` **缺失即未知**，绝不倒成 0 / false。
 */
export type CommandCodeQuotaKey = "fiveHour" | "weekly" | "monthlyCredits";

/** 会产生窗口的端点窗口名（顺序即输出顺序）。 */
const WINDOW_KEYS: readonly ("fiveHour" | "weekly")[] = ["fiveHour", "weekly"];

/** whoami 端点路径（旧插件第 7246 行）。 */
export const WHOAMI_PATH = "/alpha/whoami";

/** 用量汇总端点路径（旧插件第 7249 行）。 */
export const USAGE_SUMMARY_PATH = "/alpha/usage/summary";

/** 额度端点路径（旧插件第 7250 行）。 */
export const BILLING_CREDITS_PATH = "/alpha/billing/credits";

/** 订阅端点路径（旧插件第 7251 行；带 `orgId` 的写法见 `subscriptionsPath`）。 */
export const BILLING_SUBSCRIPTIONS_PATH = "/alpha/billing/subscriptions";

/**
 * `failures` 里的端点名与固定顺序。`QuotaSnapshot.failures` 是给 UI 的「哪块数据不完整」，
 * 所以用短名而不是旧插件那种带 HTTP 状态的长文案；顺序固定，避免并发完成次序让读数抖动。
 */
export const QUOTA_ENDPOINTS = ["whoami", "usage", "credits", "subscriptions"] as const;

/** 端点名。 */
export type QuotaEndpoint = (typeof QUOTA_ENDPOINTS)[number];

/**
 * 一次归一化的输入：四个端点的原始负载（`undefined` 表示该端点失败）与已记名的失败项。
 * `whoami` 的 `org.id` 只用来给订阅端点拼 query（旧插件第 7251 行）；`QuotaSnapshot`
 * 没有账号字段，所以它不贡献任何输出字段 —— 保留这个参数是为了四个端点共用同一份形状，
 * 且调用方不必为「whoami 失败」另写一条路径。窗口来自 `credits`；月度窗口来自
 * `usage` 的 `totalCredits`（无套餐）或套餐表 + `credits` 的 `monthlyCredits` 余额（有套餐）。
 */
export interface CommandCodeQuotaParts {
  /** `/alpha/whoami` 的负载；失败时缺省。 */
  whoami?: unknown;
  /** `/alpha/usage/summary` 的负载；失败时缺省。 */
  usage?: unknown;
  /** `/alpha/billing/credits` 的负载；失败时缺省。 */
  credits?: unknown;
  /** `/alpha/billing/subscriptions` 的负载；失败时缺省。 */
  subscriptions?: unknown;
  /** 失败的端点名，原样进入结果的 `failures`。 */
  failures: string[];
}

/** 额度端口的依赖。取数用的密钥与账号都要注入，端口自己不依赖 `ctx`。 */
export interface CommandCodeQuotaDeps {
  /** 这一读要报告的账号 ref；`undefined` 表示当前没有选中账号。 */
  ref: () => string | undefined;
  /** 解析该 ref 的密钥（凭据服务 / 环境变量 / auth.json 的注入点）。 */
  resolveKey: (ref: string) => Promise<string | undefined>;
  /** 注入的 `fetch`（生产传全局 `fetch`）。 */
  fetchImpl: typeof fetch;
  /** 网关基地址；缺省 {@link DEFAULT_API_BASE}。 */
  apiBase?: string;
  /** 每个端点的预算（毫秒）；缺省 {@link DEFAULT_REQUEST_TIMEOUT_MS}。 */
  timeoutMs?: number;
  /**
   * 取当前时刻（毫秒）。缺省 `Date.now`。
   *
   * 估算重置时间要用「这一刻的观测」当锚点，而单测需要可控的时钟 —— 所以做成注入点。
   */
  now?: () => number;
}

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取非空字符串。 */
function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** 读取有限数字（缺失或非数字一律 `undefined`，不倒成 0）。 */
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 读取 0–100 的百分比；超出范围视为端点未报告（契约见模块头）。 */
function percentValue(value: unknown): number | undefined {
  const percent = numberValue(value);
  return percent !== undefined && percent >= 0 && percent <= 100 ? percent : undefined;
}

/**
 * 把端点的重置时刻转成 epoch 毫秒。数字按毫秒原样收下（旧插件 `parseWindowLimit`
 * 第 6391 行就是这么用的），字符串按 ISO 解析；缺失或解析不了就是「未知」，不补 0、
 * 不补当前时间。
 * @param value - 端点给的 `resetAt`。
 * @returns epoch 毫秒，或 `undefined` 表示未公布。
 */
function epochMillis(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const text = stringValue(value);
  if (text === undefined) return undefined;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * 归一化一个窗口块。字段逐个独立：端点没给的字段保持缺省（`undefined`），
 * 而不是倒成 0 —— 缺失与「真的是 0」在 UI 上必须是两种读数。
 *
 * `unit: "usd"` 是**口径**而不是从负载里读出来的值：`billing/credits` 的两个窗口本来就是
 * 美元额度（旧插件把这批数字一律按 `$` 排版：655 行起的窗口行与 `formatMoney` 第 1516 行），
 * 所以这里给的是那个已知的单位，不是猜的。
 * @param raw - 端点给的窗口块。
 * @param key - 窗口 key（自带单位含义）。
 * @returns 归一化窗口；端点没公布这个窗口时为 `undefined`。
 */
function windowOf(raw: unknown, key: CommandCodeQuotaKey): QuotaWindow | undefined {
  if (!isRecord(raw)) return undefined;
  const window: QuotaWindow = { key, unit: "usd" };
  const used = numberValue(raw.used);
  if (used !== undefined) window.used = used;
  const cap = numberValue(raw.cap);
  if (cap !== undefined) window.cap = cap;
  const percent = percentValue(raw.percent);
  if (percent !== undefined) window.percent = percent;
  const resetAt = epochMillis(raw.resetAt);
  if (resetAt !== undefined) window.resetAt = resetAt;
  // `exceeded` 只在端点明确给出布尔值时透传：缺失就是未知，不猜成 false。
  if (typeof raw.exceeded === "boolean") window.exceeded = raw.exceeded;
  return window;
}

/**
 * 端点窗口块所在的位置：线上是 `{ windowLimits: { fiveHour, weekly } }`；负载本身直接
 * 带窗口时（浅层形状）回退到负载自己。
 * @param credits - `billing/credits` 的负载。
 * @returns 窗口容器的原始负载。
 */
function windowContainer(credits: Record<string, unknown>): Record<string, unknown> {
  return isRecord(credits.windowLimits) ? credits.windowLimits : credits;
}

/**
 * `billing/credits` 的额度记录：线上是 `{ credits: { monthlyCredits, ... } }`；
 * 浅层形状（负载自己就是额度记录）同样接受。
 * @param credits - `billing/credits` 的负载。
 * @returns 额度记录，形状不认识时为 `undefined`。
 */
function creditsRecord(credits: unknown): Record<string, unknown> | undefined {
  if (!isRecord(credits)) return undefined;
  return isRecord(credits.credits) ? credits.credits : credits;
}

/** 端点公布的窗口（`fiveHour` / `weekly`）。 */
function windowLimitsOf(credits: unknown): QuotaWindow[] {
  if (!isRecord(credits)) return [];
  const container = windowContainer(credits);
  // `limited: false` 是端点**明确**说「这两个窗口不设上限」（线上实测：窗口值为 null 且
  // limited 为 false）。这时仍然给出窗口本身 ——「不限」是一个读数，不给就等于界面看起来
  // 像丢了两个窗口。窗口给了对象时照旧用对象（那是真的限额）；`limited` 缺失是「未知」，
  // 不猜成不限。
  const unlimited = container.limited === false;
  const windows: QuotaWindow[] = [];
  for (const key of WINDOW_KEYS) {
    const window = windowOf(container[key], key);
    if (window !== undefined) windows.push(window);
    else if (unlimited) windows.push({ key, unlimited: true });
  }
  return windows;
}

/**
 * 月度窗口：有套餐时按**套餐表**算配给，没有套餐时退化成当期已消耗。
 *
 * 两种口径，都被线上数据钉住：
 * 1. **有套餐**（subscriptions 报了 `planId` 且套餐表认得它、credits 报了 `monthlyCredits`
 *    余额）：`cap` = 套餐每月额度，`used` = `cap − 余额`，`resetAt` = 本期结束。这是官方
 *    CLI 与旧插件同一份算法（旧插件 `monthlyView` 第 5722-5750 行把
 *    `credits.credits.monthlyCredits` 当**余额**、`plan.monthlyCredits` 当上限；
 *    CLI `getCreditDepletionPct` 同）。线上交叉验证：GOAT（70）余额 55.7714050703 →
 *    已用 14.2285949297，与该账号的 `weekly.used` 一字不差。
 * 2. **没有套餐**（未订阅 / 端点没报 `planId` / 套餐表不认识 / 余额缺失）：只报
 *    `usage.totalCredits` 这个**已消耗**，没有 `cap`、没有 `percent`。把余额当上限会得到
 *    一个符号相反、在快用完的账号上能到百分之几百的伪读数（Review Focus 4），所以
 *    余额缺失时宁可不算比例。
 *
 * 三者缺一不可：`cap` 要来自套餐表（不是余额）、余额要端点真的报了（缺失 ≠ 0）、
 * `used` 不夹到负数下限以外（`used = max(0, cap − 余额)`，余额超过配给额时显示 0 已用）。
 * @param usage - `usage/summary` 的负载。
 * @param credits - `billing/credits` 的负载。
 * @param plan - 已归一化的套餐（见 {@link planOf}）；没有订阅时为 `undefined`。
 * @returns 月度窗口；usage 与 plan 都没给可用数字时为 `undefined`。
 */
function monthlyCreditsWindowOf(usage: unknown, credits: unknown, plan: QuotaPlan | undefined): QuotaWindow | undefined {
  const allowance = plan?.monthlyCredits;
  const record = creditsRecord(credits);
  const remaining = record === undefined ? undefined : numberValue(record.monthlyCredits);
  if (allowance !== undefined && allowance > 0 && remaining !== undefined) {
    const window: QuotaWindow = {
      key: "monthlyCredits",
      used: Math.max(0, allowance - remaining),
      cap: allowance,
      unit: "usd",
    };
    if (plan?.periodEnd !== undefined) window.resetAt = plan.periodEnd;
    return window;
  }
  const used = isRecord(usage) ? numberValue(usage.totalCredits) : undefined;
  if (used === undefined) return undefined;
  return { key: "monthlyCredits", used, unit: "usd" };
}

/**
 * 归一化订阅套餐。
 *
 * 来源与旧插件 `getUsage` 第 7257-7261 行同一顺序：subscriptions 的 `data` 优先（带状态、
 * 本期结束），`planId` 缺失时退回 credits 的 `planId`（CLI 也用它给遥测盖身份章）。名称与
 * 每月额度查 {@link subscriptionPlanInfo}；**表里没有就不给名称与额度**，`id` 与 `status`
 * 仍是端点给的原文。
 *
 * 只认 `data` 是对象的情况：`data: null` 是「这个账号没有订阅」（线上无订阅账号的形状），
 * 不是「读失败」—— 读失败走 `failures`，两条路径在界面上是两种显示。
 * @param subscriptions - `billing/subscriptions` 的负载。
 * @param credits - `billing/credits` 的负载。
 * @returns 套餐；两端都没给标识与状态时为 `undefined`。
 */
function planOf(subscriptions: unknown, credits: unknown): QuotaPlan | undefined {
  const subscription = isRecord(subscriptions) && isRecord(subscriptions.data) ? subscriptions.data : undefined;
  const record = creditsRecord(credits);
  const id =
    (subscription === undefined ? undefined : stringValue(subscription.planId)) ??
    (record === undefined ? undefined : stringValue(record.planId));
  const status = subscription === undefined ? undefined : stringValue(subscription.status);
  if (id === undefined && status === undefined) return undefined;
  const plan: QuotaPlan = { id: id ?? "" };
  if (status !== undefined) plan.status = status;
  const info = id === undefined ? undefined : subscriptionPlanInfo(id);
  if (info !== undefined) {
    plan.name = info.name;
    plan.monthlyCredits = info.monthlyCredits;
  }
  const periodEnd = subscription === undefined ? undefined : epochMillis(subscription.currentPeriodEnd);
  if (periodEnd !== undefined) plan.periodEnd = periodEnd;
  // 本期起点同样可能公布（与 Open Design 的 `subscriptionCurrentPeriodStart` 同名同义）：
  // 有它，统计的账期就是厂商自己的两个边界（用户 2026-10-19：「按套餐有效期统计」）。
  const periodStart = subscription === undefined ? undefined : epochMillis(subscription.currentPeriodStart);
  if (periodStart !== undefined) plan.periodStart = periodStart;
  return plan;
}

/**
 * 把四个端点的负载归一化成一次额度读数。纯函数：不做 I/O、不缓存。
 * @param parts - 四个端点的负载与已记名的失败项。
 * @returns 归一化读数；窗口顺序固定为 `fiveHour`、`weekly`、`monthlyCredits`。
 */
export function toQuotaSnapshot(parts: CommandCodeQuotaParts): QuotaSnapshot {
  const plan = planOf(parts.subscriptions, parts.credits);
  const windows = [...windowLimitsOf(parts.credits)];
  const monthly = monthlyCreditsWindowOf(parts.usage, parts.credits, plan);
  if (monthly !== undefined) windows.push(monthly);
  return {
    windows,
    ...(plan === undefined ? {} : { plan }),
    failures: [...parts.failures],
  };
}

/** whoami 的 `org.id`（旧插件 `parseAccountIdentity` 第 6424-6435 行）。 */
function orgIdOf(whoami: unknown): string | undefined {
  if (!isRecord(whoami) || !isRecord(whoami.org)) return undefined;
  return stringValue(whoami.org.id);
}

/** 去掉基地址末尾的斜杠（与 `protocol.ts` 同一归一化）。 */
function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

/** 订阅端点：拿到 `orgId` 时带上查询串（旧插件第 7251 行）。 */
function subscriptionsPath(orgId: string | undefined): string {
  return orgId === undefined ? BILLING_SUBSCRIPTIONS_PATH : `${BILLING_SUBSCRIPTIONS_PATH}?orgId=${encodeURIComponent(orgId)}`;
}

/** 一次额度读取要用的请求头（旧插件 `accountHeaders` 第 6998-7004 行）。 */
function accountHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    ...IDENTITY_ENCODING_HEADER,
    "x-command-code-version": COMMAND_CODE_CLI_VERSION,
    "x-cli-environment": "production",
    ...attributionHeaders(),
  };
}

/**
 * Command Code 的额度端口。`snapshot()` 的顺序：解析当前账号密钥 → `whoami` 拿 `orgId`
 * → 并行拉另外三个端点；**每个端点各自 try/catch**，失败只把短名记进 `failures`，其余
 * 照常返回（设计 §7.1、§10）。没有可用密钥时抛 `MISSING_CREDENTIAL`（旧插件
 * `getUsage` 第 7216-7221 行的同一语义），一个端点都不请求。
 * @param deps - 账号 ref、密钥解析、`fetch` 与基地址/预算。
 * @returns 额度端口。
 */
export function createCommandCodeQuota(deps: CommandCodeQuotaDeps): QuotaPort {
  const base = trimBase(deps.apiBase === undefined || deps.apiBase.trim() === "" ? DEFAULT_API_BASE : deps.apiBase);
  const timeoutMs =
    deps.timeoutMs !== undefined && Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0
      ? deps.timeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;

  /**
   * 重置时间的**估算锚点**，按「账号 ref × 窗口 key」保存（跨轮询保持）。
   *
   * 为什么需要跨调用状态：估算的依据是「`used` 从 0 变正的那一刻」，而单次读数无法知道
   * 那一刻是什么时候 —— 必须与上一次观测比较。
   */
  const resetAnchors = new Map<string, AnchorState>();

  /**
   * 给缺少 `resetAt` 的固定窗口补上估算值。
   *
   * 只补**端点确实没给**的那些（月度有自己的 `currentPeriodEnd`，不动它）。估算结论写进
   * 同一个 `resetAt` 字段，并由 {@link QuotaWindow.resetEstimated} 标记「这是算出来的」，
   * 界面据此显示「约」—— 绝不把估算伪装成厂商事实。
   * @param ref - 账号 ref（锚点按账号分开）。
   * @param windows - 归一化窗口。
   * @returns 新的窗口数组（不修改入参）。
   */
  function withEstimatedResets(ref: string | undefined, windows: readonly QuotaWindow[]): QuotaWindow[] {
    const now = deps.now?.() ?? Date.now();
    const account = ref ?? "(none)";
    return windows.map((window) => {
      // 端点给了就尊重它，绝不覆盖真实值。
      if (window.resetAt !== undefined) return window;
      const storageKey = `${account}\u0000${window.key}`;
      const { anchor, estimate } = estimateReset(resetAnchors.get(storageKey), {
        key: window.key,
        used: window.used,
        at: now,
      });
      if (anchor === undefined) resetAnchors.delete(storageKey);
      else resetAnchors.set(storageKey, anchor);
      return estimate === undefined
        ? window
        : { ...window, resetAt: estimate.resetAt, resetEstimated: true };
    });
  }

  /** 拉一个端点；任何失败（状态、正文、传输）都只把端点名记进 `failed`。 */
  async function getJson(path: string, name: QuotaEndpoint, headers: Record<string, string>, failed: Set<QuotaEndpoint>): Promise<unknown> {
    try {
      const response = await deps.fetchImpl(`${base}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        failed.add(name);
        return undefined;
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload)) {
        failed.add(name);
        return undefined;
      }
      return payload;
    } catch {
      // 网络/超时/正文解析失败：与状态码失败同一处置（记名，不拖垮整体）。
      failed.add(name);
      return undefined;
    }
  }

  return {
    async snapshot(accountRef?: string): Promise<QuotaSnapshot> {
      const ref = accountRef ?? deps.ref();
      const key = ref === undefined ? undefined : normalizeKey(await deps.resolveKey(ref));
      if (key === undefined) {
        const account = ref === undefined ? "(none selected)" : `"${ref}"`;
        throw new LlmError(
          `llm-commandcode: no usable API key for Command Code account ${account}; store it through the credentials service, export it in the launching environment, or run \`command-code login\``,
          "MISSING_CREDENTIAL",
        );
      }
      const headers = accountHeaders(key);
      const failed = new Set<QuotaEndpoint>();
      const whoami = await getJson(WHOAMI_PATH, "whoami", headers, failed);
      const [usage, credits, subscriptions] = await Promise.all([
        getJson(USAGE_SUMMARY_PATH, "usage", headers, failed),
        getJson(BILLING_CREDITS_PATH, "credits", headers, failed),
        getJson(subscriptionsPath(orgIdOf(whoami)), "subscriptions", headers, failed),
      ]);
      const snapshot = toQuotaSnapshot({
        ...(whoami === undefined ? {} : { whoami }),
        ...(usage === undefined ? {} : { usage }),
        ...(credits === undefined ? {} : { credits }),
        ...(subscriptions === undefined ? {} : { subscriptions }),
        failures: QUOTA_ENDPOINTS.filter((name) => failed.has(name)),
      });
      // **重置时间估算**（用户 2026-10-20：「如果没有提供就给出估算值」）：
      // 这个端点不给 5 小时/周窗口的 `resetAt`，只能用「`used` 从 0 变正的时刻 + 窗口长度」
      // 推算。锚点按账号分开保存在本闭包里（跨轮询保持），且结论一律标 `estimated: true`。
      return { ...snapshot, windows: withEstimatedResets(ref, snapshot.windows) };
    },
  };
}
