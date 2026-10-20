/**
 * `vela` 缺失时的安装指引（2026-10-20 用户要求）。
 *
 * 用户原话：「opendesign 新增账户的时候如果使用网页登录，用户缺少环境的时候给出提示，
 * 如何快速安装环境」。
 *
 * 要点不是「显示一句话」，而是**给可执行的东西**：装什么、从哪装、命令是什么、装完怎么办。
 * 所以这里断言的是「有没有那三步 + 那行命令」，而不只是「文案不为空」。
 */
import { describe, expect, it, vi } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { velaInstallGuide } from "../../src/client/account-card";
import { AccountsPanel } from "../../src/client/accounts-panel";
import { elementsOfSim, textsOfSim } from "../support/container-sim";

const t = dictionaryOf("zh");
const en = dictionaryOf("en");

describe("vela-missing 时给出可执行的安装指引", () => {
  it("只对这一种原因渲染（其余失败不该冒出一大段指引）", () => {
    expect(velaInstallGuide(t, "vela-missing")).not.toBeNull();
    for (const other of ["network", "timeout", "denied", "cancelled", "import-failed", undefined]) {
      expect(velaInstallGuide(t, other), String(other)).toBeNull();
    }
  });

  it("包含三步 + 那行可复制的安装命令", () => {
    const guide = velaInstallGuide(t, "vela-missing")!;
    const text = textsOfSim(guide).join("\n");
    // 三步都在（装桌面端 / 装 CLI / 回来重试）。
    expect(text).toContain(t("account.vela.step1"));
    expect(text).toContain(t("account.vela.step2"));
    expect(text).toContain(t("account.vela.step3"));
    // 命令单独一块，且就是实际可用的那条。
    const command = elementsOfSim(guide).find((element) => element.props["data-vela-command"] !== undefined);
    expect(command, "命令应是独立元素，方便整行复制").toBeDefined();
    expect(textsOfSim(command).join("")).toBe("npm i -g @powerformer/vela-cli");
  });

  it("给了重试回调时渲染「重试网页登录」按钮并真的调用它", () => {
    const retry = vi.fn();
    const guide = velaInstallGuide(t, "vela-missing", retry)!;
    const button = elementsOfSim(guide).find((element) => element.props["data-vela-retry"] !== undefined);
    expect(button).toBeDefined();
    (button!.props["onClick"] as () => void)();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("没给回执时不渲染死按钮", () => {
    const guide = velaInstallGuide(t, "vela-missing", undefined)!;
    expect(elementsOfSim(guide).some((element) => element.props["data-vela-retry"] !== undefined)).toBe(false);
  });

  it("英文文案也齐全（不是只写中文）", () => {
    const guide = velaInstallGuide(en, "vela-missing")!;
    const text = textsOfSim(guide).join("\n");
    expect(text).toContain("install the Open Design desktop app");
    expect(text).toContain("npm i -g @powerformer/vela-cli");
  });
});

describe("账户面板里真的会渲染出来（真正生效的路径）", () => {
  // **这条是本轮最重要的回归**：我一开始把指引挂在 `AccountCard` 的 `loginSection` 里，
  // 而账户面板实际走的是 `accounts-panel` 的 `loginNotes`（`AccountCard` 整组件不参与渲染）。
  // 结果：8 条单测全绿、构建通过，而用户在界面上永远看不到 —— 所以这里必须直接测面板。
  it("面板的登录失败提示里带安装指引与重试按钮", () => {
    const panel = AccountsPanel({
      t,
      vendors: [
        {
          entry: { providerId: "opendesign", labelKey: "vendor.opendesign", ns: "llm-opendesign", rowIds: ["opendesign"], order: 30, cards: [] },
          status: statusOfOpenDesign([], "failed"),
          login: { state: "failed", reason: "vela-missing" },
        },
      ],
      selectedVendor: "opendesign",
      onOpenAction: vi.fn(),
      onActionField: vi.fn(),
      onConfirmAction: vi.fn(),
      onCancelAction: vi.fn(),
      onLoginBegin: vi.fn(),
    } as never);
    const guide = elementsOfSim(panel).find((element) => element.props["data-vela-guide"] !== undefined);
    expect(guide, "面板里应当出现安装指引").toBeDefined();
    expect(elementsOfSim(panel).some((element) => element.props["data-vela-retry"] !== undefined)).toBe(true);
  });

  it("面板里其它失败原因不出现指引", () => {
    const panel = AccountsPanel({
      t,
      vendors: [
        {
          entry: { providerId: "opendesign", labelKey: "vendor.opendesign", ns: "llm-opendesign", rowIds: ["opendesign"], order: 30, cards: [] },
          status: statusOfOpenDesign([], "failed"),
          login: { state: "failed", reason: "network" },
        },
      ],
      selectedVendor: "opendesign",
      onOpenAction: vi.fn(),
      onActionField: vi.fn(),
      onConfirmAction: vi.fn(),
      onCancelAction: vi.fn(),
      onLoginBegin: vi.fn(),
    } as never);
    expect(elementsOfSim(panel).some((element) => element.props["data-vela-guide"] !== undefined)).toBe(false);
  });
});

/** 一份 opendesign 的用量状态（只要能让面板渲染登录提示即可）。 */
function statusOfOpenDesign(accounts: readonly Record<string, unknown>[], loginState: string): unknown {
  void loginState;
  return {
    vendor: "opendesign",
    capabilities: {
      reorder: false,
      pin: true,
      browserLogin: true,
      modelAccountRules: true,
      quotaShape: "windows",
      modelVisibilityWrite: "onSave",
      automaticSwitch: true,
    },
    pinned: null,
    accounts: [...accounts],
    failures: [],
  };
}
