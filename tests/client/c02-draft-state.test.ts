/**
 * C02 复现与修复验证：**用户的最新意图必须保存**。
 *
 * ## 报告指出的场景（1.6.3 当前真实复现）
 *
 * `false → true（保存中）→ false`，最终持久化仍是 `true` —— 用户最后一次
 * 开关操作没保存。
 *
 * ## 根因
 *
 * `draftsAfterChange(draft, baseline, key, value)` 在「值与基线相同」时**删掉草稿**。
 * 这本身是对的（改回原值不该发请求），但它无法区分两种「相同」：
 *
 * 1. 用户改回了**服务端已确认**的值 → 确实不用写；
 * 2. 用户改到的值**恰好等于在途那次保存之前**的基线 → 那次保存还没确认，
 *    用户的意图仍是最新的，草稿被删掉就丢了。
 *
 * 用假时钟 + 假设置服务复现真实时序需要整套装配；这里先用生产函数验证
 * **状态机本身的判定**，再决定修法。
 */
import { describe, expect, it } from "vitest";

import { draftsAfterChange } from "../../src/client/page-state";

describe("C02 草稿状态机", () => {
  it("改回**服务端已确认**的原值 → 无草稿（不该发请求）", () => {
    const baseline = { on: true };
    // 先改成 false（有草稿），再改回 true（等于基线）。
    const first = draftsAfterChange(undefined, baseline, "on", false);
    expect(first).toEqual({ on: false });
    const back = draftsAfterChange(first, baseline, "on", true);
    expect(back, "改回基线值后没有待写字段").toBeUndefined();
  });

  it("**报告的序列：最后一次操作就是基线值，但它未被确认**", () => {
    /**
     * 初始：服务端 `true`。
     *
     * 1. 用户拨到 `false` → 草稿 `{on:false}`，发起保存。
     * 2. 保存**在途**时用户拨到 `true` → 与基线（仍是旧的 `true`）相同 →
     *    草稿被删。**这一次丢掉了用户的意图。**
     * 3. 保存完成，服务端变 `false`。用户又拨到 `false` → 与**新基线**相同 →
     *    草稿又被删。
     *
     * 最终服务端 `false`、用户最后意图 `false` —— 这个序列碰巧一致。
     * 但第 2 步的意图确实丢了：如果那之后用户不再操作，服务端会是 `false`
     * 而用户想要 `true`。
     */
    const baselineAtStart = { on: true };
    const first = draftsAfterChange(undefined, baselineAtStart, "on", false);
    expect(first).toEqual({ on: false });
    // 保存在途，用户拨到 true（等于当时的基线）。
    const second = draftsAfterChange(first, baselineAtStart, "on", true);
    expect(second, "**与旧基线相同 → 草稿被删，用户的 true 丢失**").toBeUndefined();
    /**
     * 这就是 C02：`second === undefined` 意味着**不会再有保存请求**。
     * 若此刻保存完成、服务端落到 `false`，用户界面上看到的开关是 `true`
     * （他刚拨的），但持久化是 `false` —— 刷新后变回去。
     */
  });

  it("基线更新后的判定是正确的（服务端确认后就该清草稿）", () => {
    // 服务端已确认 false，之后用户再拨 false：没有待写。
    const baselineAfterSave = { on: false };
    expect(draftsAfterChange(undefined, baselineAfterSave, "on", false)).toBeUndefined();
  });
});

describe("C02 修复：有保存在途时不丢用户意图", () => {
  it("**有在途保存时，改到旧 baseline 值也要保留草稿**", () => {
    const baselineBeforeSave = { on: true };
    // 用户拨到 false，发起保存。
    const first = draftsAfterChange(undefined, baselineBeforeSave, "on", false);
    expect(first).toEqual({ on: false });
    // 保存在途，用户拨回 true（等于旧 baseline）。
    const second = draftsAfterChange(first, baselineBeforeSave, "on", true, true);
    expect(second, "**有在途保存 → 草稿必须留下**（用户的 true 是新的意图）").toEqual({ on: true });
  });

  it("**没有在途保存时**，改到 baseline 值仍然不写（保持原行为）", () => {
    const baseline = { on: true };
    const first = draftsAfterChange(undefined, baseline, "on", false);
    const back = draftsAfterChange(first, baseline, "on", true, false);
    expect(back, "已确认的改回原值 → 无草稿").toBeUndefined();
  });

  it("报告的完整序列：最终持久化必须是用户最后一次的意图", () => {
    /**
     * `false → true（保存中）→ false`：报告说 1.6.3 最终持久化仍是 `true`。
     *
     * 用修复后的状态机走一遍，确认草稿在关键节点不丢。
     */
    let baseline = { on: true }; // 服务端已确认
    // 1. 拨到 false
    let draft = draftsAfterChange(undefined, baseline, "on", false);
    expect(draft).toEqual({ on: false });
    // 2. 保存在途，拨到 true
    draft = draftsAfterChange(draft, baseline, "on", true, true);
    expect(draft, "在途期间的意图不能丢").toEqual({ on: true });
    // 3. 保存完成，服务端变成 false（adopt 更新基线）
    baseline = { on: false };
    // 4. 用户拨回 false —— 此刻服务端就是 false，所以这次确实不用写
    draft = draftsAfterChange(draft, baseline, "on", false, false);
    expect(draft, "服务端已是 false，用户也要 false → 无待写").toBeUndefined();
  });
});
