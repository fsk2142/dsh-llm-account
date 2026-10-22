/**
 * 账号改名后能恢复默认名称（用户 2026-10-22 要求）。
 *
 * 用户原话：「账号名称修改后如果不想用了可以恢复为默认名称，就是账户原本的名称」，
 * 并明确了「默认名称」= **登录邮箱**。
 *
 * ## 为什么需要新字段
 *
 * 账号条目原本只有 `name`（展示名）。用户改名会覆盖它，而登录邮箱就此丢失 ——
 * 「恢复默认」这件事就**无从下手**（除非去解析凭据 ref 里那段转义文本，但那是
 * 凭据槽名，不是用户能认的邮箱）。
 *
 * 所以新增 `defaultName`：
 *
 * - 只在**登录落库**时写一次；
 * - `rename` **永不改它**（默认值不该被用户的改名影响）；
 * - 老账号没有它 → `defaultLabel === undefined` → 界面禁用「恢复默认名称」（**不猜**）。
 */
import { describe, expect, it } from "vitest";

import { restoreDefaultLabelOf } from "../../src/client/account-card";
import { openAction, type PageState } from "../../src/client/page-state";

describe("默认名称的读取与恢复", () => {
  it("账号有 defaultLabel 时，「恢复默认」可用并指向它", () => {
    const account = {
      ref: "ACC_1",
      label: "我的小号", // 用户改过的名字
      defaultLabel: "user@example.com", // 登录邮箱
    };
    expect(restoreDefaultLabelOf(account)).toBe("user@example.com");
  });

  it("**默认名与当前名相同时不需要恢复**（菜单项应禁用）", () => {
    const account = {
      ref: "ACC_1",
      label: "user@example.com",
      defaultLabel: "user@example.com",
    };
    expect(restoreDefaultLabelOf(account), "名字已经是默认的，没有什么可恢复").toBeUndefined();
  });

  it("**老账号没有 defaultLabel 时不可恢复**（不猜一个名字出来）", () => {
    const account = { ref: "ACC_1", label: "某个账号" };
    expect(restoreDefaultLabelOf(account)).toBeUndefined();
  });

  it("空白的 defaultLabel 当作没有", () => {
    const account = { ref: "ACC_1", label: "改了名", defaultLabel: "   " };
    expect(restoreDefaultLabelOf(account)).toBeUndefined();
  });
});

describe("点「恢复默认名称」预填默认名", () => {
  /** 一个最小的页面状态：`openAction` 只读 `action` / `actionVendor` 两个字段。 */
  const emptyState = { action: undefined, actionVendor: undefined } as unknown as PageState;

  it("**预填默认名**，用户确认即可（不用重新打一遍邮箱）", () => {
    const next = openAction(emptyState, { kind: "rename", ref: "ACC_1", label: "user@example.com" });
    expect(next.action).toMatchObject({
      kind: "rename",
      ref: "ACC_1",
      label: "user@example.com",
    });
    // 密钥框不该被填（这是改名，不是换密钥）。
    expect(next.action?.key).toBe("");
  });

  it("普通改名仍然从空白开始（不受这次改动影响）", () => {
    const next = openAction(emptyState, { kind: "rename", ref: "ACC_1" });
    expect(next.action?.label).toBe("");
  });
});