/**
 * `Open Design stream error (status 400)` 要说出真实原因。
 *
 * ## 为什么报错里没有原因
 *
 * 400 是「请求本身被拒」（上下文超限 / 参数错 / 该模型不支持某个字段）。这类失败**不换账号**
 * —— 换号不会改变结果 —— 所以 `classifyOpenDesignFailure` 返回 `undefined`，适配器把原始
 * `OpenDesignStreamFailure` 直接抛给宿主。
 *
 * 但那条异常的消息只有状态码：`Open Design stream error (status 400)`。而真实原因**早就被
 * 读出来了**（`readErrorBody` → `body`），只是从来没人把它转成人话。用户只能拿一个「400」去猜。
 *
 * 本文件钉住：正文里的原因会被提取进消息，且提取是**保守**的（认不出就不编）。
 */
import { describe, expect, it } from "vitest";

import { errorReasonOf, OpenDesignStreamFailure } from "../../src/vendors/opendesign/protocol";

describe("errorReasonOf：从错误正文里抽原因", () => {
  it("OpenAI/Anthropic 系：`{ error: { message } }`", () => {
    expect(
      errorReasonOf({ error: { message: "This model's maximum context length is 163840 tokens", type: "invalid_request_error" } }),
    ).toContain("maximum context length");
  });

  it("扁平形状：`{ message }`", () => {
    expect(errorReasonOf({ message: "max_tokens is too large" })).toBe("max_tokens is too large");
  });

  it("纯文本正文（网关直接回一段话）", () => {
    expect(errorReasonOf("upstream rejected: unsupported image input")).toBe("upstream rejected: unsupported image input");
  });

  it("只有 type 没有 message 时退而给 type（比什么都没有强）", () => {
    expect(errorReasonOf({ error: { type: "invalid_request_error" } })).toBe("invalid_request_error");
  });

  it("完全不认识的形状 → 给截断的 JSON（仍然比只有状态码有用）", () => {
    expect(errorReasonOf({ code: 400, detail: { reason: "bad" } })).toContain("bad");
  });

  it("**空/无正文 → undefined**（不编造原因）", () => {
    expect(errorReasonOf(undefined)).toBeUndefined();
    expect(errorReasonOf(null)).toBeUndefined();
    expect(errorReasonOf("")).toBeUndefined();
    expect(errorReasonOf("   ")).toBeUndefined();
    expect(errorReasonOf({})).toBeUndefined();
    expect(errorReasonOf({ message: "   " })).toBeUndefined();
  });

  it("超长正文被截断（避免整段 HTML 错误页糊到界面上）", () => {
    const reason = errorReasonOf({ message: "x".repeat(2000) });
    expect(reason).toBeDefined();
    expect(reason!.length).toBeLessThan(400);
    expect(reason!.endsWith("…")).toBe(true);
  });
});

describe("OpenDesignStreamFailure：消息带上原因", () => {
  it("有正文原因时，消息里有状态码**和**原因", () => {
    const error = new OpenDesignStreamFailure(400, {
      error: { message: "context length exceeded: requested 1417839 tokens" },
    });
    expect(error.message).toContain("status 400");
    expect(error.message).toContain("context length exceeded");
    // 分类仍要能拿到原始证据（body/status 不受消息改动影响）。
    expect(error.status).toBe(400);
    expect(error.body).toBeDefined();
  });

  it("没有正文原因时，消息保持原样（不出现空冒号）", () => {
    const error = new OpenDesignStreamFailure(400, undefined);
    expect(error.message).toBe("Open Design stream error (status 400)");
    expect(error.message.endsWith("：")).toBe(false);
  });

  it("流中途事件（status 0）同样带原因", () => {
    const error = new OpenDesignStreamFailure(0, { message: "overloaded" });
    expect(error.message).toContain("status 0");
    expect(error.message).toContain("overloaded");
  });
});
