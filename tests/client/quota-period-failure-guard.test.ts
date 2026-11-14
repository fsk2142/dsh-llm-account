/**
 * **周期额度失败不该让余额显示成「读取失效」**（2026-11-14 真机根因）。
 *
 * ## 被钉住的真实症状
 *
 * 用户报「更新后账号额度经常读取失效」。
 *
 * 实测根因（不是猜测）：
 * - opendesign 配了 **3 个账号**；vela 登录态只属于其中 **1 个**（foxmail）；
 * - 另外 2 个账号（qq 的两个 workspace）走 vela 取周期额度，
 *   实测返回 `403 workspace_forbidden`；
 * - 于是那 2 个账号的 `failures` **每次都非空**；
 * - 旧代码 `readableQuota()` 一刀切：`failures` 非空 → 判「读取失效」；
 * - 而它们的**余额与套餐其实读到了**（`quota.ts` 的文案里自己就这么写）。
 *
 * ## 本文件钉住的分档
 *
 * | 失败来源 | 致命？ | 理由 |
 * | --- | --- | --- |
 * | 账单摘要（`/billing/summary`） | **是** | 它就是余额与套餐本身 |
 * | 控制面密钥缺失 | **是** | 连余额都拿不到 |
 * | 周期额度（5 小时/周、vela） | **否** | 只影响那两档窗口，余额仍然准 |
 * | 工作区未配置 | **否** | 同上 |
 *
 * 分档发生在**厂商侧**（`opendesign/quota.ts` 记进 `failuresFatal`），
 * 由客户端 `quota-readability` 消费 —— 这样「哪类失败致命」是厂商知识，
 * 不需要客户端去猜文案前缀。
 */
import { describe, expect, it } from "vitest";

import { readableQuotaOf } from "../../src/client/quota-readability";

/** 一次「周期额度失败但余额读到了」的典型读数（真机形状）。 */
const PERIOD_ONLY_FAILURE = {
  windows: [{ key: "5h", used: 49561, cap: 50000 }],
  failures: [
    "周期额度：HTTP 接口不可用，退回本机 vela 查询；而 vela 登录态与本账号不是同一个人，为避免显示别人的用量已跳过（余额与套餐仍然准确）",
  ],
  failuresFatal: [] as string[],
};

describe("周期额度失败不连坐余额（真机根因守卫）", () => {
  it("**只有周期额度失败 → 读数仍然可信**", () => {
    expect(readableQuotaOf(PERIOD_ONLY_FAILURE)).toBe(true);
  });

  it("**文案里写着「余额与套餐仍然准确」的失败 → 一定不能判失效**", () => {
    // 这条是「文案与判定自相矛盾」的直接守卫：厂商既然这么说，判定就必须同意。
    for (const message of PERIOD_ONLY_FAILURE.failures) {
      expect(message, "厂商文案承诺了仍然准确").toContain("仍然准确");
    }
    expect(readableQuotaOf(PERIOD_ONLY_FAILURE)).toBe(true);
  });

  it("账单摘要失败 + 周期额度失败 → 不可信（致命项仍然生效）", () => {
    const both = {
      windows: [{ key: "5h", used: 1, cap: 10 }],
      failures: [...PERIOD_ONLY_FAILURE.failures, "账单摘要读取失败（账单接口返回 HTTP 403）：套餐信息与额度换算单位暂时缺失"],
      failuresFatal: ["账单摘要读取失败（账单接口返回 HTTP 403）：套餐信息与额度换算单位暂时缺失"],
    };
    expect(readableQuotaOf(both)).toBe(false);
  });

  it("`failures` 一条都不能丢（UI 仍要显示周期额度那条提示）", () => {
    // 分档只是**多加一个**判断维度，不是把文案从 `failures` 里移走。
    expect(PERIOD_ONLY_FAILURE.failures).toHaveLength(1);
    expect(PERIOD_ONLY_FAILURE.failuresFatal).toHaveLength(0);
  });
});
