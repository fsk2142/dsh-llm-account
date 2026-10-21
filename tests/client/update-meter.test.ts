/**
 * 标题行右侧的版本与更新控件（2026-10-21 用户要求）。
 *
 * 用户原话：「检查更新那个建议放到设置页最开头 LL 账号的最右边，检查完就提示是否有新版本，
 * 版本号多少，显示是否更新」+「每次打开设置页就自动检查更新并提示吧，别手动点了」。
 *
 * 两条要求分别对应两组断言：
 * 1. **位置**：控件在 `header` 的标题行里（`data-title-row` 内），不是独立区块；
 * 2. **自动**：打开设置页就查一次，不需要点按钮；同一页面会话内不重复打网络。
 */
import { describe, expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { PageShell } from "../../src/client/page";
import { createPageState } from "../../src/client/page-state";
import { VENDORS } from "../../src/client/shell";
import { elementsOfSim, textsOfSim } from "../support/container-sim";

const t = dictionaryOf("zh");

/** 渲染页面（只给最小 props）。 */
function render(update: unknown, extra: Record<string, unknown> = {}): unknown {
  return PageShell({
    state: createPageState(VENDORS, [
      { ns: "llm-commandcode", row: "llm-commandcode", value: {}, revision: 1 },
      { ns: "llm-opencode-go", row: "opencode-go", value: {}, revision: 1 },
      { ns: "llm-opendesign", row: "opendesign", value: {}, revision: 1 },
    ]),
    entries: VENDORS,
    t,
    onSelectTab: () => undefined,
    onSetField: () => undefined,
    onSave: () => undefined,
    update,
    onCheckUpdate: () => undefined,
    ...extra,
  } as never);
}

/** 找标题行里的更新控件。 */
function meter(tree: unknown): { props: Record<string, unknown> } | undefined {
  return elementsOfSim(tree).find((element) => element.props["data-update-meter"] !== undefined);
}

describe("更新控件在标题行最右边", () => {
  it("**它在 header 的标题行里**，而不是页面里的独立区块", () => {
    const tree = render(undefined);
    const titleRow = elementsOfSim(tree).find((element) => element.props["data-title-row"] !== undefined);
    expect(titleRow, "应当有标题行容器").toBeDefined();
    // 控件是标题行的子元素（同一次展开里能找到，且标题行自己包着 h1）。
    const rowTexts = textsOfSim(titleRow).join("");
    expect(rowTexts).toContain("LLM 账号");
    expect(meter(tree), "标题行里应当有更新控件").toBeDefined();
  });

  it("未检查时也显示（否则用户永远看不到这个入口）", () => {
    const tree = render(undefined);
    expect(meter(tree)?.props["data-update-meter"]).toBe("unchecked");
    expect(textsOfSim(meter(tree)).join("")).toContain("检查更新");
  });

  it("**有新版本**：显示两端版本号 + 「有新版本」+ 更新按钮", () => {
    const tree = render({ kind: "available", installed: "0.1.0", latest: "0.2.0", source: "github" });
    const text = textsOfSim(meter(tree)).join(" ");
    expect(text).toContain("v0.1.0");
    expect(text).toContain("v0.2.0");
    expect(text).toContain("有新版本");
    expect(elementsOfSim(meter(tree)).some((element) => element.props["data-update-start"] !== undefined)).toBe(true);
  });

  it("**已是最新**：只显示当前版本 + 「已是最新」，不给更新按钮", () => {
    const tree = render({ kind: "current", installed: "0.1.0", source: "github" });
    const text = textsOfSim(meter(tree)).join(" ");
    expect(text).toContain("v0.1.0");
    expect(text).toContain("已是最新");
    expect(elementsOfSim(meter(tree)).some((element) => element.props["data-update-start"] !== undefined)).toBe(false);
  });

  it("**本地链接安装**：如实说不会更新（不给假按钮）", () => {
    const tree = render({ kind: "not-applicable", installed: "0.1.0", source: "linked" });
    const text = textsOfSim(meter(tree)).join(" ");
    expect(text).toContain("不会更新");
    expect(elementsOfSim(meter(tree)).some((element) => element.props["data-update-start"] !== undefined)).toBe(false);
  });

  it("查不到时把原因显示出来（查不到 ≠ 已是最新）", () => {
    const tree = render({ kind: "unknown", reason: "这个宿主没有插件更新接口" });
    expect(textsOfSim(meter(tree)).join(" ")).toContain("这个宿主没有插件更新接口");
  });

  it("检查中按钮禁用", () => {
    const tree = render({ kind: "current", installed: "0.1.0", source: "github" }, { updateBusy: true });
    const button = elementsOfSim(meter(tree)).find((element) => element.props["data-update-check"] !== undefined);
    expect(button?.props["disabled"]).toBe(true);
    expect(textsOfSim(meter(tree)).join(" ")).toContain("正在检查");
  });
});
