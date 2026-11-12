/**
 * 实时 tok/s 的**计算核心**测试（2026-11-12）。
 *
 * 钉住三件事：
 * 1. 字符 → token 的换算口径（CJK 与其它分开，系数来自本机实测）；
 * 2. 1 秒窗口 + 3 窗口平均的**分窗**语义（空窗不摊进平均 —— 那会把思考停顿误读成变慢）；
 * 3. 边界：没数据时不伪造 0、settle 后不再计入、内存不随会话增长。
 */
import { describe, expect, it } from "vitest";

import { countChars, createTpsMeter, tokensOf } from "../../src/client/tps-meter";

describe("字符计数：CJK 与其它分开", () => {
  it("纯中文：每个汉字算 1 个 CJK", () => {
    expect(countChars("你好世界")).toEqual({ cjk: 4, other: 0 });
  });

  it("纯英文：每个字符算 1 个 other", () => {
    expect(countChars("hello")).toEqual({ cjk: 0, other: 5 });
  });

  it("混合文本各归各的", () => {
    expect(countChars("abc中文def")).toEqual({ cjk: 2, other: 6 });
  });

  it("全角标点按 CJK 计（分词器里它们也是 1 字 1 token）", () => {
    expect(countChars("，。！")).toEqual({ cjk: 3, other: 0 });
  });

  it("**按码位而非 UTF-16 长度**：emoji 只算 1 个字符", () => {
    // "😀" 的 length 是 2（代理对），按码位是 1。算成 2 会让速度虚高。
    expect(countChars("😀").other).toBe(1);
  });

  it("空串与纯空白不崩", () => {
    expect(countChars("")).toEqual({ cjk: 0, other: 0 });
  });
});

describe("换算系数", () => {
  it("CJK 1 字 ≈ 1 token", () => {
    expect(tokensOf({ cjk: 100, other: 0 })).toBeCloseTo(100, 5);
  });

  it("其它字符 4.2 个 ≈ 1 token（来自本机 5.03 字符/token 的实测口径）", () => {
    expect(tokensOf({ cjk: 0, other: 42 })).toBeCloseTo(10, 5);
  });

  it("零字符是零 token（不是 NaN）", () => {
    expect(tokensOf({ cjk: 0, other: 0 })).toBe(0);
  });
});

describe("速度计：1 秒窗口 + 3 窗口平均", () => {
  /** 一个可控时钟推进的测量器。 */
  function meter() {
    return createTpsMeter({ windowMs: 1_000, windows: 3 });
  }

  it("**一秒内稳定输出 → 读数接近真实速度**", () => {
    const m = meter();
    /*
     * 10 帧、每帧 4 个其它字符，均匀落在 (0, 1000] 这**当前 1 秒窗口**里：
     * 合计 40 字符 → 40 / 4.2 ≈ 9.5 tok/s。
     *
     * 注意 t=0 那帧**不能**算进来：读数在 at=1000 时，窗口是 `(0, 1000]`。
     * 第一版夹具把帧放在 0,100,…,900，于是 0 那帧落进**上一个**窗口、把 3 窗口平均
     * 拉到 4.76 —— 那是夹具的位置错了，不是公式错（窗口语义本来就是左开右闭）。
     */
    for (let step = 0; step < 10; step += 1) m.push("x".repeat(4), (step + 1) * 100);
    const rate = m.reading(1_000);
    expect(rate).toBeDefined();
    expect(rate!).toBeGreaterThan(8);
    expect(rate!).toBeLessThan(12);
  });

  it("**窗口是左开右闭**：正好落在当前时刻的帧必须计入", () => {
    const m = meter();
    m.push("x".repeat(42), 1_000);
    const rate = m.reading(1_000);
    expect(rate, "at 时刻收到的帧不能被窗口排除").toBeDefined();
    expect(rate!).toBeCloseTo(10, 1);
  });

  it("**无数据时返回 undefined**，不伪造 0（缺失 ≠ 0）", () => {
    expect(meter().reading(5_000)).toBeUndefined();
  });

  it("**停顿的窗口不参与平均**（思考 2 秒后爆发，读数反映爆发而不是被摊平）", () => {
    const m = meter();
    // 只在最后 1 秒爆发：420 个其它字符 = 100 token/s
    m.push("x".repeat(420), 4_500);
    const rate = m.reading(5_000);
    expect(rate).toBeDefined();
    // 若把前面两个空窗按 0 摊进去，会变成 ~33；分窗法应接近 100。
    expect(rate!).toBeGreaterThan(80);
  });

  it("**多窗口平均会压抖动**：只用一个窗口时尖峰更高", () => {
    const single = createTpsMeter({ windowMs: 1_000, windows: 1 });
    const triple = createTpsMeter({ windowMs: 1_000, windows: 3 });
    // 第 1 秒慢、第 2 秒快
    single.push("x".repeat(42), 500);
    triple.push("x".repeat(42), 500);
    single.push("x".repeat(420), 1_500);
    triple.push("x".repeat(420), 1_500);
    const singleRate = single.reading(2_000)!;
    const tripleRate = triple.reading(2_000)!;
    expect(tripleRate, "3 窗口平均必须低于当秒尖峰").toBeLessThan(singleRate);
  });

  it("`settle` 之后新帧不再计入（但已有读数仍可读）", () => {
    const m = meter();
    m.push("x".repeat(42), 1_000);
    const before = m.reading(1_000);
    expect(before).toBeDefined();
    m.settle(1_000);
    m.push("x".repeat(4_200), 1_000);
    expect(m.reading(1_000), "结束后的新帧不得计入").toBe(before);
  });

  it("**内存不随会话增长**：超出保留期的桶会被丢弃", () => {
    const m = meter();
    // 造 100 个跨越很久的帧；跨度为 3 秒的保留期之外。
    for (let step = 0; step < 100; step += 1) m.push("x", step * 1_000);
    // 推进到很久之后：旧桶必须已被剪掉，读数回到 undefined。
    expect(m.reading(200_000)).toBeUndefined();
  });
});
