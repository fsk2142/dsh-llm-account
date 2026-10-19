/**
 * 随机操作序列仿真：对**真实容器**跑随机点按/输入序列，每一拍后校验不变量。
 *
 * 与 `container-simulation.test.ts` 的分工：那边是**手写脚本**（一次只改一个东西，断言精确）；
 * 这里是**随机序列** —— 每个用例由固定种子的伪随机数生成几十次用户操作（切标签页、编辑字段、
 * 拨开关、保存、添加/取消账户、开关卡片、打开/关闭面板、卸载页面、宿主外部改设置、让写入失败），
 * 跑完一遍后检查一批**任何序列都必须成立**的不变量。
 *
 * 为什么值得做：接缝层的 bug 大多是「某个顺序下才发作」（重渲染丢草稿、卸载后还在写、关掉开关
 * 后残留定时器、保存失败后基线错位）。手写脚本覆盖不了组合爆炸。
 *
 * 用**固定种子**而不是 `Math.random`：失败必须可复现 —— 种子与拍数都写进失败消息。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  elementsOfSim,
  findSim,
  fireSim,
  installMiniReact,
  settleSim,
  textsOfSim,
  type MiniReact,
  type Mounted,
} from "../support/container-sim";
import { fakeHost, type FakeHost } from "../support/fake-host";

vi.mock("react", async () => {
  const stub = await import("../support/react-stub");
  const mini = installMiniReact();
  return {
    createElement: stub.createElement,
    Fragment: stub.Fragment,
    useState: mini.useState,
    useEffect: mini.useEffect,
    useRef: mini.useRef,
    Component: stub.Component,
    __mini: mini,
  };
});

/** 取迷你运行时。 */
async function runtime(): Promise<MiniReact> {
  return (await import("react") as unknown as { __mini: MiniReact }).__mini;
}

afterEach(async () => {
  (await runtime()).reset();
  vi.useRealTimers();
});

/** mulberry32：32 位种子的小型 PRNG，同一 seed 必产生同一序列。 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TABS = ["llm-commandcode", "llm-opencode-go", "llm-opendesign"] as const;

/**
 * 按标签页顺序（宿主设置里的行顺序）取第一家**已存储**开关为真的厂商。
 *
 * 只看已存储值：草稿把开关拨开不算 —— 卡片门控读的就是这一份（`page-state.ts` 的
 * `sidebarQuotaEnabled`）。行 id 与厂商 id 的对应写在这里，因为随机仿真不关心注册表。
 * 三家都要查：外部改动（patch 文件/别的工具）翻的是**任意一行**的开关，包括 opendesign。
 */
function firstEnabledVendor(host: FakeHost): string | undefined {
  if (host.rows.get("llm-commandcode")?.value["showSidebarQuota"] === true) return "commandcode";
  if (host.rows.get("opencode-go")?.value["showSidebarQuota"] === true) return "dsh-opencode-go";
  if (host.rows.get("opendesign")?.value["showSidebarQuota"] === true) return "opendesign";
  return undefined;
}

/** 一轮仿真里可以被随机挑中的动作。 */
type Beat = () => void;

describe("随机操作序列仿真", () => {
  it("24 个种子 × 每次 24 拍：不变量始终成立", async () => {
    // 假定时器：推进 60s/600s 是「时间过去」的手段，不用真的等。promise 不受影响。
    vi.useFakeTimers();
    const { resetSeams } = await import("../../src/client/seams");
    const { resetShell, VENDORS, PAGE_LOCALE_NS } = await import("../../src/client/shell");
    const { registerSharedSurfaces, startSharedState, createConnectedPage } = await import("../../src/client/seams");
    const { dictionaryOf } = await import("../../src/client/copy");
    const { AccountCard } = await import("../../src/client/account-card");
    const { createElement } = await import("react");

    const mini = await runtime();
    for (let run = 0; run < 24; run += 1) {
      const seed = 1000 + run;
      resetSeams();
      resetShell();
      const random = rng(seed);
      const pick = <T,>(items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
      const host: FakeHost = fakeHost(mini);
      const t = dictionaryOf("zh");

      // 真实的 apply 期引导 + 真实容器（与 index.ts 的 apply 同序同物）。
      startSharedState(host.ctx as never, VENDORS);
      registerSharedSurfaces({ ctx: host.ctx as never, entries: VENDORS, t, localeNs: PAGE_LOCALE_NS });
      const cardComponent = host.registered.find((entry) => entry.slot === "sidebar.footer.action")!.component;
      const panelComponent = host.registered.find((entry) => entry.slot === "main")!.component;
      const pageComponent = createConnectedPage({
        entries: VENDORS,
        ctx: host.ctx as never,
        t,
        renderVendorCards: (cards) => {
          const context = cards as {
            t: (key: string) => string;
            action?: { kind: string };
            openAction: (action: unknown) => void;
            setActionField: (field: string, value: string) => void;
            confirmAction: () => void;
            cancelAction: () => void;
            select: (ref: string) => void;
            remove: (ref: string) => void;
            toggleExpand: (ref: string) => void;
            loginBegin: () => void;
          };
          return createElement(AccountCard as never, {
            status: undefined,
            t: context.t,
            action: context.action,
            onOpenAction: context.openAction,
            onActionField: context.setActionField,
            onConfirmAction: context.confirmAction,
            onCancelAction: context.cancelAction,
            onSelect: context.select,
            onRemove: context.remove,
            onToggleExpand: context.toggleExpand,
            onLoginBegin: context.loginBegin,
          } as never);
        },
      });

      const card = mini.mount(cardComponent);
      const page = mini.mount(pageComponent);
      let panel: Mounted = mini.mount(panelComponent);
      await settleSim(mini);

      /** 便捷动作：元素不存在就当这一拍没发生（随机序列允许打空）。 */
      const tryFire = (tree: unknown, marker: string, handler: string, value?: string, event: unknown = {}): void => {
        const element = findSim(tree, marker, value);
        if (element === undefined || typeof element.props[handler] !== "function") return;
        fireSim(element, handler, event);
      };

      const beats: Beat[] = [
        () => tryFire(page.tree(), "data-tab", "onClick", pick(TABS)),
        () => tryFire(page.tree(), "data-field-input", "onChange", pick(["apiBase", "baseURL", "workspaceId"]), { target: { value: `https://edited-${seed}.example` } }),
        () => tryFire(page.tree(), "data-field-input", "onChange", "showSidebarQuota", { target: { checked: random() < 0.5 } }),
        () => tryFire(page.tree(), "data-save", "onClick", pick(TABS)),
        () => tryFire(page.tree(), "data-action", "onClick", "add"),
        () => tryFire(page.tree(), "data-add-label", "onChange", undefined, { target: { value: ` acct-${seed} ` } }),
        () => tryFire(page.tree(), "data-add-key", "onChange", undefined, { target: { value: ` sk-${seed}\n` } }),
        () => tryFire(page.tree(), "data-action", "onClick", "confirmAdd"),
        () => tryFire(page.tree(), "data-action", "onClick", "cancel"),
        () => tryFire(card.tree(), "data-sidebar-open", "onClick"),
        () => tryFire(panel.tree(), "data-dashboard-refresh", "onClick"),
        () => tryFire(panel.tree(), "data-dashboard-close", "onClick"),
        () => {
          // 面板重挂载（模拟用户关掉中栏又打开）。
          const next = mini.mount(panelComponent);
          panel.unmount();
          panel = next;
        },
        () => {
          // 宿主外部改设置（patch 文件 / 别的工具）。
          const row = pick([...host.rows.keys()]);
          const state = host.rows.get(row)!;
          state.value = { ...state.value, showSidebarQuota: random() < 0.5 };
          state.revision += 1;
          host.emitDocumentUpdated();
        },
        () => {
          // 让接下来一两次写入失败（凭据服务拒绝、并发写者抢先……）。
          host.failOnce = random() < 0.25 ? "simulated write failure" : undefined;
        },
        () => {
          // 设置页卸载又挂回来（用户关掉设置页再打开）。
          page.unmount();
        },
      ];

      for (let beat = 0; beat < 24; beat += 1) {
        const where = `seed ${seed} beat ${beat}`;
        pick(beats)();
        await settleSim(mini);
        vi.advanceTimersByTime(60_000);
        await settleSim(mini);

        // ① 关闭开关时侧边栏卡片渲染 null。
        const anyToggleOn = [...host.rows.values()].some((row) => row.value["showSidebarQuota"] === true);
        if (!anyToggleOn && card.tree() !== null) throw new Error(`${where}: the sidebar card renders while every toggle is off`);

        // ② 关闭即静默（规格 §8.1 第 6 条）：**状态稳定之后**推进十分钟，不得有任何新的定时器或
        //    新的状态读。
        //    关键在「稳定之后」：这一拍可能刚把开关从开改成关，卡片的 cleanup 还没跑到，直接
        //    拿拍前/拍后比较会把**开启期间**的合法轮询算进来（第一版就误报过）。
        //    也不能断言 `getTimerCount() === 0`：设置页的登录轮询 interval 与侧边栏开关无关。
        await settleSim(mini);
        const stableToggles = [...host.rows.values()].some((row) => row.value["showSidebarQuota"] === true);
        if (!stableToggles) {
          const timersBefore = vi.getTimerCount();
          const readsBefore = host.statusCalls.length;
          vi.advanceTimersByTime(600_000);
          await settleSim(mini);
          const added = vi.getTimerCount() - timersBefore;
          if (added > 0) throw new Error(`${where}: ${added} timers appeared while every toggle is off`);
          const newReads = host.statusCalls.length - readsBefore;
          if (newReads > 0) throw new Error(`${where}: ${newReads} status reads happened while every toggle was off`);
        }

        // ③ 保存错误只在有保存条时出现（不会出现「只有错误没有保存条」的悬空提示）。
        const hasBar = findSim(page.tree(), "data-save-bar") !== undefined;
        const errored = elementsOfSim(page.tree()).some((element) => typeof element.props["data-save-error"] === "string");
        if (errored && !hasBar) throw new Error(`${where}: a save error is rendered without a save bar`);

        // ④ 三棵树里都不出现未翻译的键名 / undefined / NaN / 对象字符串。
        const visible = [...textsOfSim(page.tree()), ...textsOfSim(card.tree()), ...textsOfSim(panel.tree())];
        for (const token of ["undefined", "NaN", "[object Object]", "switch.reason.", "account.reason."]) {
          if (visible.some((item) => item.includes(token))) throw new Error(`${where}: the UI shows "${token}"`);
        }

        // ⑤ 已落盘的字段值一定是宿主文档里的值（没有「界面显示 A、文档是 B」的漂移）。
        for (const mutation of host.mutations) {
          for (const op of mutation.ops) {
            const field = op.path[0];
            if (field === undefined || op.op !== "set") continue;
            const stored = host.rows.get(mutation.row)?.value[field];
            if (!Object.is(stored, op.value)) throw new Error(`${where}: ${mutation.row}.${field} drifted from the document`);
          }
        }

        // ⑥ 设置镜像必须已启动（否则外部改设置卡片永远不跟随）。
        if (!host.listeners.has("settings/document-updated")) {
          throw new Error(`${where}: the settings mirror never subscribed to settings/document-updated`);
        }

        // ⑦ 保存条上的错误必须带非空的可读原因（不能是空串糊在界面上）。
        for (const element of elementsOfSim(page.tree())) {
          if (typeof element.props["data-save-error"] === "string") {
            const reason = element.props["data-save-error-reason"];
            if (typeof reason !== "string" || reason.trim() === "") {
              throw new Error(`${where}: a save error is rendered without a readable reason`);
            }
          }
        }

        // ⑧ 添加表单的接线必须自洽：两个输入框同时在或同时不在，且只在表单打开时存在。
        //    曾经输入框一直摊在卡片底部（所以看起来「怎么点都没反应」），而它们的 onChange
        //    走的是恒等变换，永远打不开任何东西。
        const labelField = findSim(page.tree(), "data-add-label");
        const keyField = findSim(page.tree(), "data-add-key");
        const formOpen = findSim(page.tree(), "data-action", "cancel") !== undefined;
        if ((labelField === undefined) !== (keyField === undefined)) {
          throw new Error(`${where}: the add form renders only one of its two inputs`);
        }
        if ((labelField !== undefined) !== formOpen) {
          throw new Error(`${where}: add inputs ${labelField !== undefined ? "render" : "do not render"} while the form is ${formOpen ? "open" : "closed"}`);
        }

        // ⑨ 开关存储与宿主文档一致：卡片渲染与否只由**已存储**的开关决定。
        //    （草稿把开关拨开不算 —— 见 page-state.ts 的说明。）
        const enabled = firstEnabledVendor(host);
        if (enabled === undefined && card.tree() !== null) {
          throw new Error(`${where}: the sidebar card renders although no stored toggle is on`);
        }
      }

      // ⑥ 设置页卸载后远程面仍然活着（卡片还挂在那里）：新消费者拿到的必须是**同一个**句柄、
      //    `$mount` 没有被重做，而卡片还能用它读到状态 —— 钉住的是「设置页的生命周期不牵连
      //    插件级共享面」。
      const { ensureUsageRemote } = await import("../../src/client/seams");
      const mountsBefore = host.mounts.length;
      page.unmount();
      await settleSim(mini);
      const handle = ensureUsageRemote(host.ctx as never);
      await settleSim(mini);
      if (handle.disposed()) throw new Error(`seed ${seed}: the shared usage remote was disposed with the settings page`);
      if (host.mounts.length !== mountsBefore) {
        throw new Error(`seed ${seed}: the shared usage remote was re-mounted (${mountsBefore} → ${host.mounts.length})`);
      }
      if (firstEnabledVendor(host) !== undefined) {
        const before = host.statusCalls.length;
        vi.advanceTimersByTime(60_000);
        await settleSim(mini);
        if (host.statusCalls.length === before) throw new Error(`seed ${seed}: the sidebar card stopped polling after the page unmounted`);
      }

      // ⑦ 收尾：把三个容器都卸载。**必须卸载** —— 卡片与面板各自持着 interval（卡片 60s 轮询），
      //    不卸载就会跨轮存活：下一轮推进时间时上一轮的定时器还在请求，看起来像「开关关了仍然
      //    有请求」（第一版就误报过这个）。
      card.unmount();
      panel.unmount();
      await settleSim(mini);
    }
    expect(true).toBe(true);
  }, 120_000);
});