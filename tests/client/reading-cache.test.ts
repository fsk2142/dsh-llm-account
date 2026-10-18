/**
 * `ReadingCache`：读数缓存的新鲜期边界。
 *
 * 这是「打开设置不总是重新获取」对策的底座 —— TTL 的边界（恰好到期算新鲜、超出一毫秒
 * 就不算）必须钉死，否则与侧边栏 60 秒轮询对齐的节奏会悄悄漂移。时钟注入让边界用假时间
 * 验证，而不是靠真实时钟跑 60 秒。
 */
import { describe, expect, it } from "vitest";

import { ReadingCache } from "../../src/client/reading-cache";

describe("ReadingCache", () => {
  it("新鲜期内命中；恰好到期仍算新鲜，超过一毫秒即失效", () => {
    let now = 1_000;
    const cache = new ReadingCache<string>(60_000, () => now);
    cache.put("commandcode", "reading");

    now = 1_000;
    expect(cache.get("commandcode")).toBe("reading");
    now = 1_000 + 59_999;
    expect(cache.get("commandcode")).toBe("reading");
    // 边界取闭区间：age === ttl 仍新鲜（与侧边栏 60 秒轮询严格对齐）。
    now = 1_000 + 60_000;
    expect(cache.get("commandcode")).toBe("reading");
    now = 1_000 + 60_001;
    expect(cache.get("commandcode")).toBeUndefined();
  });

  it("每个键各自计时；put 覆盖同键并从新时刻重新计时", () => {
    let now = 0;
    const cache = new ReadingCache<number>(100, () => now);
    cache.put("a", 1);
    now = 80;
    cache.put("b", 2);
    now = 150;
    // a 已过期（150 > 100），b 还新鲜（150 - 80 = 70）。
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);

    now = 200;
    cache.put("a", 3); // 覆盖旧值：从 200 重新计时，而不是沿用第一次的 0。
    now = 250;
    expect(cache.get("a")).toBe(3);
  });

  it("ttl 为 0 时只在同一毫秒内命中（调用方按「每次重读」降级）", () => {
    let now = 0;
    const cache = new ReadingCache<string>(0, () => now);
    cache.put("a", "v");
    expect(cache.get("a")).toBe("v");
    now += 1;
    expect(cache.get("a")).toBeUndefined();
  });

  it("clear 之后全部失效（宿主侧失效信号与测试隔离都走它）", () => {
    let now = 0;
    const cache = new ReadingCache<string>(1_000, () => now);
    cache.put("a", "x");
    cache.put("b", "y");
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});
