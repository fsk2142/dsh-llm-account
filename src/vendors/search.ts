/**
 * 搜索提供方的**装配**：把 `createSearchProvider` 接到宿主的 `ctx.web`。
 *
 * 为什么要 `ctx.inject(["web"])`：`web` 是宿主服务，只在挂载了 `dsh-web` 的部署里存在。
 * 直接 `ctx.web` 读会抛（cordis 的「没有 inject 就取服务」保护），所以必须注入。
 *
 * **关掉即静默**：`featureSearchEnabled` 关掉时不注册 provider —— 宿主会退回它自带的
 * `deepseek-official`（或报「没有可用提供方」），与本插件无关。
 * @module dsh-llm-account/src/vendors/search
 */

/** 宿主 context 里本模块用到的形状（不绑定具体 cordis 类型）。 */
export interface SearchHostContext {
  inject?: (deps: readonly string[], callback: (ctx: SearchHostContext) => void) => unknown;
  web?: {
    registerSearchProvider(provider: {
      id: string;
      available(): boolean;
      search(request: { query: string; maxResults?: number }, signal?: AbortSignal): Promise<unknown>;
    }): unknown;
  };
  get?: (name: string) => unknown;
}

/** 装配搜索所需的依赖（全部注入，便于测试与替换）。 */
export interface SearchAssemblyDeps {
  /** 是否启用（`featureSearchEnabled`）。 */
  enabled: () => boolean;
  /** 注册一个 provider；返回注销函数。 */
  register: (ctx: SearchHostContext) => () => void;
}

/**
 * 把搜索 provider 注册进宿主。
 *
 * 宿主没有 `web` 服务（没装 `dsh-web`）时**静默跳过**并留一条警告：那是部署选择，
 * 不是本插件的错误；也不能因此把整行弄崩。
 * @param ctx - 宿主 context。
 * @param deps - 启用判定与注册逻辑。
 */
export function applySearch(ctx: SearchHostContext, deps: SearchAssemblyDeps): void {
  if (!deps.enabled()) return;
  if (typeof ctx.inject !== "function") return;
  ctx.inject(["web"], (webCtx) => {
    if (webCtx.web === undefined) return;
    deps.register(webCtx);
  });
}
