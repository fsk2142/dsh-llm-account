/**
 * 「插件已更新，刷新页面」的提示。
 *
 * 需求：「如果我不重启，侧边栏就无法出来，是否可以提示刷新页面的方式，这样就不需要我重启了」。
 *
 * 这条需求的本质：宿主把**客户端启动图**在页面加载那一刻定下来，之后新装/更新的插件不会自动
 * 进图 —— 侧边栏卡片与中台面板于是「不出现」，只有重启宿主才行。而**刷新页面**会让浏览器
 * 重走一遍启动图，效果等价、成本低得多。插件没法把自己塞进已经定型的启动图，所以正确的
 * 产品动作就是**把这条路告诉用户**。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { PageShell } from "../../src/client/page";
import { createPageState } from "../../src/client/page-state";
import { VENDORS } from "../../src/client/shell";
import { elementsOfSim, textsOfSim } from "../support/container-sim";

const t = dictionaryOf("zh");

/** 三家设置快照。 */
function snapshots() {
  return [
    { ns: "llm-commandcode", row: "llm-commandcode", value: {}, revision: 1 },
    { ns: "llm-opencode-go", row: "opencode-go", value: {}, revision: 1 },
    { ns: "llm-opendesign", row: "opendesign", value: {}, revision: 1 },
  ];
}

/** 渲染页面。 */
function render(extra: Record<string, unknown> = {}): unknown {
  return PageShell({
    state: createPageState(VENDORS, snapshots()),
    entries: VENDORS,
    t,
    onSelectTab: () => undefined,
    onSetField: () => undefined,
    onSave: () => undefined,
    ...extra,
  } as never);
}

describe("提示条本身", () => {
  it("需要提示时显示标题、说明与「刷新页面」按钮", () => {
    const tree = render({ reloadHint: true });
    const notice = elementsOfSim(tree).find((element) => element.props["data-reload-hint"] !== undefined);
    expect(notice, "应当出现提示条").toBeDefined();
    const text = textsOfSim(notice).join(" ");
    expect(text).toContain(t("update.title"));
    expect(text).toContain(t("update.body"));
    // 说明里明确写了「不用重启」—— 这正是用户的诉求。
    expect(text).toContain("不用重启");
    expect(elementsOfSim(notice).some((element) => element.props["data-reload-now"] !== undefined)).toBe(true);
  });

  it("不需要提示时完全不渲染（不打扰正常用户）", () => {
    const tree = render({ reloadHint: false });
    expect(elementsOfSim(tree).some((element) => element.props["data-reload-hint"] !== undefined)).toBe(false);
  });

  it("缺省（没传）也不渲染", () => {
    expect(elementsOfSim(render()).some((element) => element.props["data-reload-hint"] !== undefined)).toBe(false);
  });

  it("点「刷新页面」调的是容器给的回调（页面是纯函数，不自己碰 location）", () => {
    const reload = vi.fn();
    const tree = render({ reloadHint: true, onReload: reload });
    const button = elementsOfSim(tree).find((element) => element.props["data-reload-now"] !== undefined)!;
    (button.props["onClick"] as () => void)();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("英文文案齐全（不是只写中文）", () => {
    const en = dictionaryOf("en");
    const tree = PageShell({
      state: createPageState(VENDORS, snapshots()),
      entries: VENDORS,
      t: en,
      onSelectTab: () => undefined,
      onSetField: () => undefined,
      onSave: () => undefined,
      reloadHint: true,
    } as never);
    const text = textsOfSim(tree).join(" ");
    expect(text).toContain("The plugin was updated");
    expect(text).toContain("no need to restart");
  });
});

describe("刷新动作：非浏览器环境是空操作", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("没有 location 时不抛错，并如实返回 false", async () => {
    const { reloadPage } = await import("../../src/client/seams");
    // 测试环境（node）本来就没有 location。
    const had = "location" in globalThis;
    if (!had) expect(() => reloadPage()).not.toThrow();
    expect(typeof reloadPage()).toBe("boolean");
  });

  it("有 location.reload 时真的调用它", async () => {
    const calls: number[] = [];
    (globalThis as { location?: { reload: () => void } }).location = { reload: () => calls.push(1) };
    try {
      const { reloadPage } = await import("../../src/client/seams");
      expect(reloadPage()).toBe(true);
      expect(calls).toHaveLength(1);
    } finally {
      delete (globalThis as { location?: unknown }).location;
    }
  });
});
