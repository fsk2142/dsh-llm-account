/**
 * Open Design 额度：账单摘要 + 可选的 vela 周期额度 → 归一化的 {@link QuotaSnapshot}。
 *
 * 端点与字段逐条对照厂商事实（计划 §0、§2.5）：
 * - 账单摘要：`GET https://amr-api.open-design.ai/api/v1/billing/summary`（**控制面密钥**，
 *   `Authorization: Bearer`）→ `{ membershipTier, subscriptionStatus, subscriptionCurrentPeriodEnd,
 *   subscriptionCancelAtPeriodEnd, creditsPerUsd }`；
 * - 周期额度（Coding Plan，可选）：本机 `vela billing preflight --workspace-id <id> --format json`
 *   → `{ workspaceId, codingPlan: { windows: [{ usedCredits, limitCredits, remainingCredits,
 *   durationSeconds, resetsAt }] } }`。只在该账号配置了 `workspaceId` 且装配层能解析到 vela 时
 *   查询；失败只记 `failures`，不拖垮整体，绝不倒成 0。
 *
 * **单位**（纪律：有单位必须带）：窗口的原始读数是**信用点**。摘要给了 `creditsPerUsd > 0`
 * 时按美元口径折出来（`{ used, cap, unit: "usd" }`）；没有换算率时**不摆无单位信用点**，
 * 改用百分比口径（`{ percent }`，超出上限时为 `100` 并置 `exceeded`）。字段缺失一律
 * **不写**该字段 —— 「未公布」与「真的是 0」在 UI 上必须是两种读数。
 *
 * **余额 `wallet/balance` 本期不请求**（计划 §2.5）：现有客户端契约（`usage-contract.ts` 的
 * `QuotaSummary`、`client/quota.ts` 的窗口渲染）没有余额的展示位，硬塞会把一个无处安放的数字
 * 带进线上契约；留待后续任务（端点事实已记在这里，接的时候只需多拉一次）。
 *
 * **`subscriptionCancelAtPeriodEnd` 本期丢弃**：`QuotaPlan` 没有对应槽位（计划 §2.5 的同一
 * 判断），不为了它扩共享内核。
 * @module dsh-llm-account/src/vendors/opendesign/quota
 */
import { LlmError } from "@deepseek-ai/dsh-llm";

import type { QuotaPlan, QuotaPort, QuotaSnapshot, QuotaWindow } from "../../core/adapter";
import { normalizeKey } from "../../core/credentials";
import { IDENTITY_ENCODING_HEADER } from "./protocol";

/** 额度/账单链路的默认基地址（计划 §1：`amr-api` 是控制面入口）。 */
export const DEFAULT_WALLET_BASE_URL = "https://amr-api.open-design.ai/api/v1";

/** 账单摘要端点路径。 */
export const BILLING_SUMMARY_PATH = "/billing/summary";

/**
 * 每个端点的预算（毫秒）。额度读数是**后台**请求（侧边栏轮询 / 面板打开），不该占住
 * 聊天请求那一档 5 分钟的预算；15 秒足够控制面回应，也不会让页面长时间转圈。
 */
export const DEFAULT_QUOTA_TIMEOUT_MS = 15_000;

/** 一次归一化需要的原始负载（`undefined` 表示该来源失败）与已记名的失败项。 */
export interface OpenDesignQuotaParts {
  /** `/billing/summary` 的负载；失败时缺省。 */
  summary?: unknown;
  /** vela `billing preflight` 的负载；未查询或失败时缺省。 */
  preflight?: unknown;
  /** 失败原因（面向用户的中文句子），原样进入结果的 `failures`。 */
  failures: string[];
}

/** 额度端口的依赖。取数用的密钥、工作区与 vela 都是注入点，端口自己不依赖 `ctx`。 */
export interface OpenDesignQuotaDeps {
  /** 这一读要报告的账号 ref；`undefined` 表示当前没有选中账号。 */
  ref: () => string | undefined;
  /** 解析该 ref 的**控制面**密钥（凭据服务 / 环境变量的注入点）。 */
  resolveControlKey: (ref: string) => Promise<string | undefined>;
  /**
   * 这个账号**有没有真正的控制面密钥**（2026-10-21，多账号额度诊断）。
   *
   * 实测：`sk-amr_…`（推理）打控制面一律 401，只有 `vela_ctrl_…` 能通。两者在
   * 「账单接口 401」这个结果上长得一样，但对用户的含义完全不同 ——
   *
   * - `"control"`：有控制面密钥，被拒说明它过期/无权限 → 重登一次；
   * - `"inference-only"`：只有推理密钥，**这个账号从来没配过控制面密钥** →
   *   重试无用，必须走一次网页登录把这把 `vela_ctrl_…` 导进来；
   * - `"none"`：一把都没有。
   *
   * 缺省（不注入）时不作区分，失败文案退回旧口径。
   */
  controlKeyKind?: (ref: string) => Promise<"control" | "inference-only" | "none">;
  /**
   * **HTTP 版的周期额度**（`GET /workspaces/{ws}/billing/preflight`，2026-10-21 实测）。
   *
   * 用这个账号**自己的控制面密钥**鉴权，返回与 `vela billing preflight` 完全一致的结构
   * （`codingPlan.windows[].usedCredits / limitCredits / resetsAt`）。
   *
   * 它是多账号额度的正解：vela CLI 没有 `--key`，永远查本机登录态那一个人的数据；
   * HTTP 版按账号鉴权，**每个账号都能拿到自己的数字**。
   */
  preflightHttp?: (workspaceId: string, controlKey: string) => Promise<unknown>;
  /**
   * 该账号的工作区 id（条目 `workspaceId` 优先，其次顶层 `workspaceId`）。
   *
   * 允许异步：网页登录的产物**不带**工作区（`~/.amr/config.json` 只有两把密钥与 user），
   * 装配层会在缺省时问一次 `vela team-projects list` 兜底。
   */
  workspaceIdOf: (ref: string) => string | undefined | Promise<string | undefined>;
  /** 注入的 `fetch`（生产传全局 `fetch`）。 */
  fetchImpl: typeof fetch;
  /**
   * 账单摘要的第二来源（生产传 `vela billing summary --format json`）。
   *
   * 实测：控制面的 `GET /billing/summary` 对登录产物里的两把密钥都回 **403**，而同一份数据
   * vela CLI 能拿到 —— 没有这条回退，套餐与换算率在真机上永远是空的（用户报障「套餐信息也没有」）。
   */
  summaryFallback?: () => Promise<unknown | undefined>;
  /**
   * vela 周期额度查询（`billing preflight --workspace-id <id> --format json` 的注入点）。
   * 缺省表示本机没有可用的 vela：这时**不**查询，也不记失败（用户没配 workspaceId 时本来就
   * 不该出现这条错误）。
   */
  preflight?: (workspaceId: string) => Promise<unknown>;
  /**
   * **该账号的身份**（控制面 `/me` 的 `id`）+ **本机 vela 登录态的身份**。
   *
   * 为什么必须有（2026-10-20 用户提的「一个网关多个账户」）：`vela billing preflight`
   * **没有 `--key` 参数**，它永远用**本机 vela 登录态**那份身份去查额度。所以：
   *
   * - 账号 A 与 vela 登录态是同一人 → preflight 的数字是 A 的，可以用；
   * - 账号 B 是另一个人 → preflight 会返回 **A 的用量**，直接采信就是「显示别人的数据」，
   *   比没有数据更糟（用户会照着一个不属于自己的额度安排事情）。
   *
   * 返回 `undefined` 表示任一身份读不到：这时**不采信** preflight（同样不能猜）。
   * @param ref - 账号 ref。
   * @returns 该账号的控制面身份 id 与 vela 登录态身份 id。
   */
  identitiesOf?: (ref: string) => Promise<{ account?: string; vela?: string } | undefined>;
  /** 控制面基地址；缺省 {@link DEFAULT_WALLET_BASE_URL}。 */
  walletBase?: string;
  /** 每个端点的预算（毫秒）；缺省 {@link DEFAULT_QUOTA_TIMEOUT_MS}。 */
  timeoutMs?: number;
  // `localSpend` 已移除（2026-10-23）：它只为「本地合成的月度窗口」服务，
  // 而那个窗口已删除。本机花费仍可从用量块读到（按套餐账期聚合本机台账）。
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

/**
 * 读取有限数字（缺失或非数字一律 `undefined`，不倒成 0）。
 *
 * **也认数字字符串**：`vela billing preflight` 的 `usedCredits` / `limitCredits` 是
 * `"906"` / `"50000"` 这种字符串（2026-10-18 实测），只认 `number` 会让窗口只剩重置时间、
 * 没有任何数字 —— 界面上就是「有额度条但没有额度信息」。
 * @param value - 端点给的值（数字或数字字符串）。
 * @returns 有限数字，或 `undefined`。
 */
function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 错误对象到一行文案；非 Error 原样转字符串。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 试一次 HTTP 版的周期额度。
 *
 * 成功与失败都返回**结构化的结论**（不是抛错）：调用方要据此决定是退回 vela，
 * 还是直接把原因写进失败项。绝不在失败时倒成「零额度」—— 那会让用户以为这个账号用完了。
 * @param workspaceId - 该账号的工作区。
 * @param deps - 端口依赖（要 `preflightHttp` 与 `resolveControlKey`）。
 * @returns `{ ok: true, value }` 或 `{ ok: false, reason }`。
 */
async function tryHttpPreflight(
  workspaceId: string,
  deps: OpenDesignQuotaDeps,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> {
  const run = deps.preflightHttp;
  if (run === undefined) return { ok: false, reason: "这个宿主版本没有 HTTP 周期额度接口" };
  let controlKey: string | undefined;
  try {
    controlKey = normalizeKey(await deps.resolveControlKey(deps.ref() ?? ""));
  } catch {
    controlKey = undefined;
  }
  if (controlKey === undefined) return { ok: false, reason: "没有可用的控制面密钥" };
  try {
    const value = await run(workspaceId, controlKey);
    if (value === undefined) return { ok: false, reason: "HTTP 接口没有返回数据" };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
}

/**
 * vela 周期额度能不能用在这个账号上（多账号的身份闸门）。
 *
 * 背景：`vela billing preflight` **没有 `--key` 参数** —— 它永远用本机 vela 登录态那份
 * 身份去查。于是同一个网关挂多个账号时：
 *
 * | 场景 | preflight 返回 | 该不该采信 |
 * | --- | --- | --- |
 * | 账号与 vela 登录态同一人 | 这个账号的用量 | ✅ 采信 |
 * | 账号是另一个人 | **别人的用量** | ❌ 绝不采信 |
 * | 任一身份读不到 | 不知道是谁的 | ❌ 不猜 |
 *
 * 另外 `~/.amr/config.json` 是**单例文件**（只有 `profiles.prod`）：第二个账号走网页登录会
 * 覆盖第一个。所以「vela 登录态 = 最后一个登录的账号」是常态，更必须逐次核对身份。
 * @param ref - 账号 ref。
 * @param deps - 端口依赖（要 `identitiesOf`）。
 * @returns `same` 可采信；`different` 不是同一人；`unknown` 判断不了。
 */
async function checkPreflightIdentity(
  ref: string,
  deps: OpenDesignQuotaDeps,
): Promise<"same" | "different" | "unknown"> {
  if (deps.identitiesOf === undefined) return "unknown";
  let identities: { account?: string; vela?: string } | undefined;
  try {
    identities = await deps.identitiesOf(ref);
  } catch {
    return "unknown";
  }
  const account = normalizeKey(identities?.account);
  const vela = normalizeKey(identities?.vela);
  if (account === undefined || vela === undefined) return "unknown";
  return account === vela ? "same" : "different";
}

/**
 * 剥掉网关的 `data` 包装：负载是 `{ data: { … } }` 时取里层，否则用负载自己
 * （形状不可信，两种都认；`data: null` 是「没有数据」而不是「读失败」）。
 * @param payload - 端点负载。
 * @returns 有效载荷对象，或 `undefined`。
 */
function payloadRecord(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  return isRecord(payload.data) ? payload.data : payload;
}

/**
 * 把端点的重置时刻转成 epoch 毫秒。数字按毫秒原样收下，字符串按 ISO 解析；缺失或解析不了
 * 就是「未知」，不补 0、不补当前时间（与另两家同一纪律）。
 * @param value - 端点给的 `resetsAt`。
 * @returns epoch 毫秒，或 `undefined`。
 */
function epochMillis(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const text = stringValue(value);
  if (text === undefined) return undefined;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** 已知时长（秒）→ 窗口键；5 小时与 7 天是厂商在发的两种，30/31 天留给未来的月度窗口。 */
const DURATION_KEYS: Readonly<Record<number, string>> = {
  18_000: "fiveHour",
  604_800: "weekly",
  2_592_000: "monthly",
  2_678_400: "monthly",
};

/**
 * 一个 preflight 窗口的键：已知时长映射成归一化键，未知时长**原样用秒数**当键
 * （不猜它是哪种周期），时长缺失时用空键（界面渲染成「额度」）。
 * @param duration - 端点给的 `durationSeconds`。
 * @returns 窗口键。
 */
function windowKeyOf(duration: unknown): string {
  const seconds = numberValue(duration);
  if (seconds === undefined) return "";
  return DURATION_KEYS[seconds] ?? String(seconds);
}

/**
 * 归一化一个 preflight 窗口。
 *
 * **上限（`cap`）优先用官方公布的美元值**，而不是从 credits 换算 —— 用户 2026-10-21
 * 明确要求「按照官方的实际口径来而不是靠推算」。
 *
 * 理由：接口给的 `creditsPerUsd`（实测 10000）与官方文档的窗口额度（Go 周 $30）
 * 对不上，算出来的上限只有实际的一半。与其用接口字段反推，不如直接采信官方文档：
 *
 * | 套餐 | 7 天窗口 | 5 小时窗口 |
 * | --- | --- | --- |
 * | Go | $30 | $10 |
 * | Plus | $40 | 不设 |
 * | Pro | $90 | 不设 |
 * | Max | $150 | 不设 |
 *
 * `used` 仍需要换算率（官方不公布「已用多少美元」），这时用「官方上限 ÷ 接口的
 * limitCredits」得到的比率 —— 它由两个已知量相除而来，与 `cap` 自洽。
 * @param raw - 端点给的一个窗口。
 * @param creditsPerUsd - 换算率（`creditsPerUsd` 或由上限反推，见 {@link ratioOf}）。
 * @param officialCap - 官方公布的这个窗口的美元上限（没有时 `undefined`）。
 * @returns 归一化窗口；整行不是对象时为 `undefined`。
 */
function windowOf(raw: unknown, creditsPerUsd: number | undefined, officialCap?: number): QuotaWindow | undefined {
  if (!isRecord(raw)) return undefined;
  const key = windowKeyOf(raw.durationSeconds);
  const resetAt = epochMillis(raw.resetsAt);
  const usedCredits = numberValue(raw.usedCredits);
  const limitCredits = numberValue(raw.limitCredits);

  // 上限：官方美元值优先。没有官方值时才退回「credits ÷ 换算率」。
  const cap =
    officialCap !== undefined && officialCap > 0
      ? officialCap
      : creditsPerUsd !== undefined && creditsPerUsd > 0 && limitCredits !== undefined
        ? limitCredits / creditsPerUsd
        : undefined;

  // 已用：官方不公布，只能按换算率折。用「官方上限 ÷ limitCredits」的比率最自洽。
  const ratio =
    officialCap !== undefined && officialCap > 0 && limitCredits !== undefined && limitCredits > 0
      ? limitCredits / officialCap
      : creditsPerUsd !== undefined && creditsPerUsd > 0
        ? creditsPerUsd
        : undefined;

  if (cap !== undefined || (ratio !== undefined && usedCredits !== undefined)) {
    const window: QuotaWindow = { key, unit: "usd" };
    if (usedCredits !== undefined && ratio !== undefined) window.used = usedCredits / ratio;
    if (cap !== undefined) window.cap = cap;
    if (resetAt !== undefined) window.resetAt = resetAt;
    return window;
  }

  const percent =
    usedCredits !== undefined && limitCredits !== undefined && limitCredits > 0
      ? Math.min(100, Math.max(0, (usedCredits / limitCredits) * 100))
      : undefined;
  const window: QuotaWindow = { key };
  if (percent !== undefined) window.percent = percent;
  if (resetAt !== undefined) window.resetAt = resetAt;
  // 超过上限是一个读数（不是错误）：百分比夹在 100，超出的部分靠 `exceeded` 表达。
  if (usedCredits !== undefined && limitCredits !== undefined && limitCredits > 0 && usedCredits > limitCredits) {
    window.exceeded = true;
  }
  return window;
}

/**
 * 把 preflight 负载里的窗口都归一化。
 *
 * 只认 `codingPlan.windows` 这一条路径（计划 §0 的线上形状）；`codingPlan` 缺失表示该账号
 * 没有周期套餐（不是失败），返回空数组。
 * @param preflight - `billing preflight` 的负载。
 * @param creditsPerUsd - 换算率（`creditsPerUsd` 或由官方上限反推）。
 * @param tier - 套餐档位；用来查官方窗口上限表（没有时只按换算率折）。
 * @returns 归一化窗口，按端点给的顺序。
 */
function windowsOf(preflight: unknown, creditsPerUsd: number | undefined, tier?: string): QuotaWindow[] {
  const record = payloadRecord(preflight);
  const codingPlan = record !== undefined && isRecord(record.codingPlan) ? record.codingPlan : undefined;
  const rows = codingPlan !== undefined && Array.isArray(codingPlan.windows) ? codingPlan.windows : [];
  const caps = tier === undefined ? undefined : WINDOW_CAP_USD[tier.trim().toLowerCase()];
  const windows: QuotaWindow[] = [];
  for (const row of rows) {
    // 官方上限：按时长查表（Go 的周窗口 = $30 等）。
    const duration = isRecord(row) ? numberValue(row.durationSeconds) : undefined;
    const field = duration === undefined ? undefined : DURATION_TO_CAP[duration];
    const officialCap = field === undefined ? undefined : caps?.[field];
    const window = windowOf(row, creditsPerUsd, officialCap);
    if (window !== undefined) windows.push(window);
  }
  return windows;
}

/**
 * 从 **preflight** 读套餐档位（`codingPlan.tier`）。
 *
 * 为什么需要这条来源（2026-10-21 实测）：`billing/summary` 与
 * `vela billing summary` **都回 403**，而套餐名一直是从前者读的 —— 于是真机上
 * 套餐徽标永远是空的（用户报障「opendesign 部分显示不全」）。同一个账号的
 * `billing preflight` 却稳定给出 `codingPlan.tier`（实测 `"go"`），而这份数据本来
 * 每次都在读（额度窗口就来自它），等于**白拿**。
 *
 * 只取档位：`codingPlan` 里没有套餐状态与账期，不编。
 * @param preflight - `billing preflight` 的负载。
 * @returns 套餐（只有 `id`/`name`）；没有 `codingPlan` 或没给 tier 时 `undefined`。
 */
function planFromPreflight(preflight: unknown): QuotaPlan | undefined {
  const record = payloadRecord(preflight);
  if (record === undefined || !isRecord(record.codingPlan)) return undefined;
  // `eligible: false` 表示这个工作区没有周期套餐 —— 那时 tier 即使有值也不可信。
  if (record.codingPlan.eligible === false) return undefined;
  const tier = stringValue(record.codingPlan.tier);
  if (tier === undefined) return undefined;
  const plan: QuotaPlan = { id: tier, name: tier };
  return plan;
}

/**
 * 归一化账单摘要里的套餐。`membershipTier` 是标识也是展示名（厂商没有单独的展示名），
 * `subscriptionStatus` 原样透传（开放词表，界面认不出的原样显示）。
 *
 * 字段名**宽容读取**：厂商文档写的是 `membershipTier` / `subscriptionStatus` /
 * `subscriptionCurrentPeriodEnd`，但同一家的不同网关/版本用过 `tier`、`plan`、`status`、
 * `currentPeriodEnd`，也可能把订阅包在 `subscription` 子对象里。名字对不上就整块套餐消失
 * 是用户看到的现象（「套餐信息也没有」），所以这里按优先级依次认。
 * @param summary - `/billing/summary` 的负载。
 * @returns 套餐；标识与状态都没有时为 `undefined`。
 */
function planOf(summary: unknown): QuotaPlan | undefined {
  const record = payloadRecord(summary);
  if (record === undefined) return undefined;
  const nested = isRecord(record.subscription) ? record.subscription : undefined;
  const pick = (names: readonly string[]): unknown => {
    for (const name of names) {
      const value = record[name] ?? nested?.[name];
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const tier = stringValue(pick(["membershipTier", "membership", "tier", "plan", "subscriptionTier"]));
  const status = stringValue(pick(["subscriptionStatus", "status", "subscriptionState"]));
  if (tier === undefined && status === undefined) return undefined;
  const plan: QuotaPlan = { id: tier ?? "" };
  if (tier !== undefined) plan.name = tier;
  if (status !== undefined) plan.status = status;
  const periodEnd = epochMillis(pick(["subscriptionCurrentPeriodEnd", "currentPeriodEnd", "periodEnd", "renewsAt"]));
  if (periodEnd !== undefined) plan.periodEnd = periodEnd;
  // 本期**起点**：线上真的给（2026-10-19 实测 `subscriptionCurrentPeriodStart`），
  // 有它就不必用「往前一个日历月」去推 —— 两个日期都是厂商自己的账期边界。
  const periodStart = epochMillis(pick(["subscriptionCurrentPeriodStart", "currentPeriodStart", "periodStart"]));
  if (periodStart !== undefined) plan.periodStart = periodStart;
  return plan;
}

/** 摘要里的换算率（`creditsPerUsd`）；缺失或非正数读作「没有换算率」。 */
function creditsPerUsdOf(summary: unknown): number | undefined {
  const record = payloadRecord(summary);
  const value = record === undefined ? undefined : numberValue(record.creditsPerUsd);
  return value !== undefined && value > 0 ? value : undefined;
}

/**
 * 官方公布的**窗口上限（美元）**：`open-design.ai/zh/model-credits` 的套餐构成表
 * （抓于 2026-10-21）。
 *
 * | 套餐 | 月度总额 | 7 天窗口 | 5 小时窗口 |
 * | --- | --- | --- | --- |
 * | Go | $120 | $30 | $10 |
 * | Plus | $180 | $40 | 不设此窗口 |
 * | Pro | $480 | $90 | 不设此窗口 |
 * | Max | $900 | $150 | 不设此窗口 |
 *
 * **为什么需要它**：`billing/summary` 回 403（拿不到 `creditsPerUsd`），于是窗口只能
 * 退回百分比口径 —— 用户看不到「还剩多少美元」。而官方这张表给了每个窗口的美元上限，
 * 拿它除以接口给的 `limitCredits` 就能**反推出换算率**，把美元口径补回来。
 *
 * 2026-10-21 的实际影响：Go 套餐的周窗口 `limitCredits = 150000`，官方说是 $30，
 * 所以换算率是 **5000**；而仓库文档里早期记的 `creditsPerUsd: 10000` 会让同一窗口
 * 显示成 $15 —— 用户看到「共 $15.00」就是这个原因（他实际是 $30）。
 */
const WINDOW_CAP_USD: Readonly<Record<string, { monthly: number; weekly: number; fiveHour?: number }>> = {
  go: { monthly: 120, weekly: 30, fiveHour: 10 },
  plus: { monthly: 180, weekly: 40 },
  pro: { monthly: 480, weekly: 90 },
  max: { monthly: 900, weekly: 150 },
};

/** 窗口时长（秒）→ 官方上限表里的字段。 */
const DURATION_TO_CAP: Readonly<Record<number, "monthly" | "weekly" | "fiveHour">> = {
  18_000: "fiveHour",
  604_800: "weekly",
  2_592_000: "monthly",
  2_678_400: "monthly",
};

/**
 * 从**官方窗口上限**反推换算率（`creditsPerUsd` 的替代来源）。
 *
 * 思路：官方告诉我们「这个套餐的 7 天窗口是 $30」，接口告诉我们「这个窗口的
 * limitCredits 是 150000」——两者相除就是换算率。只在 `billing/summary` 拿不到
 * 换算率时才用，且**必须有一档能对上**，否则返回 `undefined`（不猜）。
 *
 * @param preflight - `billing preflight` 的负载（提供 `limitCredits`）。
 * @param tier - 套餐档位（`codingPlan.tier`）。
 * @returns 换算率（credits / USD）；推不出来时 `undefined`。
 */
function creditsPerUsdFromCaps(preflight: unknown, tier: string | undefined): number | undefined {
  if (tier === undefined || tier === "") return undefined;
  const caps = WINDOW_CAP_USD[tier.trim().toLowerCase()];
  if (caps === undefined) return undefined;
  const record = payloadRecord(preflight);
  if (record === undefined || !isRecord(record.codingPlan)) return undefined;
  const rows = Array.isArray(record.codingPlan.windows) ? record.codingPlan.windows : [];
  // 用**最细的已知窗口**反推：分母越小，浮点误差越小；同时它也是各家最先公布的那档。
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const duration = numberValue(row.durationSeconds);
    if (duration === undefined) continue;
    const field = DURATION_TO_CAP[duration];
    if (field === undefined) continue;
    const cap = caps[field];
    if (cap === undefined || cap <= 0) continue;
    const limit = numberValue(row.limitCredits);
    if (limit === undefined || limit <= 0) continue;
    const rate = limit / cap;
    // 换算率必须是正有限数；落到这个量级之外的说明数据形状不对，不采信。
    if (Number.isFinite(rate) && rate > 0) return rate;
  }
  return undefined;
}


/**
 * 摘要里**钱包**的消耗（`totalConsumedUsd` / `todayConsumedUsd`）。
 *
 * 2026-10-19 实测：订阅套餐用户这里是 **0.0000**（`usageCount` 已有 1080 次请求）——
 * 套餐用量走的是 credit 窗口（5 小时 50000 / 周 150000），不扣钱包。所以它**不能**当
 * 「本套餐周期用了多少」：那样月度条会永远显示「已用 $0」，比显示「—」更误导。
 *
 * 保留这一读只为「钱包余额」那类显示（本期尚未接），**不**用来填月度窗口的 `used`。
 * @param summary - `/billing/summary` 或 vela summary 的负载。
 * @returns 钱包消耗（美元）；缺失时 `undefined`。
 */
export function walletConsumedUsdOf(summary: unknown): number | undefined {
  const record = payloadRecord(summary);
  if (record === undefined) return undefined;
  return numberValue(record.totalConsumedUsd) ?? numberValue(record.periodConsumedUsd);
}

// monthlyWindowOf 已移除（2026-10-23）：厂商不发月度窗口，本地合成的上限+本机用量
// 会让人误以为那是「账户月度总额度」。用量块已如实回答「本机这一期用了多少」。

/**
 * 把两个来源的负载归一化成一次额度读数。纯函数：不做 I/O、不缓存。
 * @param parts - 账单摘要、preflight 负载与已记名的失败项。
 * @returns 归一化读数；窗口顺序 = preflight 给的顺序（补的月度窗口排最后）。
 */
export function toQuotaSnapshot(parts: OpenDesignQuotaParts): QuotaSnapshot {
  // 套餐优先取**账单摘要**（它还有状态与账期），摘要是空的时候回退到
  // preflight 的 `codingPlan.tier` —— 那条路稳定可达，否则套餐徽标永远是空的。
  const plan = planOf(parts.summary) ?? planFromPreflight(parts.preflight);
  /**
   * **窗口上限直接采信官方公布的美元值**（`WINDOW_CAP_USD`），不靠换算推算 ——
   * 2026-10-21 明确的口径：接口的 `creditsPerUsd`（实测 10000）与官方文档
   * （Go 周窗口 $30，对应 5000）对不上，算出来的上限只有实际的一半。
   *
   * 换算率只用来算「已用多少美元」：官方上限 ÷ 接口的 `limitCredits`。
   * 两者都拿不到时退回 `creditsPerUsd`，再不行就进百分比口径。
   */
  const creditsPerUsd =
    creditsPerUsdFromCaps(parts.preflight, plan?.id) ??
    creditsPerUsdOf(parts.summary);
  const windows = windowsOf(parts.preflight, creditsPerUsd, plan?.id);
  return {
    // **只发布厂商真实返回的窗口**（2026-10-23 去掉了本地补的月度窗口）：
    // 那个窗口的上限来自本地价格表、用量来自本机台账，画成进度条会让人误以为
    // 是「账户月度总额度」。厂商只发五小时与每周两档，就只显示这两档。
    windows,
    ...(plan === undefined ? {} : { plan }),
    failures: [...parts.failures],
  };
}

/** 去掉基地址末尾的斜杠（用户可能把 `/api/v1/` 写进来）。 */
function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

/**
 * Open Design 的额度端口。
 *
 * `snapshot()` 的顺序：解析当前账号的控制面密钥 → `GET /billing/summary` →（配置了
 * workspaceId 且注入了 preflight 时）vela 周期额度。**每个来源各自 try/catch**，失败只把
 * 一句人话记进 `failures`，其余照常返回。没有控制面密钥时抛 `MISSING_CREDENTIAL`，一个端点
 * 都不请求（与另两家同一语义）：缺密钥是「账号没配全」，不是「额度读不到」。
 * @param deps - 账号 ref、密钥解析、工作区解析、`fetch`、vela 与基地址/预算。
 * @returns 额度端口。
 */
export function createOpenDesignQuota(deps: OpenDesignQuotaDeps): QuotaPort {
  const base = trimBase(
    deps.walletBase === undefined || deps.walletBase.trim() === "" ? DEFAULT_WALLET_BASE_URL : deps.walletBase,
  );
  const timeoutMs =
    deps.timeoutMs !== undefined && Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0
      ? deps.timeoutMs
      : DEFAULT_QUOTA_TIMEOUT_MS;

  /**
   * 拉一次账单摘要。失败时**带上原因**：套餐/额度整块缺席时，界面只有一句「没有数据」
   * 对用户毫无帮助（本机报障：「套餐信息也没有」—— 到底是被拒、超时，还是这个账号本来
   * 就没有订阅，三种情况该说三种话）。
   * @param key - 控制面密钥（缺省回退到推理密钥）。
   * @returns 负载，或失败原因（人话）。
   */
  async function getSummary(key: string): Promise<{ payload?: unknown; problem?: string }> {
    try {
      const response = await deps.fetchImpl(`${base}${BILLING_SUMMARY_PATH}`, {
        headers: { Authorization: `Bearer ${key}`, ...IDENTITY_ENCODING_HEADER },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        return { problem: `账单接口返回 HTTP ${response.status}` };
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload)) return { problem: "账单接口返回了认不出的正文" };
      return { payload };
    } catch (error) {
      return { problem: `账单接口不可达（${messageOf(error)}）` };
    }
  }

  return {
    async snapshot(accountRef?: string): Promise<QuotaSnapshot> {
      const ref = accountRef ?? deps.ref();
      const key = ref === undefined ? undefined : normalizeKey(await deps.resolveControlKey(ref));
      if (key === undefined) {
        const account = ref === undefined ? "(none selected)" : `"${ref}"`;
        throw new LlmError(
          `llm-opendesign: no usable control key for Open Design account ${account}; store it through the credentials service, export it in the launching environment, or run \`vela login\``,
          "MISSING_CREDENTIAL",
        );
      }
      const failures: string[] = [];
      const read = await getSummary(key);
      let summary = read.payload;
      let readProblem = read.problem;
      if (summary === undefined && deps.summaryFallback !== undefined) {
        // 控制面拒绝（401/403）或不可达时的第二来源：本机 vela 自己的登录态。
        try {
          const fallback = await deps.summaryFallback();
          if (fallback !== undefined) {
            summary = fallback;
            readProblem = undefined;
          }
        } catch (error) {
          readProblem = `${readProblem ?? "没有返回数据"}；vela 回退也失败（${messageOf(error)}）`;
        }
      }
      if (summary === undefined) {
        // **按「缺的是哪把密钥」给不同的说明**（2026-10-21，多账号额度诊断）。
        //
        // 两种失败都表现为「账单接口 401」，但用户该做的事完全不同：一个有救（重登），
        // 一个没救（这个账号从来没配过控制面密钥）。旧文案只有后半句，
        // 用户切到那个账号只看到「额度读不到」，不知道该登一次还是该换账号。
        const kind = ref === undefined || deps.controlKeyKind === undefined ? undefined : await deps.controlKeyKind(ref);
        if (kind === "inference-only" || kind === "none") {
          failures.push(
            kind === "inference-only"
              ? "这个账号只有推理密钥（sk-amr…），没有控制面密钥（vela_ctrl…），所以读不到余额与周期额度。这条链只认控制面密钥 —— 请用**网页登录**重新登录这个账号一次，它会把这个账号的 vela_ctrl… 自动导入；重试或换密钥都无效。"
              : "这个账号还没有任何可用密钥：余额与周期额度需要控制面密钥（vela_ctrl…），请用网页登录登录一次，或在设置里填一把 API key 用于推理。",
          );
        } else {
          failures.push(`账单摘要读取失败（${readProblem ?? "没有返回数据"}）：套餐信息与额度换算单位暂时缺失`);
        }
      }
      let preflight: unknown;
      const workspaceId = ref === undefined ? undefined : normalizeKey(await deps.workspaceIdOf(ref));
      if (workspaceId !== undefined && ref !== undefined && (deps.preflightHttp !== undefined || deps.preflight !== undefined)) {
        /**
         * **优先走 HTTP**（2026-10-21 发现，多账号额度的正解）。
         *
         * `GET /workspaces/{ws}/billing/preflight` 用**这个账号自己的控制面密钥**鉴权，
         * 返回的东西与 `vela billing preflight` 完全一致（实测字段逐项相同：
         * `codingPlan.windows[].usedCredits / limitCredits / resetsAt`）。
         *
         * 为什么它才是正解：vela CLI 没有 `--key` 参数，永远拿**本机登录态**那份身份去查 ——
         * 同一网关挂第二个人的账号时，它返回的是别人的用量，只能靠身份闸门整段跳过。
         * HTTP 版按账号鉴权，所以**每个账号都能拿到自己的准确数字**，不需要闸门。
         *
         * 顺序有意为之：HTTP 能通就绝不用 vela（那条路有身份歧义）；HTTP 失败
         * （老版本没这个端点 / 网络问题）才退回 vela，那时仍然要过身份闸门。
         */
        const viaHttp = await tryHttpPreflight(workspaceId, deps);
        if (viaHttp.ok) {
          preflight = viaHttp.value;
        } else if (deps.preflight !== undefined) {
          const identityVerdict = await checkPreflightIdentity(ref, deps);
          if (identityVerdict !== "same") {
            failures.push(
              identityVerdict === "different"
                ? "周期额度：HTTP 接口不可用，退回本机 vela 查询；而 vela 登录态与本账号不是同一个人，为避免显示别人的用量已跳过（余额与套餐仍然准确）"
                : "周期额度：HTTP 接口不可用，退回本机 vela 查询；无法确认登录态与本账号是否同一人，已跳过（余额与套餐仍然准确）",
            );
          } else {
            try {
              const value = await deps.preflight(workspaceId);
              if (value === undefined) {
                failures.push("周期额度查询没有返回数据：本机 vela 没给出可用的读数");
              } else {
                preflight = value;
              }
            } catch (error) {
              // vela 找不到、退出非零、输出不是 JSON 都在这里变成一句人话，绝不倒成 0。
              failures.push(`周期额度查询失败：${messageOf(error)}`);
            }
          }
        } else {
          failures.push(`周期额度查询失败：${viaHttp.reason}`);
        }
      } else if (workspaceId === undefined) {
        // 没有工作区就**一定**没有额度窗口（窗口只来自 vela 的 codingPlan）。以前这里是静默
        // 跳过：界面上「没有条」和「读到了但为空」长得一样，用户只会说「没获取到额度」。
        failures.push(
          ref === undefined
            ? "未选中账号：周期额度需要先选一个账号"
            : "该账号未配置工作区：周期额度需要 workspaceId（网页登录会自动写入，也可在设置里手填）",
        );
      }
      return toQuotaSnapshot({
        ...(summary === undefined ? {} : { summary }),
        ...(preflight === undefined ? {} : { preflight }),
        failures,
      });
    },
  };
}
