/**
 * opencode 额度：`GET {baseURL}/usage` → 归一化的 {@link QuotaSnapshot}。
 *
 * 端点、请求头与归一化口径逐条对照旧插件
 * `dsh-opencode-go/lib/index.js`：
 * - 端点与请求头（`fetchUsage` **第 7898-7906 行**）：`{baseURL}/usage`、
 *   `Accept: application/json`、`Authorization: Bearer <key>`、`AbortSignal.timeout(1e4)`
 *   （10 秒预算）、`redirect: "error"`、正文上限 `USAGE_MAX_BYTES = 1 MiB`（第 7822 行）；
 * - 负载形状（`parseGoUsage` **第 7762-7783 行**）：窗口在顶层 `usage` 对象里，
 *   `usage.rolling` / `usage.weekly` / `usage.monthly`，每项
 *   `{ status: "ok" | "rate-limited", percent: 0–100, resetsAt: ISO 字符串 }`；
 * - 错误语义（第 7907-7934 行）：408/429/5xx **可重试并保留上一次读数**，其它状态不可
 *   重试；传输失败可重试且可保留；正文不可解析或超字节上限时**可重试但不保留**
 *   （旧插件的 `invalid` 分支）；凭据**解析失败**（非 `MISSING_CREDENTIAL`）可重试但不保留
 *   （第 7864-7873 行），凭据缺失不可重试（第 7875-7881 行）；负载整体认不出来时可重试但
 *   不保留（第 7925-7934 行的 `Invalid OpenCode Go usage response`）。
 *
 * **与旧插件的取舍**：旧插件的 `parseGoUsage` 是全有或全无（任何一条窗口不合法就整次
 * 读取失败），本模块按「坏到什么程度」分两档：
 * - **负载整体认不出来**（不是对象、没有 `usage`、`usage` 不是对象）仍然整次失败 ——
 *   这种 200 响应一次形状漂移就可能把上一次读数换成「干净的空读数」，而 UI 分辨不出
 *   「端点报告没有数据」与「端点换了形状」；
 * - **`usage` 是对象、只有个别窗口不合法**：合法的窗口照常返回，不合法的窗口**不造出来**、
 *   只把窗口名记进 `failures`（设计 §12 Review Focus 4「缺失不倒成 0」），坏数据不会让
 *   整个额度面板变空，也不会伪装成 0%。
 *
 * **单位**：{@link OpencodeQuotaKey} 说明每个 key 的含义；`percent` 一律 0–100（超出范围
 * 视为端点未报告），`resetAt` 一律 epoch 毫秒（端点的 `resetsAt` 是 ISO 字符串，在此转换）。
 * @module dsh-llm-account/src/vendors/opencode/quota
 */
import { LlmError, attributionHeaders } from "@deepseek-ai/dsh-llm";

import type { QuotaPort, QuotaSnapshot, QuotaWindow } from "../../core/adapter";
import { normalizeKey } from "../../core/credentials";
import { DEFAULT_BASE_URL, isRecord, trimBase } from "./protocol";

/** 额度端点路径（旧插件 `fetchUsage` 第 7899 行）。 */
export const USAGE_PATH = "/usage";

/**
 * 一次额度请求最多读多少字节（旧插件第 7822 行）。
 * 超限按旧插件的 `RangeError` 分支处置：可重试、不保留上一次读数。
 */
export const USAGE_MAX_BYTES = 1024 * 1024;

/** 一次额度请求的预算（旧插件第 7904 行的 `AbortSignal.timeout(1e4)`）。 */
export const DEFAULT_USAGE_TIMEOUT_MS = 10_000;

/**
 * 旧插件抛出的错误码（第 7840-7933 行）。本适配器用它作 {@link OpencodeUsageError}
 * 的 `code`：宿主按 `code` 判重试，`retryable` / `retainPrevious` 是本适配器附加的
 * 判定字段，见 {@link OpencodeUsageError}。
 */
export const USAGE_UNAVAILABLE_CODE = "opencode-go/usage-unavailable";

/**
 * 本适配器产出的 `QuotaWindow.key` 词表（`QuotaWindow.key` 是字符串，这里只做文档与
 * 调用方收窄用）。三个 key 都是端点公布的用量窗口，`percent` 的单位是**百分比**（0–100），
 * 与 commandcode 侧 `used`/`cap` 的 token 数不是一回事。
 */
export type OpencodeQuotaKey = "rolling" | "weekly" | "monthly";

/** 会产生窗口的窗口名（顺序即输出顺序，与旧插件 `parseGoUsage` 的循环次序一致）。 */
const WINDOW_KEYS: readonly OpencodeQuotaKey[] = ["rolling", "weekly", "monthly"];

/**
 * 额度不可用的错误：`code` 固定为 {@link USAGE_UNAVAILABLE_CODE}，额外带上旧插件
 * `RemoteError` details 里的两个判定字段。
 *
 * 用 `LlmError` 子类而不是往共享内核加字段：`LlmError` 是宿主包
 * （`@deepseek-ai/dsh-llm`）的类型，挂载本项目的额度语义必须落在本适配器里；
 * 而 `LlmError` 的 `options` 已经支持 `status` / `cause`，子类只需要补两个只读字段。
 *
 * 两个字段的语义（旧插件第 7907-7934 行）：
 * - `retryable`：这次失败是否值得重试（408/429/5xx、传输失败、正文/超限失败为 `true`；
 *   其它状态与「没有可用密钥」为 `false`）。
 * - `retainPrevious`：UI 是否应当**继续显示上一次读数**（旧插件用它区分「暂时读不到」与
 *   「读到的东西不可信」：正文解析失败与超限是后者，所以为 `false`）。
 */
export class OpencodeUsageError extends LlmError {
  /** 这次失败是否值得重试。 */
  readonly retryable: boolean;

  /** 是否应当保留并继续显示上一次读数。 */
  readonly retainPrevious: boolean;

  /**
   * @param message - 面向人的说明。
   * @param options - 重试判定与（可选的）HTTP 状态、原始异常。
   */
  constructor(message: string, options: { retryable: boolean; retainPrevious: boolean; status?: number; cause?: unknown }) {
    super(message, USAGE_UNAVAILABLE_CODE, {
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.retryable = options.retryable;
    this.retainPrevious = options.retainPrevious;
  }
}

/** 额度端口的依赖。取数用的密钥与账号都要注入，端口自己不依赖 `ctx`。 */
export interface OpencodeQuotaDeps {
  /** 这一读要报告的账号 ref；`undefined` 表示当前没有选中账号。 */
  ref: () => string | undefined;
  /** 解析该 ref 的密钥（凭据服务 / 环境变量 / auth.json 的注入点）。 */
  resolveKey: (ref: string) => Promise<string | undefined>;
  /** 注入的 `fetch`（生产传全局 `fetch`）。 */
  fetchImpl: typeof fetch;
  /** 网关基地址；缺省 {@link DEFAULT_BASE_URL}。 */
  apiBase?: string;
  /** 请求预算（毫秒）；缺省 {@link DEFAULT_USAGE_TIMEOUT_MS}。 */
  timeoutMs?: number;
}

/** 读取非空字符串。 */
function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * 把端点的 `resetsAt`（ISO 字符串）转成 epoch 毫秒。数字按毫秒原样收下（端点若改了形状
 * 也能用），缺失或解析不了就是「未知」，不补 0、不补当前时间。
 * @param value - 端点给的 `resetsAt`。
 * @returns epoch 毫秒，或 `undefined` 表示未公布/不可解析。
 */
function epochMillis(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const text = stringValue(value);
  if (text === undefined) return undefined;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * 归一化一条窗口读数。旧插件的 `parseGoUsage` 对这三项是**全有**要求（第 7777 行），
 * 本模块把整条窗口当成一个不可分割的读数：三项里任何一项缺失或非法，就认为这条窗口
 * 「不可信」→ 不产出窗口（调用方记名），绝不把 `percent` 倒成 0 或把 `resetsAt` 丢掉。
 * @param raw - 端点给的窗口块。
 * @param key - 窗口 key。
 * @returns 归一化窗口；形状不认识或字段非法时为 `undefined`。
 */
function windowOf(raw: unknown, key: OpencodeQuotaKey): QuotaWindow | undefined {
  if (!isRecord(raw)) return undefined;
  const status = stringValue(raw.status);
  if (status !== "ok" && status !== "rate-limited") return undefined;
  const percent = raw.percent;
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) return undefined;
  const resetAt = epochMillis(raw.resetsAt);
  if (resetAt === undefined) return undefined;
  // `rate-limited` 即「已超出」；`ok` 是明确的「未超出」，所以两种状态都给出布尔值。
  return { key, percent, exceeded: status === "rate-limited", resetAt };
}

/**
 * 从端点的顶层负载里取出 `usage` 对象（旧插件第 7926 行的
 * `body.usage`；负载自己就是 usage 对象的浅层形状同样接受）。
 * @param payload - `/usage` 的已解析负载。
 * @returns usage 记录；形状不认识时为 `undefined`。
 */
function usageRecord(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  if (isRecord(payload.usage)) return payload.usage;
  // 浅层形状：负载自己带窗口字段时（没有 `usage` 包裹）也认。
  return WINDOW_KEYS.some((key) => Object.hasOwn(payload, key)) ? payload : undefined;
}

/**
 * 把「形状不认识」的负载统一成一个已分类的错误（旧插件 `parseGoUsage` 在
 * `body.usage` 不合法时抛 `Invalid OpenCode Go usage response`，第 7925-7934 行）。
 *
 * 旧插件对**每一条窗口**都要求齐全（第 7777 行），所以它的「不合法」覆盖了「窗口字段缺失」
 * 与「usage 缺失」两种情况。本模块刻意拆开这两者：
 * - **`usage` 缺失或不是对象** → 「端点变了形状」，不可信 → 抛本错误（`retryable: true`、
 *   `retainPrevious: false`）；
 * - **`usage` 是对象但窗口字段缺失或非法** → 合法但空/部分读数，逐窗口记名（见 `toQuotaSnapshot`）。
 *
 * 这样一次形状漂移不会被当成「端点报告了空用量」，也不会静默覆盖上一次读数。
 * @returns 已分类的错误（由调用方抛出，便于纯函数在 `unknown` 上收窄后直接 `throw`）。
 */
function unknownUsageShape(): OpencodeUsageError {
  return new OpencodeUsageError("Invalid OpenCode Go usage response", {
    retryable: true,
    retainPrevious: false,
  });
}

/**
 * 把 `/usage` 的负载归一化成一次额度读数。
 *
 * 规则（控制器补充 1）：
 * - `key` 用窗口名（`rolling` / `weekly` / `monthly`），输出顺序固定；
 * - `percent` 原样保留（0–100），`resetsAt` 转 **epoch 毫秒**；
 * - `status === "rate-limited"` → `exceeded: true`，`status === "ok"` → `exceeded: false`；
 * - **缺失的窗口不造出来**；形状不认识的**窗口**丢弃并把窗口名记进 `failures`；
 * - **负载整体认不出来**（不是对象、没有 `usage`、`usage` 不是对象）→ 抛
 *   {@link OpencodeUsageError}（`retryable: true`、`retainPrevious: false`），
 *   不返回一个「干净的空读数」。
 *
 * **合法但空**的形状只有一种：`usage` 是对象而三个窗口字段一个都没有（例如 `{ usage: {} }`）
 * —— 那是端点明确报告「当前没有窗口数据」，返回 `{ windows: [], failures: [] }` 是诚实的。
 *
 * 纯函数：不做 I/O、不缓存（抛错的判定也只看入参）。
 * @param payload - `/usage` 的已解析负载（`unknown`：形状不可信，逐字段收窄）。
 * @returns 归一化读数。
 * @throws {OpencodeUsageError} 负载整体认不出来时。
 */
export function toQuotaSnapshot(payload: unknown): QuotaSnapshot {
  const usage = usageRecord(payload);
  if (usage === undefined) throw unknownUsageShape();
  const windows: QuotaWindow[] = [];
  const failures: string[] = [];
  for (const key of WINDOW_KEYS) {
    const raw = usage[key];
    // 窗口字段不存在 = 端点没公布这个窗口：既不是失败，也不造 0%。
    if (raw === undefined) continue;
    const window = windowOf(raw, key);
    if (window === undefined) failures.push(key);
    else windows.push(window);
  }
  return { windows, failures };
}

/**
 * 读一段有界正文：先按 `content-length` 提前拒绝，再按实际字节数兜底（旧插件的
 * `USAGE_MAX_BYTES` 语义；`Response.text()` 无法中途截断，所以先看声明再读）。
 * @param response - 已经拿到的响应。
 * @returns 正文文本。
 * @throws {RangeError} 超过 {@link USAGE_MAX_BYTES} 时。
 */
async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > USAGE_MAX_BYTES) {
    throw new RangeError(`response exceeds the ${USAGE_MAX_BYTES} byte limit`);
  }
  const text = await response.text();
  // 没有 content-length（分块传输）时按真实长度兜底。
  if (Buffer.byteLength(text, "utf8") > USAGE_MAX_BYTES) {
    throw new RangeError(`response exceeds the ${USAGE_MAX_BYTES} byte limit`);
  }
  return text;
}

/** 没有可用密钥（旧插件第 7875-7881 行语义：重试没有意义，也没有可信的旧读数）。 */
function missingKeyError(): OpencodeUsageError {
  return new OpencodeUsageError("OpenCode Go API key is not configured", { retryable: false, retainPrevious: false });
}

/**
 * opencode 的额度端口。`snapshot()` 的顺序：解析当前账号密钥 → `GET {base}/usage` →
 * 归一化。失败一律抛 {@link OpencodeUsageError}（带 `retryable` / `retainPrevious`）；
 * 没有可用密钥时抛同一个错误类的 `retryable: false` 分支，**一个请求都不发**
 * （旧插件第 7864-7881 行的同一语义）。
 * @param deps - 账号 ref、密钥解析、`fetch` 与基地址/预算。
 * @returns 额度端口。
 */
export function createOpencodeQuota(deps: OpencodeQuotaDeps): QuotaPort {
  const base = trimBase(normalizeKey(deps.apiBase) ?? DEFAULT_BASE_URL);
  const timeoutMs =
    deps.timeoutMs !== undefined && Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0
      ? deps.timeoutMs
      : DEFAULT_USAGE_TIMEOUT_MS;

  return {
    async snapshot(accountRef?: string): Promise<QuotaSnapshot> {
      const ref = accountRef ?? deps.ref();
      // 凭据**解析失败**与「解析成功但为空」是两回事（旧插件第 7864-7881 行）：
      // - 抛出，且 code 是 `MISSING_CREDENTIAL`：这个账号就是没配密钥，重试也不会变 → 不重试；
      // - 抛其它错：凭据服务/环境读取本身失败（可能瞬时），旧插件给 `retryable: true`
      //   且 `retainPrevious: false`（解析都没成功，谈不上「上一次读数仍可信」）；
      // - 解析成空串/纯空白：按「没配密钥」处理。
      // 三种都必须是**已分类**的 `OpencodeUsageError`：裸抛出去调用方既拿不到 code，
      // 也不知道该不该重试、该不该保留上一次读数。
      let resolved: string | undefined;
      if (ref !== undefined) {
        try {
          resolved = await deps.resolveKey(ref);
        } catch (error) {
          if (isRecord(error) && error.code === "MISSING_CREDENTIAL") throw missingKeyError();
          throw new OpencodeUsageError(`Could not resolve the OpenCode Go API key for account "${ref}"`, {
            retryable: true,
            retainPrevious: false,
            cause: error,
          });
        }
      }
      const key = normalizeKey(resolved);
      if (key === undefined) throw missingKeyError();

      let response: Response;
      try {
        response = await deps.fetchImpl(`${base}${USAGE_PATH}`, {
          headers: { accept: "application/json", Authorization: `Bearer ${key}`, ...attributionHeaders() },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "error",
        });
      } catch (error) {
        // 传输失败（连接、超时、重定向被拒）：值得重试，且上一次读数仍然可信。
        throw new OpencodeUsageError(`Could not read ${base}${USAGE_PATH}: transport failure`, {
          retryable: true,
          retainPrevious: true,
          cause: error,
        });
      }

      if (!response.ok) {
        // 408/429/5xx 是瞬时故障：可重试、可保留上一次读数；其它状态不可重试。
        const temporary = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new OpencodeUsageError(`OpenCode Go usage unavailable (HTTP ${response.status})`, {
          retryable: temporary,
          retainPrevious: temporary,
          status: response.status,
        });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(await readBoundedText(response));
      } catch (error) {
        // 正文不可解析 / 超字节上限：这次读到的内容不可信，所以**不**保留上一次读数。
        const detail =
          error instanceof RangeError
            ? `response exceeds the ${USAGE_MAX_BYTES} byte limit`
            : error instanceof SyntaxError
              ? "invalid JSON response"
              : "unreadable response body";
        throw new OpencodeUsageError(`Could not read ${base}${USAGE_PATH}: ${detail}`, {
          retryable: true,
          retainPrevious: false,
          cause: error,
        });
      }

      return toQuotaSnapshot(payload);
    },
  };
}
