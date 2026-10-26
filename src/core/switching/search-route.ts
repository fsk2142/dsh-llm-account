/**
 * 统一搜索的**选路判定**（纯函数）。
 *
 * 需求：「统一都用 deepseek 的搜索，API 优先用我们登录的供应商账号额度，
 * 如果没有就使用我们自己添加的 API 调用搜索」。
 *
 * ## 为什么必须先判定再发请求
 *
 * 2026-10-20 用真实密钥实测（见设计文档 §2.2）：
 *
 * | 组合 | 结果 |
 * | --- | --- |
 * | opendesign `/v1/messages` + `web_search_20250305` + `deepseek-v4.1-flash` | **200，20 条真结果** |
 * | opendesign 同端点 + `glm-5.3-flash` / `claude-haiku-5.5` | **400** |
 * | opendesign `/v1/chat/completions` + `web_search` | **200 但静默忽略**（模型只输出「web_search query:」） |
 * | commandcode `/provider/v1/messages` + DeepSeek | **400**（该端点只收 Claude 系） |
 *
 * 也就是说「网关能用」这个前提**只对 opendesign + DeepSeek 系成立**。其余组合必须回退到
 * API key，否则要么 400、要么更糟的静默降级。
 * @module dsh-llm-account/src/core/switching/search-route
 */

/** 一次搜索实际走哪条路。 */
export type SearchRoute =
  /** 用网关订阅额度（`baseURL` 是那家网关、`key` 是它账号的推理密钥）。 */
  | { kind: "gateway"; provider: string }
  /** 用用户写入的 DeepSeek API key（直连 `/v1/tools/search`）。 */
  | { kind: "api" }
  /** 两条路都不可用：**明确失败**，绝不发一个注定 400 或静默无为的请求。 */
  | { kind: "unavailable" };

/**
 * 搜索优先策略（用户可选）。
 *
 * 两条路的成本结构完全不同，所以必须让用户选：
 * - `gateway` 走「模型在对话里调服务端搜索工具」，按 **token** 计费 ——
 *   一次搜索就是一次完整模型调用；
 * - `api` 走 `POST /v1/tools/search`，按**请求次数**计费（每 1000 次 5 元），不烧 token。
 *
 * `*-first` 是「优先但可回退」，`*-only` 是「不许回退，不可用就明确失败」，
 * `off` 是「完全不启用网页搜索」。
 */
export type SearchStrategy = "gateway-first" | "api-first" | "gateway-only" | "api-only" | "off";

/** 全部策略（渲染下拉与校验都用这一份，避免两处各写一遍）。 */
export const SEARCH_STRATEGIES: readonly SearchStrategy[] = [
  "gateway-first",
  "api-first",
  "gateway-only",
  "api-only",
  "off",
];

/** 缺省策略：网关优先 —— 用订阅额度，不额外花钱。 */
export const DEFAULT_SEARCH_STRATEGY: SearchStrategy = "gateway-first";

/**
 * 用户是否**关掉了**网页搜索。
 *
 * 只在显式选 `off` 时为真：缺失、空串、其它值一律算启用 —— 线上值形状不可信，
 * 把「没配过」当成关闭会让搜索莫名其妙不可用。
 * @param strategy - 设置文档里的策略值。
 * @returns 是否关闭。
 */
export function isSearchDisabled(strategy: unknown): boolean {
  return typeof strategy === "string" && strategy.trim().toLowerCase() === "off";
}

/** 选路的输入。 */
export interface SearchRouteInput {
  /** 当前会话的 provider 路由 id；首帧可能还没有。 */
  provider: string | undefined;
  /** 当前会话的模型 id；首帧可能还没有。 */
  model: string | undefined;
  /** 用户选的优先策略（形状不可信）。 */
  strategy: SearchStrategy | string;
  /** 是否解析到了 API key。 */
  hasApiKey: boolean;
  /**
   * 网关路是否真的可用（有 opendesign 账号且能解析出密钥）。
   *
   * 与 `provider === "opendesign"` 分开：会话在 opendesign 上不等于**这个插件**配了账号，
   * 只看 provider 名会在「有 opendesign 会话但没配账号」时选中一条发不出去的路。
   */
  hasGateway: boolean;
}

/** 支持服务端搜索的网关（实测只有这家）。 */
const SEARCH_CAPABLE_GATEWAY = "opendesign";

/**
 * 一个模型 id 是否属于 DeepSeek 系。
 *
 * 用「段边界」匹配而不是裸 `includes`：`deepseekish` / `notdeepseek` 不该被当成
 * DeepSeek，而 `deepseek/...`、`deepseek-v4.1-flash`、`DeepSeek-V4-Pro` 都该算。
 *
 * 段边界是 `-` `_` `/` `.` 与串首尾。带分隔符的变体（`my-deepseek-fork`）**会**命中 ——
 * 这是刻意的：它名字里那一段确实叫 deepseek，无法仅凭字符串判断是不是官方服务。
 * 真正的排除靠调用方的 provider 判断，不靠模型名。
 * @param model - 模型 id（形状不可信）。
 * @returns 是否 DeepSeek 系。
 */
export function isDeepSeekModel(model: string | undefined): boolean {
  if (model === undefined) return false;
  const value = model.trim().toLowerCase();
  if (value === "") return false;
  return /(?:^|[/_-])deepseek(?:[/_.-]|$)/.test(value);
}

/**
 * 判定一次搜索该走哪条路。
 * @param input - 会话路由、策略与两条路各自是否可用。
 * @returns 选路结果。
 */
export function chooseSearchRoute(input: SearchRouteInput): SearchRoute {
  // 网关路：会话在支持的网关上、模型属于 DeepSeek 系、且插件确实配了那家的账号。
  const gatewayReady = input.hasGateway && input.provider === SEARCH_CAPABLE_GATEWAY && isDeepSeekModel(input.model);
  const apiReady = input.hasApiKey;
  // 不认识的策略按「网关优先」处理：那是最保守的一档（不额外花钱）。
  const strategy = SEARCH_STRATEGIES.includes(input.strategy as SearchStrategy)
    ? (input.strategy as SearchStrategy)
    : DEFAULT_SEARCH_STRATEGY;

  switch (strategy) {
    case "off":
      // 用户明确关掉了：两条路都不走，界面/宿主据此报「搜索未启用」。
      return { kind: "unavailable" };
    case "gateway-only":
      // 用户明确要求只用网关：不可用时**明确失败**，不偷偷改用 API 烧他的余额。
      return gatewayReady ? { kind: "gateway", provider: SEARCH_CAPABLE_GATEWAY } : { kind: "unavailable" };
    case "api-only":
      return apiReady ? { kind: "api" } : { kind: "unavailable" };
    case "api-first":
      if (apiReady) return { kind: "api" };
      return gatewayReady ? { kind: "gateway", provider: SEARCH_CAPABLE_GATEWAY } : { kind: "unavailable" };
    case "gateway-first":
    default:
      if (gatewayReady) return { kind: "gateway", provider: SEARCH_CAPABLE_GATEWAY };
      return apiReady ? { kind: "api" } : { kind: "unavailable" };
  }
}
