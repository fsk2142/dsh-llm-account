/**
 * open-design 窗口的美元换算（断言值取自**真机 preflight**）。
 *
 * 背景：`billing/summary` 与 `vela billing summary` **都回 403**，拿不到
 * `creditsPerUsd`。于是窗口只能退回百分比口径 —— 用户看不到「还剩多少美元」。
 * 而官方 `model-credits` 页明确公布了每个窗口的美元上限（Go 周 **$55** / 5 小时 **$18**），
 * 拿它除以接口给的 `limitCredits` 就能反推换算率。
 *
 * ## 关键事实：官方涨的是美元额度，`limitCredits` 没动
 *
 * 用账号自己的控制器密钥直连 `{walletBase}/workspaces/{id}/billing/preflight`
 * （`vela` CLI 要本机登录态，所以那条路一直 403），三个账号实测都是：
 *
 * ```
 * tier = "go"
 * 5 小时：usedCredits=4568  limitCredits=50000
 * 每周  ：usedCredits=10175 limitCredits=150000
 * ```
 *
 * `limitCredits` 与调价前完全相同。所以换算率不是 5000，而是约
 * 2727（150000/55）与 2777（50000/18）——「同一批 credits 现在值更多美元」，
 * 这与官方把额度调高是一致的。
 *
 * **这是本文件最容易被改错的地方**：如果照着「价格涨了 → credits 也按比例涨」去编夹具
 * （比如把 limitCredits 写成 275000），断言照样能通过，但记录的数据是假的，
 * 以后没人能分辨哪个是真机样本。
 *
 * 换算**逐窗口**做（`limitCredits ÷ 该窗口的官方上限`），不是全局一个比率：
 * 官方这两档的美元比（18:55）与 credits 比（1:3）并不严格成比例，用全局比率会让
 * 另一档的美元值偏 2% 左右。逐窗口算就等于「占比 × 官方上限」，永远自洽。
 */
import { describe, expect, it } from "vitest";

import { toQuotaSnapshot } from "../../src/vendors/opendesign/quota";

/**
 * **真机抓到的 preflight**（2026-11-08，Go 套餐）。
 *
 * 这不是编的夹具：`limitCredits` 50000 / 150000 与 `usedCredits` 都在真实响应里出现过。
 */
const REAL_GO = {
  codingPlan: {
    eligible: true,
    tier: "go",
    windows: [
      { durationSeconds: 18_000, usedCredits: "4568", limitCredits: "50000" },
      { durationSeconds: 604_800, usedCredits: "10175", limitCredits: "150000" },
    ],
  },
};

describe("open-design 窗口的美元换算", () => {
  it("**周窗口显示 $55**（2026-11-07 调价后 Go 的官方上限）", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly).toBeDefined();
    expect(weekly?.cap).toBe(55);
    expect(weekly?.unit).toBe("usd");
  });

  it("5 小时窗口是 $18（Go 套餐）", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const fiveHour = snap.windows.find((window) => window.key === "fiveHour");
    expect(fiveHour?.cap).toBe(18);
  });

  it("已用金额按「官方上限 ÷ limitCredits」逐窗口折算", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const fiveHour = snap.windows.find((window) => window.key === "fiveHour");
    const weekly = snap.windows.find((window) => window.key === "weekly");
    // 4568 × 18/50000 = $1.64；10175 × 55/150000 = $3.73
    expect(fiveHour?.used).toBeCloseTo(1.64, 2);
    expect(weekly?.used).toBeCloseTo(3.73, 2);
  });

  it("**占比与真实 credits 完全一致**（这才是额度条要表达的）", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const fiveHour = snap.windows.find((window) => window.key === "fiveHour");
    const weekly = snap.windows.find((window) => window.key === "weekly");
    // 真实占比：4568/50000 = 9.14%、10175/150000 = 6.78%。
    expect((fiveHour!.used! / fiveHour!.cap!) * 100).toBeCloseTo((4568 / 50000) * 100, 2);
    expect((weekly!.used! / weekly!.cap!) * 100).toBeCloseTo((10175 / 150000) * 100, 2);
  });

  it("**摘要给的 creditsPerUsd 不决定上限**（官方口径优先）", () => {
    // 接口实测给的 creditsPerUsd 是 10000，按它算周窗口只有 $15，而官方是 $55。
    // 所以上限一律采信官方表；creditsPerUsd 只在完全拿不到官方上限时当回落。
    const snap = toQuotaSnapshot({
      summary: { membershipTier: "go", creditsPerUsd: 10_000 },
      preflight: REAL_GO,
      failures: [],
    });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.cap).toBe(55);
    expect(weekly?.used).toBeCloseTo(3.73, 2);
  });

  it("套餐认不出时不反推换算率（退回百分比口径，不猜）", () => {
    const preflight = { codingPlan: { eligible: true, windows: REAL_GO.codingPlan.windows } };
    const snap = toQuotaSnapshot({ summary: undefined, preflight, failures: [] });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.cap).toBeUndefined();
    expect(weekly?.percent).toBeCloseTo((10175 / 150000) * 100, 4);
  });

  it("Plus 套餐的周窗口按官方 $74 折算（2026-11-07 调价：$40→$74）", () => {
    const preflight = {
      codingPlan: {
        eligible: true,
        tier: "plus",
        windows: [{ durationSeconds: 604_800, usedCredits: "10000", limitCredits: "200000" }],
      },
    };
    const snap = toQuotaSnapshot({ summary: undefined, preflight, failures: [] });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.cap).toBe(74);
  });
});

/**
 * ## 窗口上限也要认「Go Plus」这类档位写法（2026-11-08 修）
 *
 * 这一组盯的是一个**只在特定档位才发作**的 bug：窗口上限表（`WINDOW_CAP_USD`）的键是
 * `go` / `plus` / `pro` / `max`，而查询曾经是裸 `tier.trim().toLowerCase()`。
 * 于是 `tier` 一旦是官方列头那种写法（`Go Plus` / `Go Max`）或下划线形式（`go_plus`），
 * **整张表都查不到** —— 美元上限凭空消失，回落成「credits ÷ 接口换算率」的推算值。
 *
 * 最坏的地方是它**看起来没坏**：界面上仍有美元数字，只是数字是错的；
 * 而且同一时刻逐模型额度那条路径（一直用 `planKeyOf`）能正常显示 ——
 * 同一个档位，模型有额度、窗口却算错，非常难联想到是档位名解析不一致。
 */
describe("窗口上限的档位识别（Go Plus / go_plus / goplus 等写法）", () => {
  /** 一档一个可区分的周上限：go=$55、plus=$74、pro=$90、max=$150。 */
  const EXPECTED_WEEKLY: readonly { tier: string; weekly: number }[] = [
    { tier: "go", weekly: 55 },
    { tier: "Go", weekly: 55 },
    { tier: "plus", weekly: 74 },
    { tier: "Go Plus", weekly: 74 },
    { tier: "go_plus", weekly: 74 },
    { tier: "goplus", weekly: 74 },
    { tier: "GOPLUS", weekly: 74 },
    { tier: "Go Pro", weekly: 90 },
    { tier: "go_pro", weekly: 90 },
    { tier: "Go Max", weekly: 150 },
    { tier: "go_max", weekly: 150 },
    { tier: "gomax", weekly: 150 },
  ];

  for (const { tier, weekly } of EXPECTED_WEEKLY) {
    it(`tier=\`${tier}\` 时周上限是 $${weekly}`, () => {
      const snap = toQuotaSnapshot({
        summary: undefined,
        preflight: {
          codingPlan: {
            eligible: true,
            tier,
            windows: [{ durationSeconds: 604_800, usedCredits: 1000, limitCredits: 150_000 }],
          },
        },
        failures: [],
      });
      const weeklyWindow = snap.windows.find((w) => w.key === "weekly");
      expect(weeklyWindow?.cap).toBe(weekly);
    });
  }

  it("档位认不出时窗口仍是百分比口径（不猜成 Go）", () => {
    const snap = toQuotaSnapshot({
      summary: undefined,
      preflight: {
        codingPlan: {
          eligible: true,
          tier: "Enterprise",
          windows: [{ durationSeconds: 604_800, usedCredits: 1000, limitCredits: 150_000 }],
        },
      },
      failures: [],
    });
    const weeklyWindow = snap.windows.find((w) => w.key === "weekly");
    expect(weeklyWindow?.cap, "认不出档位就不该编一个美元上限").toBeUndefined();
    expect(weeklyWindow?.percent).toBeDefined();
  });
});
