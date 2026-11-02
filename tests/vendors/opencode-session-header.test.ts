import { describe, expect, it } from "vitest";

import { OPENCODE_SESSION_HEADER, opencodeSessionHeaders } from "../../src/vendors/opencode/session";

/**
 * 真机报障回归（2026-11-02）：
 *
 * ```
 * 400: {"type":"MissingSessionID",
 *       "message":"Request is missing x-opencode-session and cannot be routed efficiently."}
 * ```
 *
 * 官方文档「Where can I use it?」要求客户端在 `x-opencode-session` 里为每个会话
 * 发**稳定**的 ID。缺这个头网关直接 400，请求到不了模型。
 */
describe("opencode 会话头", () => {
  it("用宿主的会话 id（同一会话必须得到同一个值）", () => {
    const a = opencodeSessionHeaders("session-abc-123");
    const b = opencodeSessionHeaders("session-abc-123");
    expect(a[OPENCODE_SESSION_HEADER]).toBe("session-abc-123");
    expect(b[OPENCODE_SESSION_HEADER], "同一会话重复调用必须稳定").toBe(a[OPENCODE_SESSION_HEADER]);
  });

  it("不同会话得到不同的值（不能让所有会话共用一个 id）", () => {
    const one = opencodeSessionHeaders("session-a")[OPENCODE_SESSION_HEADER];
    const two = opencodeSessionHeaders("session-b")[OPENCODE_SESSION_HEADER];
    expect(one).not.toBe(two);
  });

  it("**会话 id 缺失时退回进程级稳定 id**（不能每次现生成）", () => {
    /**
     * 辅助调用（标题生成、compaction）可能没有会话 id。此时若每次都生成新的，
     * 会破坏网关的路由与 prompt caching —— 所以必须是同一个常量。
     */
    const a = opencodeSessionHeaders(undefined)[OPENCODE_SESSION_HEADER];
    const b = opencodeSessionHeaders()[OPENCODE_SESSION_HEADER];
    const c = opencodeSessionHeaders("")[OPENCODE_SESSION_HEADER];
    expect(a, "缺省两次必须一致").toBe(b);
    expect(b).toBe(c);
    expect(a, "兜底值不能为空").toBeTruthy();
  });

  it("清洗非法字符（HTTP 头不能含空格/控制字符）", () => {
    const v = opencodeSessionHeaders("session with spaces\nand-newline")[OPENCODE_SESSION_HEADER];
    expect(v).not.toMatch(/[\s\n]/u);
    expect(v).toBe("sessionwithspacesand-newline");
  });

  it("清洗后为空 → 退回兜底 id（不能发出空头）", () => {
    const fallback = opencodeSessionHeaders()[OPENCODE_SESSION_HEADER];
    const fromGarbage = opencodeSessionHeaders("///   ///")[OPENCODE_SESSION_HEADER];
    expect(fromGarbage, "全非法字符时用兜底").toBe(fallback);
  });

  it("头名与文档一致", () => {
    expect(OPENCODE_SESSION_HEADER).toBe("x-opencode-session");
  });

  it("返回的是可直接 merge 进 headers 的对象", () => {
    const merged: Record<string, string> = { accept: "application/json", ...opencodeSessionHeaders("s1") };
    expect(merged[OPENCODE_SESSION_HEADER]).toBe("s1");
    expect(merged.accept).toBe("application/json");
  });
});

/** 请求路径覆盖：三条出网路径都必须带这个头。 */
describe("三条出网路径都带会话头", () => {
  it("额度请求带上会话头", async () => {
    /**
     * 直接调生产函数 `readOpencodeUsage` 需要一整套依赖；这里用它的**头部构造契约**：
     * quota.ts 里合并了 `opencodeSessionHeaders()`。用静态断言锁住接线，
     * 避免「改了模块但忘了接进请求」这类回归。
     */
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../src/vendors/opencode/quota.ts", import.meta.url), "utf8"),
    );
    expect(source, "额度请求必须带会话头").toContain("opencodeSessionHeaders()");
  });

  it("目录请求带上会话头", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../src/vendors/opencode/protocol.ts", import.meta.url), "utf8"),
    );
    expect(source, "目录请求必须带会话头").toContain("opencodeSessionHeaders()");
  });

  it("推理请求用**会话 id**（不是兜底值）", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../src/vendors/opencode/adapter.ts", import.meta.url), "utf8"),
    );
    expect(source, "推理路径必须把宿主 sessionId 传进去").toContain(
      "opencodeSessionHeaders(options.sessionId)",
    );
  });
});
