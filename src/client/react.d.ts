/**
 * 宿主提供、本仓库**没有本地安装**的 React 的最小类型声明（Task 4 的 Ruling 22）。
 *
 * 为什么不是 `@types/react`：`react` 是**宿主在运行时通过加载器的 `require` 提供**的
 * （见 `tsdown.config.ts` 的 `CLIENT_EXTERNALS`），本包不需要、也不应该自带一份 React。
 * 而 `pnpm-lock.yaml` 属于受保护文件、本会话批准提示关闭，无法新增依赖 —— 所以这里只为
 * **实际用到的那几个 API** 写声明。
 *
 * 代价与边界（必须诚实）：这些声明是手写的，可能与真实 React 的类型有出入。因此：
 * - 只声明标准且稳定的 API，**不做**任何非标准扩展；
 * - 客户端页面把状态逻辑放在 `page-state.ts`（不碰 React、可完整单测），React 只做渲染；
 * - 真机渲染能力由计划 1c 验证，本层无法在本机证明。
 *
 * 本文件是**全局脚本**（没有顶层 import/export），这样 `declare module "react"` 才是对
 * 一个不存在模块的声明，而不是模块增补。
 */
declare module "react" {
  /** 元素类型：`createElement` 的返回形状（测试里按它遍历树）。 */
  export interface ReactElement {
    readonly type: unknown;
    readonly props: Record<string, unknown>;
    readonly key: string | null;
  }

  /** 可渲染的子节点。 */
  export type ReactNode = ReactElement | string | number | boolean | null | undefined | readonly ReactNode[];

  /** 函数组件。 */
  export type ComponentType<Properties = Record<string, unknown>> = (
    properties: Properties,
  ) => ReactElement | null;

  /** 创建元素。子节点按位置传入（第三个参数起）。 */
  export function createElement(
    type: unknown,
    properties?: object | null,
    ...children: readonly ReactNode[]
  ): ReactElement;

  /** 不产生额外 DOM 节点的组合片段。 */
  export const Fragment: ComponentType<{ children?: ReactNode }>;

  /** 组件状态。 */
  export function useState<State>(
    initial: State | (() => State),
  ): [State, (next: State | ((previous: State) => State)) => void];

  /** 副作用；返回的清理函数在依赖变化或卸载时调用。 */
  export function useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void;
}
