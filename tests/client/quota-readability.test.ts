/**
 * 失败分档（2026-11-14 修「账号额度经常读取失效」）。
 *
 * ## 被钉住的缺陷
 *
 * `readableQuota()` 原来一刀切：额度读数里 `failures` 只要有**任何一条**，就判这份
 * 读数不可信、该账号显示「读取失效」。
 *
 * 但三家的返回值里，`failures` 混着两类完全不同的东西：
 *
 * | 类别 | 例子 | 余额/套餐还准吗 |
 * | --- | --- | --- |
 * | **致命** | 账单摘要端点失败、账号读不到 | **不准** |
 * | **非致命** | 周期额度（5 小时/周）读不到、vela 身份不匹配 | **仍然准** |
 *
 * 实测证据（2026-11-14）：用户 opendesign 配了 3 个账号，vela 登录态只属于其中
 * 一个。另外两个账号的周期额度走 vela 必然 `403 workspace_forbidden`
 * —— 于是那两个账号的 `failures` 永远非空，界面永远显示「额度读取失效」，
 * 而它们的余额与套餐其实读到了。
 *
 * `opendesign/quota.ts` 的失败文案里自己就写着「（余额与套餐仍然准确）」
 * —— 同一份代码里两处自相矛盾。
 *
 * ## 修法
 *
 * 把「这次读数是否可信」与「有没有附带问题」分开：
 * - `failures`：**全部**失败文案（UI 照旧显示，一条都不丢）；
 * - `failuresFatal`：只有**真正让余额/窗口不可信**的那些。
 *
 * 客户端 `readableQuota()` 改看 `failuresFatal`。
 * 老宿主不带这个字段时**回落**到旧语义（`failures` 非空即不可信），不会突然变宽松。
 */
import { describe, expect, it } from "vitest";

import { readableQuotaOf } from "../../src/client/quota-readability";

describe("额度可读性：致命失败才算不可信", () => {
  it("**没有 failures → 可读**", () => {
    expect(readableQuotaOf({ windows: [{ key: "5h", used: 1, cap: 10 }], failures: [] })).toBe(true);
  });

  it("**只有非致命失败（周期额度）→ 仍然可读**（这是本轮的根因）", () => {
    const quota = {
      windows: [{ key: "5h", used: 49561, cap: 50000 }],
      failures: ["周期额度：HTTP 接口不可用，退回本机 vela 查询；而 vela 登录态与本账号不是同一个人（余额与套餐仍然准确）"],
      failuresFatal: [],
    };
    expect(readableQuotaOf(quota)).toBe(true);
  });

  it("**有致命失败（账单摘要）→ 不可读**", () => {
    const quota = {
      windows: [],
      failures: ["账单摘要读取失败（账单接口不可达（fetch failed)）：套餐信息与额度换算单位暂时缺失"],
      failuresFatal: ["账单摘要读取失败（账单接口不可达（fetch failed)）：套餐信息与额度换算单位暂时缺失"],
    };
    expect(readableQuotaOf(quota)).toBe(false);
  });

  it("没有窗口 → 不可读（无论失败如何）", () => {
    expect(readableQuotaOf({ windows: [], failures: [], failuresFatal: [] })).toBe(false);
  });

  it("**老宿主不带 failuresFatal → 回落到旧语义**（failures 非空即不可读）", () => {
    const legacy = { windows: [{ key: "5h", used: 1, cap: 10 }], failures: ["any"] };
    expect(readableQuotaOf(legacy), "不认识新字段的读数不能突然被当成可信").toBe(false);
  });
});
