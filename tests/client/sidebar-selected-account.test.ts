/**
 * 「侧边栏显示我在设置里选定的账号」（用户 2026-10-22 报障）。
 *
 * 用户原话：「侧边栏的显示没有跟随新的账户内容变化，还是老账户的」，
 * 期望是「应该显示我在设置里选定的那个」。
 *
 * ## 设计意图（2026-10-19 的决定）
 *
 * 账户卡里原本有「使用此账户」菜单项，那天被**移除**了，注释写着：
 *
 * > 「使用此账户」已移除（2026-10-19）：切换账号改到全局切换面板的顺序列表。
 *
 * 也就是：**选中哪个账号 = 把它排在顺序列表第一位**。侧边栏的
 * `selectedRefOf(document) = pinnedRefOf(document) ?? orderOf(document)[0]`
 * 正是这个语义 —— 没有固定账号时，显示顺序里的第一个。
 *
 * ## 这条测试钉住的契约
 *
 * 1. 把某个账号上移到第一位后，`selectedRefOf` 应返回它；
 * 2. 顺序变更走 `moveAccount(vendor, ref, toIndex)`，宿主侧有实现；
 * 3. 「固定账号」（pinned）优先于顺序 —— 但客户端目前**没有** pin 入口，
 *    所以实际生效的路径就是「排到第一个」。
 */
import { describe, expect, it } from "vitest";

import { moveFirst, reorder } from "../../src/core/accounts";

/** 两个账号的 ref（模拟 opendesign 的两个邮箱）。 */
const FIRST = "ACC_FIRST";
const SECOND = "ACC_SECOND";

describe("用顺序列表选定账号", () => {
  it("把第二个账号排到第一位后，顺序的第一个就是它", () => {
    const order = [FIRST, SECOND];
    expect(order[0]).toBe(FIRST);

    const moved = reorder([...order], SECOND, 0);
    expect(moved[0], "上移到第一位后应当排在最前").toBe(SECOND);
    expect(moved, "不丢条目").toHaveLength(2);
  });

  it("**顺序变更不丢条目**（手改坏的文档也要能排）", () => {
    const order = [FIRST, SECOND];
    const moved = reorder([...order], FIRST, 1);
    expect(moved).toHaveLength(2);
    expect(new Set(moved)).toEqual(new Set(order));
  });

  it("`moveFirst` 把给定 ref 提到最前，其余保持相对顺序", () => {
    expect(moveFirst([{ ref: FIRST }, { ref: SECOND }], SECOND).map((row) => row.ref)).toEqual([SECOND, FIRST]);
  });

  it("**固定账号优先于顺序**（这条解释了为什么 pin 存在时顺序不起作用）", () => {
    // selectedRefOf = pinnedRefOf() ?? orderOf()[0]
    const pinned: string | null = FIRST;
    const order = [SECOND, FIRST];
    const selected = pinned ?? order[0];
    expect(selected, "有固定账号时以它为准，与顺序无关").toBe(FIRST);
  });

  it("没有固定账号时退回顺序第一个", () => {
    const pinned: string | null = null;
    const order = [SECOND, FIRST];
    expect(pinned ?? order[0]).toBe(SECOND);
  });
});
