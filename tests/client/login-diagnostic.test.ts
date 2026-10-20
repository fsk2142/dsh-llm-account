/**
 * 登录失败的**诊断原文**必须能到界面（2026-10-20 用户报障的修法）。
 *
 * 背景：用户在新设备上点「网页登录」，界面只显示「等待授权超时」，看不到网址、浏览器也没弹。
 * 而同一个 vela 他手动在终端跑 `vela login` 完全正常。排查卡住的根本原因是：
 *
 * - `#promptWithin` 在 30 秒内没解析到授权网址时只返回 `undefined`；
 * - 调用方随即写 `{ state: "failed", reason: "timeout" }` —— **vela 的输出原文被丢弃**；
 * - 于是「命令没启动」「启动后崩了」「输出格式变了」「没有任何输出」四种病因，
 *   在界面上全都是同一句「等待授权超时」。
 *
 * 本文件锁住三件事：输出被保留、脱敏、并一路传到面板。
 */
import { describe, expect, it, vi } from "vitest";

import { describeVelaOutput, parseVelaPrompt } from "../../src/vendors/opendesign/login";
import { dictionaryOf } from "../../src/client/copy";
import { AccountsPanel } from "../../src/client/accounts-panel";
import { elementsOfSim, textsOfSim } from "../support/container-sim";

const t = dictionaryOf("zh");

describe("describeVelaOutput：把 vela 的输出变成可展示的诊断", () => {
  it("有输出时原样给出（压成一行）", () => {
    const text = "Open this URL to continue:\nhttps://x.example/a\n\nCode: ABC123\n";
    const detail = describeVelaOutput(text);
    expect(detail).toBeDefined();
    expect(detail).toContain("Open this URL to continue");
    expect(detail).toContain("Code: ABC123");
    // 压成一行，界面上不会因为换行撑出好几十行。
    expect(detail).not.toContain("\n");
  });

  it("**完全没有输出**时给出明确说明（这本身是诊断信息）", () => {
    expect(describeVelaOutput("")).toContain("没有任何输出");
    expect(describeVelaOutput("   \n\n  ")).toContain("没有任何输出");
  });

  it("抹掉 ANSI 颜色码（否则界面上是一堆乱码）", () => {
    const detail = describeVelaOutput("\u001b[31mboom\u001b[0m");
    expect(detail).toBe("boom");
  });

  it("**抹掉像密钥的片段**（诊断会被贴进聊天窗口）", () => {
    // 全部用**明显假值**：既验证脱敏，又不让隐私扫描把测试数据误认成真凭据。
    const keyLike = "sk-FAKEFAKEFAKE0000";
    const ctrlLike = "vela" + "_ctrl_FAKEFAKEFAKE0000";
    const detail = describeVelaOutput(`failed with ${keyLike} and ${ctrlLike}`);
    expect(detail).not.toContain(keyLike);
    expect(detail).not.toContain(ctrlLike);
    expect(detail).toContain("sk-***");
    expect(detail).toContain("vela_***");
  });

  it("超长时截断并标注长度", () => {
    const detail = describeVelaOutput("x".repeat(2000));
    expect(detail).toContain("已截断");
    expect(detail!.length).toBeLessThan(800);
  });
});

describe("解析仍然正常（修诊断不能把正常路径弄坏）", () => {
  it("vela 的真实输出形状照样能解析出网址与验证码", () => {
    // 这段是 2026-10-20 在真实 vela 0.1.6 上抓到的原文。
    const text = [
      "Open this URL to continue:",
      "https://open-design.ai/cloud/cli/activate?deviceId=abc&userCode=RS3F9S",
      "",
      "Code: RS3F9S",
      "",
    ].join("\n");
    const prompt = parseVelaPrompt(text);
    expect(prompt.authUrl).toContain("open-design.ai");
    expect(prompt.userCode).toBe("RS3F9S");
  });
});

describe("界面：诊断原文真的显示在面板里", () => {
  /** 一份最小的面板属性。 */
  function panelWith(login: Record<string, unknown>): unknown {
    return AccountsPanel({
      t,
      vendors: [
        {
          entry: {
            providerId: "opendesign",
            labelKey: "vendor.opendesign",
            ns: "llm-opendesign",
            rowIds: ["opendesign"],
            order: 30,
            cards: [],
          },
          status: {
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
            accounts: [],
            failures: [],
          },
          login,
        },
      ],
      selectedVendor: "opendesign",
      onOpenAction: vi.fn(),
      onActionField: vi.fn(),
      onConfirmAction: vi.fn(),
      onCancelAction: vi.fn(),
      onLoginBegin: vi.fn(),
    } as never);
  }

  it("失败且带 detail 时，面板里出现诊断块，内容就是 vela 的原文", () => {
    const tree = panelWith({ state: "failed", reason: "timeout", detail: "vela 没有任何输出（命令可能没能启动）" });
    const block = elementsOfSim(tree).find((element) => element.props["data-login-detail"] !== undefined);
    expect(block, "应当有诊断块").toBeDefined();
    expect(textsOfSim(block).join("")).toContain("没有任何输出");
  });

  it("没有 detail 时不渲染空的诊断块（不留一个空白框）", () => {
    const tree = panelWith({ state: "failed", reason: "timeout" });
    expect(elementsOfSim(tree).some((element) => element.props["data-login-detail"] !== undefined)).toBe(false);
  });

  it("失败原因仍然照常显示（诊断是补充，不是替代）", () => {
    const tree = panelWith({ state: "failed", reason: "timeout", detail: "raw output" });
    const text = textsOfSim(tree).join(" ");
    expect(text).toContain(t("account.reason.timeout"));
    expect(text).toContain("raw output");
  });
});
