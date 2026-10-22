/**
 * 侧边栏跟随「最近发过请求的账号」—— 现有行为的回归保护。
 *
 * ## 背景（2026-10-22 排查记录，避免以后再走弯路）
 *
 * 用户报「侧边栏显示没有跟随账户变化」，追问后澄清期望是：
 * 「不要求点『使用此账户』立即显示，但**后续发送新请求后**必须跟随那个账号」。
 *
 * 排查中一度以为缺功能，实际**这条路径本来就是通的**：
 *
 * | 环节 | 实测结果 |
 * | --- | --- |
 * | 宿主台账 | 最近记录是第二个账号（`lastUsedAccountOf` 在真实台账上跑出正确结果） |
 * | `usageReport.lastUsed` | 正确携带 |
 * | `reportOf`（客户端解信封） | 保留 `lastUsed` |
 * | `sidebarCurrentTarget` | 有效期 30 分钟，命中清单就用它 |
 * | 界面 | 用户确认侧边栏确实显示第二个账号 |
 *
 * 所以这次**没有改代码**（临时加过的「手动选定优先层」已按用户澄清撤销 ——
 * 那会与「跟随真实请求」的优先级打架）。
 *
 * ## 这条测试钉住的契约
 *
 * 优先级：**最近请求的账号** > 清单第一个。以及各种降级情形。
 */
import { describe, expect, it } from "vitest";

import { sidebarCurrentTarget, type SidebarTarget } from "../../src/client/page-state";
import { DEFAULT_FRESH_TTL_MS, isLastUsedFresh } from "../../src/core/last-used";

/** 两个账号的轮播清单（顺序 = `status.accounts` 的顺序 = 配置里的数组顺序）。 */
const TARGETS: readonly SidebarTarget[] = [
  { vendor: "opendesign", ref: "ACC_FIRST" },
  { vendor: "opendesign", ref: "ACC_SECOND" },
];

describe("侧边栏跟随最近请求的账号", () => {
  it("**没有最近使用记录时显示清单第一个**", () => {
    expect(sidebarCurrentTarget(TARGETS, undefined)?.ref).toBe("ACC_FIRST");
  });

  it("**有最近使用记录时显示它**（这是用户要的「跟随」）", () => {
    const now = 1_000_000;
    const target = sidebarCurrentTarget(TARGETS, { vendor: "opendesign", account: "ACC_SECOND", at: now }, now);
    expect(target?.ref, "发了请求就该跟过去，而不是停在清单第一个").toBe("ACC_SECOND");
  });

  it("最近使用的是一个**已被删除**的账号时退回清单第一个（不显示对不上的名字）", () => {
    const now = 1_000_000;
    const target = sidebarCurrentTarget(TARGETS, { vendor: "opendesign", account: "ACC_GONE", at: now }, now);
    expect(target?.ref).toBe("ACC_FIRST");
  });

  it("最近使用**过期**（超过 30 分钟）后退回清单第一个", () => {
    const now = 10_000_000;
    const stale = now - DEFAULT_FRESH_TTL_MS - 1;
    const target = sidebarCurrentTarget(TARGETS, { vendor: "opendesign", account: "ACC_SECOND", at: stale }, now);
    expect(target?.ref, "超过新鲜期就不再压过清单顺序").toBe("ACC_FIRST");
  });

  it("清单为空时不显示任何账号", () => {
    expect(sidebarCurrentTarget([], undefined)).toBeUndefined();
  });

  it("新鲜期是 30 分钟，且时钟回拨也当作新鲜（不闪回第一家）", () => {
    expect(DEFAULT_FRESH_TTL_MS).toBe(30 * 60_000);
    // 时钟回拨：at 比 now 还晚。
    expect(isLastUsedFresh(2_000, 1_000)).toBe(true);
    // 非法值一律不新鲜。
    expect(isLastUsedFresh(0, 1_000)).toBe(false);
    expect(isLastUsedFresh(Number.NaN, 1_000)).toBe(false);
  });
});
