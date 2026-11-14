/**
 * 凭据「已配置」汇总（`core/credential-summary.ts`）。
 *
 * ## 这不是搜索专用功能 —— 所以搜索删了，它的测试要留下
 *
 * 2026-11-14 剥离网页搜索时，`summarizeKeyStatus` 从 `search-keys.ts` 搬到了
 * `core/credential-summary.ts` —— 因为设置页对**环境变量名**类字段
 * （三家的 `apiKeyEnv`）也要显示「已配置 / 未配置」徽标，那与搜索无关。
 *
 * 原来的 5 条用例在 `search-key-status.test.ts` 里、随搜索一起被删了；
 * 这里把**针对这段逻辑本身**的用例恢复过来（不恢复那个文件，因为它的头部
 * 与搜索密钥的引用名列表绑在一起）。
 *
 * ## 这 5 条钉住的性质
 *
 * `state` 必须分四档（`none` / `missing` / `partial` / `configured`）而不是一个布尔：
 * **「填了名字但库里没有」是最容易让人误会的状态** —— 用户以为自己配好了，
 * 其实那一项仍然用不了。`missing` 还要能**点名**缺哪几条，用户才知道去补哪个。
 */
import { describe, expect, it } from "vitest";

import { summarizeKeyStatus, type KeyStatus } from "../../src/core/credential-summary";

describe("把逐条状态汇总成一句可读的话", () => {
  it("一条都没填 → `none`（界面据此只说「还没有」）", () => {
    const summary = summarizeKeyStatus([]);
    expect(summary.configured).toBe(0);
    expect(summary.total).toBe(0);
    expect(summary.state).toBe("none");
  });

  it("填了名字但库里没有 → `missing`（**最容易让人误会的状态**）", () => {
    const rows: KeyStatus[] = [{ ref: "DEEPSEEK_API_KEY", configured: false }];
    const summary = summarizeKeyStatus(rows);
    expect(summary.state).toBe("missing");
    expect(summary.configured).toBe(0);
    expect(summary.total).toBe(1);
  });

  it("全部配置好了 → `configured`", () => {
    const rows: KeyStatus[] = [
      { ref: "A", configured: true },
      { ref: "B", configured: true },
    ];
    const summary = summarizeKeyStatus(rows);
    expect(summary.state).toBe("configured");
    expect(summary.configured).toBe(2);
  });

  it("部分配置 → `partial`（既不说「都已添加」也不说「未添加」）", () => {
    const rows: KeyStatus[] = [
      { ref: "A", configured: true },
      { ref: "B", configured: false },
    ];
    const summary = summarizeKeyStatus(rows);
    expect(summary.state).toBe("partial");
    expect(summary.configured).toBe(1);
    expect(summary.total).toBe(2);
  });

  it("**缺哪几条要能点名**（用户要知道去补哪个）", () => {
    const rows: KeyStatus[] = [
      { ref: "A", configured: true },
      { ref: "B", configured: false },
      { ref: "C", configured: false },
    ];
    expect(summarizeKeyStatus(rows).missing).toEqual(["B", "C"]);
  });
});
