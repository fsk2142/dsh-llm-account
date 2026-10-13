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
 * - 额度上限（`parseCreditLimits` 第 6398-6418 行）：`credits.credits.monthlyCredits`
 *   与 usage 的 `totalCredits` 合成月度额度窗口；
 * - 预算：与聊天请求同一档（第 7204-7207 行的说明），不用目录的 10 秒探测预算。
 *
 * **纪律**（设计 §12 Review Focus 4）：字段缺失就是「未知」，绝不倒成 0；缺失的窗口
 * 不造出来。**单位**：{@link CommandCodeQuotaKey} 说明每个 key 的 `used`/`cap` 单位；
 * `QuotaWindow.percent` 若填，取值 0–100（超出范围视为端点未报告），`resetAt` 一律是
 * epoch 毫秒（端点给 ISO 字符串时在此转换）。
 * @module dsh-llm-account/src/vendors/commandcode/quota
 */
import { LlmError, attributionHeaders } from "@deepseek-ai/dsh-llm";

import type { QuotaPort, QuotaSnapshot, QuotaWindow } from "../../core/adapter";
import { normalizeKey } from "../../core/credentials";
import {
  COMMAND_CODE_CLI_VERSION,
  DEFAULT_API_BASE,
  DEFAULT_REQUEST_TIMEOUT_MS,
  IDENTITY_ENCODING_HEADER,
} from "./protocol";

/**
 * 本适配器产出的 `QuotaWindow.key` 词表（`QuotaWindow.key` 是字符串，这里只做文档与
 * 调用方收窄用）。**key 自带单位含义**，因为不同 key 下 `used`/`cap` 的单位不同：
 * - `"fiveHour"` / `"weekly"`：端点公布的用量窗口，`used`/`cap` 是 **token 数**；
 * - `"monthlyCredits"`：月度额度，`used` 是本期已消耗的**额度**、`cap` 是月度额度上限。
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
 * 且调用方不必为「whoami 失败」另写一条路径。窗口来自 `credits`（与 `usage` 的消耗合成
 * 月度窗口）。
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
 * @param raw - 端点给的窗口块。
 * @param key - 窗口 key（自带单位含义）。
 * @returns 归一化窗口；端点没公布这个窗口时为 `undefined`。
 */
function windowOf(raw: unknown, key: CommandCodeQuotaKey): QuotaWindow | undefined {
  if (!isRecord(raw)) return undefined;
  const window: QuotaWindow = { key };
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
  const windows: QuotaWindow[] = [];
  for (const key of WINDOW_KEYS) {
    const window = windowOf(container[key], key);
    if (window !== undefined) windows.push(window);
  }
  return windows;
}

/**
 * 月度额度窗口：`used` 是 usage 的本期已消耗额度，`cap` 是 credits 的月度额度上限。
 *
 * 只有两端都给数才是一个可画的窗口 —— 只有上限或只有消耗都不造窗口（Review Focus 4：
 * 缺失不倒成 0）。单位是**额度**而不是 token，所以 key 用 `monthlyCredits` 与两个
 * token 窗口区分开。
 * @param credits - `billing/credits` 的负载。
 * @param usage - `usage/summary` 的负载。
 * @returns 月度额度窗口；任一端缺数时为 `undefined`。
 */
function monthlyCreditsWindowOf(credits: unknown, usage: unknown): QuotaWindow | undefined {
  const record = creditsRecord(credits);
  const cap = record === undefined ? undefined : numberValue(record.monthlyCredits);
  const used = isRecord(usage) ? numberValue(usage.totalCredits) : undefined;
  if (cap === undefined || used === undefined) return undefined;
  return { key: "monthlyCredits", used, cap };
}

/**
 * 套餐标识：subscriptions 的 `data.planId` 优先，缺失时退回 credits 的 `planId`
 * （旧插件 `getUsage` 第 7259 行）。套餐**名称**来自旧插件的已知套餐表，第 1 期不搬，
 * 所以这里只给标识。
 * @param subscriptions - `billing/subscriptions` 的负载。
 * @param credits - `billing/credits` 的负载。
 * @returns 套餐标识，两端都没给时为 `undefined`。
 */
function planIdOf(subscriptions: unknown, credits: unknown): string | undefined {
  const subscription = isRecord(subscriptions) && isRecord(subscriptions.data) ? subscriptions.data : undefined;
  const fromSubscription = subscription === undefined ? undefined : stringValue(subscription.planId);
  if (fromSubscription !== undefined) return fromSubscription;
  const record = creditsRecord(credits);
  return record === undefined ? undefined : stringValue(record.planId);
}

/**
 * 把四个端点的负载归一化成一次额度读数。纯函数：不做 I/O、不缓存。
 * @param parts - 四个端点的负载与已记名的失败项。
 * @returns 归一化读数；窗口顺序固定为 `fiveHour`、`weekly`、`monthlyCredits`。
 */
export function toQuotaSnapshot(parts: CommandCodeQuotaParts): QuotaSnapshot {
  const windows = [...windowLimitsOf(parts.credits)];
  const monthly = monthlyCreditsWindowOf(parts.credits, parts.usage);
  if (monthly !== undefined) windows.push(monthly);
  const plan = planIdOf(parts.subscriptions, parts.credits);
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
    async snapshot(): Promise<QuotaSnapshot> {
      const ref = deps.ref();
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
      return toQuotaSnapshot({
        ...(whoami === undefined ? {} : { whoami }),
        ...(usage === undefined ? {} : { usage }),
        ...(credits === undefined ? {} : { credits }),
        ...(subscriptions === undefined ? {} : { subscriptions }),
        failures: QUOTA_ENDPOINTS.filter((name) => failed.has(name)),
      });
    },
  };
}
