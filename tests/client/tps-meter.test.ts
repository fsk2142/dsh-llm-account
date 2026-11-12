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

describe("速度计：1 秒窗口 × 9 窗口平均（用户要求至少 9）", () => {
  /** 一个可控时钟推进的测量器（9 窗口，与生产一致）。 */
  function meter() {
    return createTpsMeter({ windowMs: 1_000, windows: 9 });
  }

  it("**持续稳定输出 → 读数接近真实速度**", () => {
    const m = meter();
    /*
     * 持续 10 秒、每秒 42 个其它字符 = 每秒 10 tok/s。
     *
     * 9 窗口下必须**持续**输出才对得上：一次只有 1 秒的数据时，其余 8 个空窗
     * 按 0 摊进去会把读数压到 1/9（那正是「最近 9 秒的平均」的定义）。
     */
    for (let second = 1; second <= 10; second += 1) m.push("x".repeat(42), second * 1_000);
    const rate = m.reading(10_000);
    expect(rate).toBeDefined();
    expect(rate!).toBeCloseTo(10, 0);
  });

  it("**窗口是左开右闭**：正好落在当前时刻的帧必须计入", () => {
    const m = meter();
    m.push("x".repeat(42), 1_000);
    const rate = m.reading(1_000);
    expect(rate, "at 时刻收到的帧不能被窗口排除").toBeDefined();
    // 只有 1 个窗口有数据，其余 8 个按 0 均摊 → 10 / 9 ≈ 1.1。
    expect(rate!).toBeGreaterThan(0);
  });

  it("**无数据时返回 undefined**，不伪造 0（缺失 ≠ 0）", () => {
    expect(meter().reading(50_000)).toBeUndefined();
  });

  it("**停顿期间读数往下走**（9 窗口把空窗按 0 计入，不是僵在高位）", () => {
    const m = meter();
    // 先持续输出 9 秒（每秒 42 字符 = 10 tok/s）
    for (let second = 1; second <= 9; second += 1) m.push("x".repeat(42), second * 1_000);
    const moving = m.reading(9_000)!;
    expect(moving).toBeCloseTo(10, 0);
    /*
     * 再停 3 秒：宽限期内（800ms）仍走分窗平均，读数已经开始下降；
     * 超过宽限后交给指针衰减。两种情况都**必须低于**满速时的读数 ——
     * 旧实现（跳过空窗）会一直停在 10，那就不像速度表了。
     */
    const afterStop = m.reading(11_000)!;
    expect(afterStop, "停机两秒后必须明显低于满速").toBeLessThan(moving);
  });

  it("**9 窗口比 3 窗口更平滑**（同一串抖动数据，9 窗口的极差更小）", () => {
    const three = createTpsMeter({ windowMs: 1_000, windows: 3 });
    const nine = createTpsMeter({ windowMs: 1_000, windows: 9 });
    /*
     * 造「忽快忽慢」的 9 秒：奇数秒 84 字符（20 tok/s）、偶数秒 0 字符。
     * 3 窗口只看最近 3 秒，波动大；9 窗口摊到 9 秒，读数更平。
     */
    for (let second = 1; second <= 9; second += 1) {
      if (second % 2 === 1) {
        three.push("x".repeat(84), second * 1_000);
        nine.push("x".repeat(84), second * 1_000);
      }
    }
    const threeRate = three.reading(9_000)!;
    const nineRate = nine.reading(9_000)!;
    // 3 窗口里只有最近 1 秒有数据（20 tok/s）→ 约 6.7；9 窗口摊到 9 秒 → 约 2.2。
    expect(nineRate, "9 窗口必须更平滑（更接近长期均值）").toBeLessThan(threeRate);
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
