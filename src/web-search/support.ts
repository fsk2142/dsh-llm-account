/**
 * 「网页搜索」的**共享契约**：provider id、设置命名空间、厂商支持表。
 *
 * 这一份同时被服务端（provider 选路）与客户端（设置卡片显示支持状态）读取，所以这里
 * 只有纯数据、没有 Node 依赖 —— 客户端 bundle 会把它打进浏览器。
 * @module dsh-llm-account/src/web-search/support
 */

/** 写进宿主 `web.searchProvider` 的 provider id（宿主自带卡片只认识自己的两个 id）。 */
export const WEB_SEARCH_PROVIDER_ID = "llm-account-web";

/** 本模块的设置命名空间（服务端按它读写自己的配置）。 */
export const WEB_SEARCH_NAMESPACE = "llm-account-web-search";

/** 第三方搜索 Key 的默认凭据引用名（用户可在卡片里改）。 */
export const DEFAULT_SEARCH_KEY_REF = "LLM_ACCOUNT_SEARCH_KEY";

/**
 * 搜索来源模式。
 *
 * `account` = 跟随模型账号（由账号网关执行原生搜索）；`custom` = 第三方 API。
 * 「DeepSeek 官方」不在这里：它由宿主自己的 `deepseek-official` provider 承担，卡片只是把
 * `web.searchProvider` 写回去。
 */
export type WebSearchMode = "account" | "custom";

/** 一个厂商的账号网关对原生搜索的支持状态。 */
export interface NativeSearchVendor {
  /** 展示名（与厂商标签页一致）。 */
  readonly label: string;
  /** 网关是否接受服务端 `web_search` 工具声明。 */
  readonly supported: boolean;
  /** 不支持时**给人看的原因**：卡片直接显示，服务端报错文案也带上它。 */
  readonly reason?: string;
}

/**
 * 已知厂商的原生搜索支持表，按宿主路由 id 索引。
 *
 * 判定依据（2026-10-18 核对官方文档）：
 * - `commandcode`：Provider API 文档明说内置声明（如 `web_search`）会转发给上游「接受或拒绝」，
 *   所以**支持** —— 上游若拒绝，搜索报错，不降级成散文刮取；
 * - `dsh-opencode-go` / `opendesign`：网关是 OpenAI Chat Completions 协议，没有可声明的
 *   服务端搜索工具；这两家要联网只能走第三方 API（或不联）。
 */
export const NATIVE_SEARCH_VENDORS: Readonly<Record<string, NativeSearchVendor>> = {
  commandcode: { label: "Command Code", supported: true },
  "dsh-opencode-go": {
    label: "OpenCode",
    supported: false,
    reason: "OpenCode 的网关是 OpenAI Chat Completions 协议，没有可声明的服务端联网搜索工具。",
  },
  opendesign: {
    label: "Open Design",
    supported: false,
    reason: "Open Design（AMR）的网关是 OpenAI Chat Completions 协议，没有可声明的服务端联网搜索工具。",
  },
};

/**
 * 查一个路由 id 的支持状态。
 *
 * 未登记的厂商一律按「不支持」处理，并把路由 id 原样报给用户 —— 宁可不给选项，也不假装能用。
 * @param providerId - 宿主路由 id（`agent-default-model` 行里的 `provider`）。
 * @returns 支持状态。
 */
export function nativeSearchSupportOf(providerId: string): NativeSearchVendor {
  const known = NATIVE_SEARCH_VENDORS[providerId];
  if (known !== undefined) return known;
  return {
    label: providerId,
    supported: false,
    reason: `模型账号「${providerId}」不在本插件的厂商表里，无法用它的网关执行原生搜索。`,
  };
}
