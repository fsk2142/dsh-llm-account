/**
 * 容器仿真的夹具：一个**迷你 React 运行时** + 一个**有状态的假宿主**。
 *
 * 为什么需要它：Ruling 22 的自觉取舍让容器（唯一的 Hook 宿主）不参与单测 —— 测试用的 React
 * 替身会把 Hook 调用判为失败。代价是容器**接线**没有进程内覆盖，而 1c 的真机验收还没做。
 * 本模块提供进程内替代：真的把容器挂载起来跑流程，被测的仍然是生产代码。
 *
 * 语义刻意从简：组件只挂载一次、props 不变，所以不需要协调与 key diff；effect 的依赖比较、
 * 清理顺序、setState 重渲染循环按 React 的规则来。多个容器可以同时挂载（设置页 + 侧边栏卡片
 * + 中栏仪表盘），各自一个实例。**不用定时器**：容器里的异步全是 promise。
 *
 * 由两个测试文件共用：`container-simulation.test.ts`（手写脚本，逐条精确断言）与
 * `randomized-simulation.test.ts`（随机序列 + 不变量）。两个文件各自 `vi.mock("react", …)`
 * 调 {@link installMiniReact} —— mock 工厂必须是每个文件自己的，运行时本身可以共享。
 */

/** 一个 Hook 槽位：状态或副作用（两类共用一个顺序空间，与 React 的 Hook 顺序契约一致）。 */
export type SimHook =
  | { kind: "state"; value: unknown }
  | { kind: "ref"; value: { current: unknown } }
  | { kind: "effect"; fn: () => void | (() => void); deps?: readonly unknown[]; cleanup?: (() => void) | undefined; pending: boolean };

export interface SimInstance {
  component: () => unknown;
  hooks: (SimHook | undefined)[];
  cursor: number;
  tree: unknown;
  dirty: boolean;
  unmounted: boolean;
}

/** 迷你运行时的句柄（测试侧用它驱动挂载与排空）。 */
export interface MiniReact {
  live: SimInstance[];
  /** 把一次异步宿主调用登记为 in-flight（`settle` 的排空判据）。 */
  track<T>(value: T): Promise<T>;
  /** 渲染一轮并跑完待执行的 effect；有脏标记就循环到稳定。 */
  settleInstance(instance: SimInstance): void;
  /** 还没落定的异步宿主调用数。 */
  pending(): number;
  /** 卸载全部实例并复位（测试隔离）。 */
  reset(): void;
  /** 挂一个容器组件（生产代码原样参与），返回可读树与卸载句柄。 */
  mount(component: () => unknown): Mounted;
  /** React 形状的 `useState`（导出给 `vi.mock` 工厂用）。 */
  useState: <S,>(initial: S | (() => S)) => [S, (next: S | ((previous: S) => S)) => void];
  /** React 形状的 `useEffect`。 */
  useEffect: (fn: () => void | (() => void), deps?: readonly unknown[]) => void;
  /** React 形状的 `useRef`（跨渲染稳定的可变容器）。 */
  useRef: <V>(initial: V) => { current: V };
}

/**
 * 造一个迷你 React 运行时。
 *
 * 调用方（`vi.mock("react", …)` 的工厂）把测试用元素替身的 `createElement`/`Fragment` 与本函数
 * 返回的 `useState`/`useEffect` 一起交给被测容器。
 * @returns 运行时句柄（含 React 形状的两个 Hook）。
 */
export function installMiniReact(): MiniReact {
  const live: SimInstance[] = [];
  let rendering: SimInstance | undefined;
  let inflight = 0;

  const track = <T,>(value: T): Promise<T> => {
    inflight += 1;
    return Promise.resolve(value).then((settled) => {
      inflight -= 1;
      return settled;
    });
  };

  const sameDeps = (left?: readonly unknown[], right?: readonly unknown[]): boolean => {
    if (left === undefined || right === undefined) return false; // 无依赖 = 每次渲染都跑
    if (left.length !== right.length) return false;
    return left.every((value, index) => Object.is(value, right[index]));
  };

  const useState = <S,>(initial: S | (() => S)): [S, (next: S | ((previous: S) => S)) => void] => {
    const instance = rendering;
    if (instance === undefined) throw new Error("mini-react: useState outside of render");
    const index = instance.cursor;
    instance.cursor += 1;
    let hook = instance.hooks[index];
    if (hook === undefined || hook.kind !== "state") {
      hook = { kind: "state", value: typeof initial === "function" ? (initial as () => S)() : initial };
      instance.hooks[index] = hook;
    }
    const slot = hook;
    const setter = (next: S | ((previous: S) => S)): void => {
      const resolved = typeof next === "function" ? (next as (previous: S) => S)(slot.value as S) : next;
      if (Object.is(resolved, slot.value)) return;
      slot.value = resolved;
      instance.dirty = true;
    };
    return [slot.value as S, setter];
  };

  const useEffect = (fn: () => void | (() => void), deps?: readonly unknown[]): void => {
    const instance = rendering;
    if (instance === undefined) throw new Error("mini-react: useEffect outside of render");
    const index = instance.cursor;
    instance.cursor += 1;
    const existing = instance.hooks[index];
    if (existing === undefined || existing.kind !== "effect") {
      instance.hooks[index] = { kind: "effect", fn, deps, cleanup: undefined, pending: true };
      return;
    }
    existing.fn = fn;
    if (!sameDeps(existing.deps, deps)) {
      existing.deps = deps;
      existing.pending = true;
    }
  };

  const useRef = <V,>(initial: V): { current: V } => {
    const instance = rendering;
    if (instance === undefined) throw new Error("mini-react: useRef outside of render");
    const index = instance.cursor;
    instance.cursor += 1;
    let hook = instance.hooks[index];
    // 与真实 React 一致：ref 对象只在首次渲染创建，之后跨渲染返回同一个对象。
    if (hook === undefined || hook.kind !== "ref") {
      hook = { kind: "ref", value: { current: initial } };
      instance.hooks[index] = hook;
    }
    return hook.value as { current: V };
  };

  /**
   * 渲染一轮，并校验 **Hook 数量与上一次渲染一致**。
   *
   * 这是 React #310（"Rendered more/fewer hooks than during the previous render"）的
   * 等价检查。真机上它的表现是整棵子树被丢弃、页面一片空白；本夹具此前不比对数量，
   * 于是「Hook 写在提前 return 之后」这类缺陷在测试里完全看不出来
   * （2026-10-19 真实报障：设置条目在、点进去什么都没有）。
   */
  const renderOnce = (instance: SimInstance): void => {
    const previous = instance.hooks.length;
    instance.cursor = 0;
    rendering = instance;
    try {
      instance.tree = instance.component();
    } finally {
      rendering = undefined;
    }
    // 首次渲染没有「上一次」，不比对。之后每次都必须与上一次相同。
    if (previous > 0 && instance.hooks.length !== previous) {
      throw new Error(
        `mini-react: rendered ${instance.hooks.length} hooks but the previous render used ${previous} — ` +
          "a hook is being called after an early return (React error #310)",
      );
    }
  };

  const flushEffects = (instance: SimInstance): void => {
    for (const hook of instance.hooks) {
      if (hook === undefined || hook.kind !== "effect" || !hook.pending) continue;
      hook.pending = false;
      hook.cleanup?.();
      const cleanup = hook.fn();
      hook.cleanup = typeof cleanup === "function" ? (cleanup as () => void) : undefined;
    }
  };

  const settleInstance = (instance: SimInstance): void => {
    for (let guard = 0; guard < 50 && instance.dirty && !instance.unmounted; guard += 1) {
      instance.dirty = false;
      renderOnce(instance);
      flushEffects(instance);
    }
    if (instance.dirty) throw new Error("mini-react: the component did not settle after 50 renders");
  };

  const unmountInstance = (instance: SimInstance): void => {
    if (instance.unmounted) return;
    instance.unmounted = true;
    for (const hook of instance.hooks) if (hook !== undefined && hook.kind === "effect") hook.cleanup?.();
    const index = live.indexOf(instance);
    if (index >= 0) live.splice(index, 1);
  };

  return {
    live,
    track,
    settleInstance,
    pending: () => inflight,
    reset: () => {
      for (const instance of [...live]) unmountInstance(instance);
      live.length = 0;
      inflight = 0;
    },
    mount: (component: () => unknown): Mounted => {
      const instance: SimInstance = { component, hooks: [], cursor: 0, tree: undefined, dirty: false, unmounted: false };
      live.push(instance);
      renderOnce(instance);
      flushEffects(instance);
      settleInstance(instance);
      return {
        tree: () => instance.tree,
        unmount: () => unmountInstance(instance),
      };
    },
    useState,
    useEffect,
    useRef,
  };
}

/** 已挂载的容器。 */
export interface Mounted {
  tree(): unknown;
  unmount(): void;
}

/**
 * 排空微任务，并把期间发生的 setState 渲染出来。
 *
 * 排空判据是**连续三轮安静**（无 in-flight 宿主调用、无脏实例），而不是「这一轮有没有
 * 渲染」：容器的异步全是 promise 链（`describe → mutate → 再 describe`），链上的 `setState`
 * 要好几拍才落地，而 in-flight 计数会在 `await` 的续体之前先归零 —— 只看单轮会在链子走完
 * 之前就返回。
 *
 * 用固定轮数的微任务排空而不是 `setTimeout(0)`：有测试开着假定时器。
 * @param mini - 运行时句柄。
 */
export async function settleSim(mini: MiniReact): Promise<void> {
  let quiet = 0;
  for (let round = 0; round < 80; round += 1) {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    for (const instance of [...mini.live]) mini.settleInstance(instance);
    const settled = mini.pending() === 0 && mini.live.every((instance) => !instance.dirty);
    quiet = settled ? quiet + 1 : 0;
    if (quiet >= 3) return;
  }
  throw new Error(`mini-react: the tree never settled (inflight=${mini.pending()})`);
}

/** 元素形状（与 `tests/support/react-stub.ts` 的 `StubElement` 同一套字段）。 */
export interface SimElement {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly key: string | null;
}

/**
 * 展开一个节点：函数组件就地调用（被测卡片都是纯函数，Ruling 22），元素按 children 摊平。
 *
 * 类组件（错误边界）也在这里被实例化：先 `new`、再 `render()`。真 React 的语义是
 * 「子组件抛错 → `getDerivedStateFromError` → 渲染错误面板」，仿真按同一顺序做一遍，
 * 这样「页面渲染期抛错」在测试里是真的可观测的（此前只测到容器同步求值那一层）。
 */
export function expandSim(node: unknown, depth = 0): unknown[] {
  if (node === null || node === undefined || typeof node !== "object") return [node];
  if (depth > 20) throw new Error("mini-react: the element tree is deeper than 20 levels");
  if (Array.isArray(node)) return node.flatMap((child) => expandSim(child, depth + 1));
  const element = node as SimElement;
  if (!("props" in element) || !("type" in element)) return [];
  if (typeof element.type === "function") {
    const type = element.type as unknown as {
      prototype?: { render?: unknown };
      getDerivedStateFromError?: (error: unknown) => Record<string, unknown>;
      /** 迷你运行时在挂载根组件时打上的标记（见 `mount`）：已渲染过的根不再重复求值。 */
      __simRendered?: boolean;
    };
    // 类组件：React 里只能用类写错误边界。实例化 → render；抛错则走派生状态 → 再 render。
    if (type.prototype?.render !== undefined && type.getDerivedStateFromError !== undefined) {
      const instance = new (element.type as new (props: Record<string, unknown>) => {
        state: Record<string, unknown>;
        render(): unknown;
      })(element.props);
      try {
        return expandSim(instance.render(), depth + 1);
      } catch (error) {
        instance.state = { ...instance.state, ...type.getDerivedStateFromError(error) };
        return expandSim(instance.render(), depth + 1);
      }
    }
    // 纯函数组件：以 props 直接调用（真实 React 也在这里创建子树）。
    return expandSim((element.type as (props: Record<string, unknown>) => unknown)(element.props), depth + 1);
  }
  return [element, ...expandSim(element.props.children, depth + 1)];
}

/** 展平元素树（额外展开函数组件）。 */
export function elementsOfSim(node: unknown): SimElement[] {
  return expandSim(node).filter(
    (value): value is SimElement => typeof value === "object" && value !== null && "props" in value && "type" in value,
  );
}

/** 树里所有可见文本（含数字）。 */
export function textsOfSim(node: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (value !== null && typeof value === "object" && "props" in (value as SimElement)) walk((value as SimElement).props.children);
  };
  for (const element of elementsOfSim(node)) walk(element.props.children);
  return out;
}

/** 按 data 属性找元素（给 `value` 时要求属性值相等）。 */
export function findSim(tree: unknown, marker: string, value?: string): SimElement | undefined {
  return elementsOfSim(tree).find((element) => (value === undefined ? marker in element.props : element.props[marker] === value));
}

/** 触发一个元素的回调（模拟用户操作）；元素或回调不存在就抛（不做静默跳过）。 */
export function fireSim(element: SimElement | undefined, name: string, event: unknown = {}): void {
  if (element === undefined) throw new Error(`no element carries ${name}`);
  const handler = element.props[name];
  if (typeof handler !== "function") throw new Error(`the element has no ${name} handler`);
  (handler as (value: unknown) => void)(event);
}