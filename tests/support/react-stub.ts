/**
 * 测试专用的 React 替身（Task 4 的 Ruling 22）。
 *
 * 只在 vitest 里生效（`vitest.config.ts` 把 `react` 别名到这里）；生产产物仍然
 * `require("react")` 拿宿主的那一份 —— 别名不会进 bundle。
 *
 * 设计上的两条自我约束：
 * 1. **只实现 `createElement` 与 `Fragment`**：被测组件都是「纯 props → 元素树」的函数，
 *    测试直接调用组件并遍历返回的元素树。
 * 2. **两个 Hook 一律抛错**：任何需要状态机的组件一旦被测试直接调用就立刻失败，而不是靠
 *    一个假的 Hook 实现「假装通过」。状态机住在 `page-state.ts`（纯函数、完整单测），
 *    React 只负责渲染 —— 这条纪律由这个替身机械地保证。
 */

/** 元素形状：与真实 React 元素在测试里需要的那几个字段一致。 */
export interface StubElement {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly key: string | null;
}

/**
 * 造一个元素。子节点收进 `props.children`（与 React 的约定一致）。
 * @param type - 组件或宿主标签。
 * @param properties - 属性。
 * @param children - 子节点。
 * @returns 元素描述。
 */
export function createElement(
  type: unknown,
  properties?: object | null,
  ...children: readonly unknown[]
): StubElement {
  const props: Record<string, unknown> = { ...((properties ?? {}) as Record<string, unknown>) };
  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;
  return { type, props, key: typeof props.key === "string" ? props.key : null };
}

/** 组合片段：与真实 React 一样「不产生节点」，替身里就是一个标记。 */
export const Fragment = Symbol.for("dsh-llm-account.test-react-fragment");

/** 契约违规：被测组件不该直接使用状态。 */
function hooksAreNotAvailable(name: string): never {
  throw new Error(
    `${name}() is not available in the React stand-in used by the tests: components under test must be pure functions of their props, with the state machine kept in page-state.ts`,
  );
}

/** 见 {@link hooksAreNotAvailable}。 */
export function useState(): never {
  return hooksAreNotAvailable("useState");
}

/** 见 {@link hooksAreNotAvailable}。 */
export function useEffect(): never {
  return hooksAreNotAvailable("useEffect");
}

/** 见 {@link hooksAreNotAvailable}。 */
export function useRef(): never {
  return hooksAreNotAvailable("useRef");
}

/**
 * 错误边界用的类组件基类。
 *
 * 这是替身里唯一的「有状态」形状，且**不参与 Hook 纪律**：它不是被测组件，而是
 * `Component` 的真实语义（React 里错误边界只能是类组件）。测试不会实例化它，
 * 只要求 `Component` 这个名字可以被 import —— 生产产物里它来自宿主提供的真 React。
 */
export class Component<P = Record<string, unknown>, S = Record<string, unknown>> {
  props: P;
  state: S;

  constructor(props: P) {
    this.props = props;
    this.state = {} as S;
  }
}

/** 错误边界的静态方法在真实 React 里是约定；替身只提供类型占位。 */
export function getDerivedStateFromError(): never {
  return hooksAreNotAvailable("getDerivedStateFromError");
}
