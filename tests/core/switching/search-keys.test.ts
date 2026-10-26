/**
 * 搜索 key 的**多引用名列表与轮替**。
 *
 * 需求：「我添加 API KEY 后保存了，没有显示我是否已经添加，另外是否可以添加多个 key？？
 * 下拉设置中缺少一个不使用网页搜索的选项」。
 *
 * 三个需求各自的判断：
 * 1. **已添加/未添加**必须能看见 —— 现在只能填一个引用名，填完没有任何反馈。
 *    账号卡片早就有「已配置/未配置」徽标，搜索 key 却没有。
 * 2. **多 key**：一条 key 一个凭据引用名；按列表顺序依次尝试，
 *    401（无效）/402（余额不足）就换下一条，其余错误不换（换了也没用）。
 * 3. **不启用搜索**：策略里加一项 `off`。
 */
import { describe, expect, it } from "vitest";

import {
  chooseSearchRoute,
  isSearchDisabled,
  SEARCH_STRATEGIES,
} from "../../../src/core/switching/search-route";
import { isResolvableKeyRef, normalizeSearchKeyRefs, pickWorkingKey } from "../../../src/core/switching/search-keys";

describe("搜索策略：新增「不启用」", () => {
  it("策略清单里包含 off", () => {
    expect(SEARCH_STRATEGIES).toContain("off");
  });

  it("off 时任何输入都返回 unavailable（不偷偷搜）", () => {
    const both = { provider: "opendesign", model: "deepseek-v4.1-flash", hasApiKey: true, hasGateway: true };
    expect(chooseSearchRoute({ ...both, strategy: "off" })).toEqual({ kind: "unavailable" });
    expect(chooseSearchRoute({ ...both, provider: "x", hasGateway: false, strategy: "off" })).toEqual({
      kind: "unavailable",
    });
  });

  it("isSearchDisabled 只认显式的 off（缺失/其它值都算启用）", () => {
    expect(isSearchDisabled("off")).toBe(true);
    expect(isSearchDisabled("OFF")).toBe(true);
    expect(isSearchDisabled(" gateway-first ")).toBe(false);
    expect(isSearchDisabled("")).toBe(false);
    expect(isSearchDisabled(undefined)).toBe(false);
  });
});

describe("key 引用名列表的清洗", () => {
  it("去掉空串与纯空白（空引用名会解析到不存在的凭据）", () => {
    expect(normalizeSearchKeyRefs(["A", "", "  ", "B"])).toEqual(["A", "B"]);
  });

  it("去重但保留首次出现的顺序（顺序就是优先级）", () => {
    expect(normalizeSearchKeyRefs(["B", "A", "B", "A"])).toEqual(["B", "A"]);
  });

  it("去掉首尾空白（粘进来的名字常带空格）", () => {
    expect(normalizeSearchKeyRefs([" A ", "B\t"])).toEqual(["A", "B"]);
  });

  it("非字符串元素丢掉（设置文档形状不可信）", () => {
    expect(normalizeSearchKeyRefs(["A", 1, null, undefined, {}, "B"])).toEqual(["A", "B"]);
  });

  it("不是数组时返回空数组（不抛）", () => {
    expect(normalizeSearchKeyRefs(undefined)).toEqual([]);
    expect(normalizeSearchKeyRefs("A")).toEqual([]);
    expect(normalizeSearchKeyRefs({ 0: "A" })).toEqual([]);
  });

  it("引用名有形状限制（与项目其它凭据引用一致）", () => {
    expect(isResolvableKeyRef("DEEPSEEK_API_KEY")).toBe(true);
    expect(isResolvableKeyRef("DS_KEY_2")).toBe(true);
    expect(isResolvableKeyRef("")).toBe(false);
    expect(isResolvableKeyRef("has space")).toBe(false);
    expect(isResolvableKeyRef("-starts-with-dash")).toBe(false);
  });
});

describe("多 key 轮替：哪些失败该换下一条", () => {
  it("401（无效）/402（余额不足）→ 有下一条就换", () => {
    // 调用方会把「当前用的」放进 tried，所以这里拿到的是下一条。
    const tried = new Set(["a"]);
    expect(pickWorkingKey(["a", "b"], 401, tried)).toBe("b");
    expect(pickWorkingKey(["a", "b"], 402, tried)).toBe("b");
  });

  it("429（限流）/5xx → 不换（换了也一样，白折腾）", () => {
    const tried = new Set(["a"]);
    expect(pickWorkingKey(["a", "b"], 429, tried)).toBeUndefined();
    expect(pickWorkingKey(["a", "b"], 500, tried)).toBeUndefined();
    expect(pickWorkingKey(["a", "b"], 503, tried)).toBeUndefined();
  });

  it("400（参数错）→ 不换（请求本身有问题）", () => {
    expect(pickWorkingKey(["a", "b"], 400, new Set(["a"]))).toBeUndefined();
  });

  it("没有下一条时返回 undefined（调用方据此报最后的错）", () => {
    expect(pickWorkingKey(["a"], 401, new Set(["a"]))).toBeUndefined();
    expect(pickWorkingKey([], 401)).toBeUndefined();
  });

  it("跳过已经试过的引用名（不重复试同一条）", () => {
    expect(pickWorkingKey(["a", "b", "c"], 401, new Set(["a", "b"]))).toBe("c");
  });

  it("第一条就是下一个候选（tried 为空时返回第一项）", () => {
    expect(pickWorkingKey(["a", "b"], 401)).toBe("a");
  });
});
