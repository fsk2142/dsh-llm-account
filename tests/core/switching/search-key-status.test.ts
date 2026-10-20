/**
 * 搜索 key 的「已添加 / 未添加」状态（2026-10-20 用户报障）。
 *
 * 用户原话：「我添加 API KEY 后保存了，没有显示我是否已经添加」。
 *
 * 根因：界面上那个输入框填的是**引用名**（如 `DEEPSEEK_API_KEY`），而真 key 存在凭据库里。
 * 填了名字不等于库里有那把 key —— 但界面从来不去查，所以用户无从判断。
 *
 * 修法：加一个远程方法 `credentialStatus(refs)`，返回每个引用名是否**真的**配置了
 * （与账号卡片的「已配置」徽标同一个判断来源）。
 */
import { describe, expect, it } from "vitest";

import { summarizeKeyStatus, type KeyStatus } from "../../../src/core/switching/search-keys";

describe("把逐条状态汇总成一句可读的话", () => {
  it("一条都没填 → 未添加（并说明去哪里加）", () => {
    const summary = summarizeKeyStatus([]);
    expect(summary.configured).toBe(0);
    expect(summary.total).toBe(0);
    expect(summary.state).toBe("none");
  });

  it("填了名字但库里没有 → 未添加（**这是最容易让人误会的状态**）", () => {
    const rows: KeyStatus[] = [{ ref: "DEEPSEEK_API_KEY", configured: false }];
    const summary = summarizeKeyStatus(rows);
    expect(summary.state).toBe("missing");
    expect(summary.configured).toBe(0);
    expect(summary.total).toBe(1);
  });

  it("全部配置好了 → 已添加", () => {
    const rows: KeyStatus[] = [
      { ref: "A", configured: true },
      { ref: "B", configured: true },
    ];
    const summary = summarizeKeyStatus(rows);
    expect(summary.state).toBe("configured");
    expect(summary.configured).toBe(2);
  });

  it("部分配置 → partial（既不是「都已添加」也不说「未添加」）", () => {
    const rows: KeyStatus[] = [
      { ref: "A", configured: true },
      { ref: "B", configured: false },
    ];
    const summary = summarizeKeyStatus(rows);
    expect(summary.state).toBe("partial");
    expect(summary.configured).toBe(1);
    expect(summary.total).toBe(2);
  });

  it("缺哪几条要能点名（用户要知道去补哪个）", () => {
    const rows: KeyStatus[] = [
      { ref: "A", configured: true },
      { ref: "B", configured: false },
      { ref: "C", configured: false },
    ];
    expect(summarizeKeyStatus(rows).missing).toEqual(["B", "C"]);
  });
});
