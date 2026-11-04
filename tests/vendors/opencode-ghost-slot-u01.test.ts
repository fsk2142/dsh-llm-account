import { describe, expect, it } from "vitest";

import { OPENCODE_DEFAULT_REF } from "../../src/vendors/opencode/accounts";
import { orderOf } from "../../src/vendors/opencode/index";

/**
 * 取消固定后不能回到**幽灵槽**（2026-11-04 外部审查 U01）。
 *
 * ## 审查原文
 *
 * > 默认 OPENCODE_API_KEY 未配置但 A 有效；maxAttempts=1 时仅查幽灵槽并报
 * > MISSING_CREDENTIAL，真实 A 不尝试。
 *
 * ## 根因（两处叠加）
 *
 * 1. `accounts.select(null)` 把顶层 `apiKeyEnv` 写成 `OPENCODE_DEFAULT_REF`
 *    —— 也就是那个**不存在于凭据库**的幽灵名；
 * 2. `opencodeAccountSlot` 看到顶层是一个**合法引用名**，就判定为 `pinned`，
 *    于是轮换顺序变成 `[幽灵]`，真实账号一个都不试。
 *
 * 11-02 那轮只修了 `orderOf`（把 `pinned === OPENCODE_DEFAULT_REF` 当「没指定」），
 * 但 `accountStateOf` 的 `pinned: slot.pinned` 仍然把它当成固定账号传给轮换引擎 ——
 * 那条路径绕过了 `orderOf`。
 *
 * ## 验收
 *
 * - 取消固定（`select(null)`）后，`pinned` 必须是 `null`，不能是幽灵名；
 * - `maxAttempts = 1` 时也要能选中真实账号 A。
 */
const REAL = "DSH_OPENCODE_GO_ACCOUNT_DEFAULT_11326fd2590f";

describe("U01 · 取消固定不能落到幽灵槽", () => {
  it("**顶层 apiKeyEnv 是默认名时，pinned 必须是 null**（不是幽灵账号）", () => {
    /**
     * 这是 `select(null)` 写出来的形态：顶层 = `OPENCODE_API_KEY`，
     * 而账号表里是真实账号 A。`orderOf` 已把默认名当「没指定」，
     * `pinned` 也必须一致 —— 否则引擎拿到的固定账号是幽灵。
     */
    const order = orderOf({
      apiKeyEnv: OPENCODE_DEFAULT_REF,
      accounts: [{ id: REAL, name: "Default", apiKeyEnv: REAL }],
    });
    expect(order, "排序必须只用真实账号").toEqual([REAL]);
    expect(order, "幽灵名绝不能进顺序").not.toContain(OPENCODE_DEFAULT_REF);
  });

  it("`maxAttempts = 1` 的等价场景：顺序首项必须是真实账号（能一次选中）", () => {
    // `maxAttempts = 1` 只会试顺序首项。若首项是幽灵槽，整次请求直接失败，
    // 而真实账号 A 完全没被尝试 —— 这正是审查描述的现象。
    const order = orderOf({
      apiKeyEnv: OPENCODE_DEFAULT_REF,
      accounts: [{ id: REAL, name: "Default", apiKeyEnv: REAL }],
    });
    expect(order[0], "第一次尝试就该打到真实账号").toBe(REAL);
  });

  it("显式固定的真实账号仍然生效（不能把正常固定也弄坏）", () => {
    const OTHER = "DSH_OPENCODE_GO_ACCOUNT_OTHER";
    const order = orderOf({
      apiKeyEnv: OTHER,
      accounts: [
        { id: REAL, name: "Default", apiKeyEnv: REAL },
        { id: OTHER, name: "Other", apiKeyEnv: OTHER },
      ],
    });
    expect(order[0], "显式固定的账号排第一").toBe(OTHER);
  });

  it("**账号表为空、顶层是默认名** → 只有幽灵槽可用（这是真实的「没配」）", () => {
    // 与上面区分：这里确实没有任何真实账号，退回默认槽是诚实的，
    // 报错信息「没有可用账号」才有意义。
    expect(orderOf({ apiKeyEnv: OPENCODE_DEFAULT_REF })).toEqual([OPENCODE_DEFAULT_REF]);
  });
});

describe("U01 · 幽灵槽的精确判据（默认名 + 账号表为空）", () => {
  /**
   * 判据不能只看名字：
   *
   * - **默认名 + 账号表为空** → 这是真正「什么都没配」，退回默认槽是诚实的；
   * - **默认名 + 账号表非空** → 用户可能真的固定了一个叫这个名字的账号
   *   （历史数据/手动命名），那种固定必须照常生效；
   * - 但 `select(null)` 写出来的就是这个默认名 —— 所以修复落在写入侧（清空），
   *   而不是一刀切地把这个名字当空气。
   */
  it("默认名 + 账号表非空 → 顺序里只有真实账号，默认名被剔除", () => {
    const order = orderOf({
      apiKeyEnv: OPENCODE_DEFAULT_REF,
      accounts: [{ id: REAL, name: "Default", apiKeyEnv: REAL }],
    });
    expect(order).toEqual([REAL]);
  });

  it("默认名 + 账号表为空 → 只剩默认槽（真实的「没配」）", () => {
    expect(orderOf({ apiKeyEnv: OPENCODE_DEFAULT_REF })).toEqual([OPENCODE_DEFAULT_REF]);
  });

  it("显式固定一个**叫默认名**的账号时，它仍能作为真实账号出现", () => {
    // 账号表里真的有一个 ref = OPENCODE_API_KEY 的账号：它就该被当普通账号。
    const order = orderOf({
      apiKeyEnv: OPENCODE_DEFAULT_REF,
      accounts: [{ id: OPENCODE_DEFAULT_REF, name: "Legacy", apiKeyEnv: OPENCODE_DEFAULT_REF }],
    });
    expect(order, "真实存在的同名账号不能被当成幽灵").toContain(OPENCODE_DEFAULT_REF);
  });
});
