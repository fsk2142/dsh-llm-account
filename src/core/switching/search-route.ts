/**
 * 统一搜索的**选路判定**（纯函数）。
 *
 * 用户要求：「统一都用 deepseek 的搜索，API 优先用我们登录的供应商账号额度，
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
  /** 用用户写入的 DeepSeek API key。 */
  | { kind: "api" }
  /** 两条路都不可用：**明确失败**，绝不发一个注定 400 或静默无为的请求。 */
  | { kind: "unavailable" };

/** 选路的输入。 */
export interface SearchRouteInput {
  /** 当前会话的 provider 路由 id；首帧可能还没有。 */
  provider: string | undefined;
  /** 当前会话的模型 id；首帧可能还没有。 */
  model: string | undefined;
  /** 用户是否允许「优先用网关额度」。 */
  preferGateway: boolean;
  /** 是否解析到了 API key。 */
  hasApiKey: boolean;
}

/** 支持服务端搜索的网关（实测只有这家）。 */
const SEARCH_CAPABLE_GATEWAY = "opendesign";

/**
 * 一个模型 id 是否属于 DeepSeek 系。
 *
 * 用「段边界」匹配而不是裸 `includes`：`my-deepseek-fork` 不该被当成 DeepSeek，
 * 而 `deepseek/...` 与 `DeepSeek-V4-Pro` 都该算。
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
 * @param input - 会话路由、开关与凭据可用性。
 * @returns 选路结果。
 */
export function chooseSearchRoute(input: SearchRouteInput): SearchRoute {
  const gatewayCapable =
    input.preferGateway && input.provider === SEARCH_CAPABLE_GATEWAY && isDeepSeekModel(input.model);
  if (gatewayCapable) return { kind: "gateway", provider: input.provider! };
  if (input.hasApiKey) return { kind: "api" };
  return { kind: "unavailable" };
}
