/**
 * 自动继续的判定（纯函数）—— 2026-10-20 用户要求。
 *
 * 用户原话：「如果当前会话非人为停止然后出现了中断，就自动继续进行」。
 * 宿主的两个接缝各自负责一半（已从 `dsh-agent-loop/lib/index.js` 读到确切签名）：
 *
 * 1. `agent/request-error`（**waterfall**，payload `{turn, step, provider, failure,
 *    retryPolicy, signal}`）：监听器返回 `{ kind: 'retry' }` 且不调用 `next()` 即重试。
 * 2. `agent/turn-stopping`（**serial**，payload `{turn, signal}`）：本轮即将结束时调用；
 *    此时往 `inbox.nextStep` 推一条消息，循环就不会 `break`，本轮继续。
 *
 * 本文件只放**判定**，不碰宿主：哪些失败该重试、次数怎么管、截断要不要续写。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTO_CONTINUE,
  isTransientFailure,
  shouldContinueOnTruncate,
  shouldRetryFailure,
  type AutoContinueSettings,
} from "../../../src/core/switching/auto-continue";

/** 一份默认设置（两个开关都关 —— 与项目里其它危险开关一致）。 */
const OFF: AutoContinueSettings = { ...DEFAULT_AUTO_CONTINUE };

describe("默认值", () => {
  it("两个开关默认都关（自动续写会改变对话内容，不能默认开）", () => {
    expect(DEFAULT_AUTO_CONTINUE.onError).toBe(false);
    expect(DEFAULT_AUTO_CONTINUE.onTruncate).toBe(false);
  });

  it("默认最多重试 3 次（防止无限续写烧钱）", () => {
    expect(DEFAULT_AUTO_CONTINUE.maxAttempts).toBe(3);
  });
});

describe("哪些失败算「中断」（该重试）", () => {
  it("瞬时类算：网络、服务端、超时、限流", () => {
    for (const code of ["TRANSPORT", "SERVER", "TIMEOUT", "EMPTY_RESPONSE", "RATE_LIMIT", "THROTTLED"]) {
      expect(isTransientFailure(code), code).toBe(true);
    }
  });

  it("确定性失败不算：上下文超长、无效凭据、额度用尽、不支持选项", () => {
    // 这些重试多少次都是同样的错，只会白烧额度。
    for (const code of [
      "CONTEXT_WINDOW_EXCEEDED",
      "INVALID_CREDENTIAL",
      "MISSING_CREDENTIAL",
      "QUOTA",
      "UNSUPPORTED_OPTION",
      "PROVIDER_HTTP_ERROR",
    ]) {
      expect(isTransientFailure(code), code).toBe(false);
    }
  });

  it("用户主动中止**永远**不重试（那是他的意图，必须尊重）", () => {
    expect(isTransientFailure("ABORTED")).toBe(false);
  });

  it("未知错误码保守处理：不重试（猜它是瞬时的代价是无限循环）", () => {
    expect(isTransientFailure("SOME_NEW_CODE")).toBe(false);
    expect(isTransientFailure(undefined)).toBe(false);
  });
});

describe("重试的准入（开关 + 次数）", () => {
  it("开关关着时，即使瞬时失败也不重试", () => {
    expect(shouldRetryFailure(OFF, "TRANSPORT", 0)).toBe(false);
  });

  it("开关开着 + 瞬时失败 + 还有次数 → 重试", () => {
    expect(shouldRetryFailure({ ...OFF, onError: true }, "TRANSPORT", 0)).toBe(true);
  });

  it("次数用尽就停手（不再无限重试）", () => {
    const on = { ...OFF, onError: true, maxAttempts: 3 };
    expect(shouldRetryFailure(on, "TRANSPORT", 2)).toBe(true);
    expect(shouldRetryFailure(on, "TRANSPORT", 3)).toBe(false);
    expect(shouldRetryFailure(on, "TRANSPORT", 99)).toBe(false);
  });

  it("确定性失败在开关开着时也不重试", () => {
    expect(shouldRetryFailure({ ...OFF, onError: true }, "CONTEXT_WINDOW_EXCEEDED", 0)).toBe(false);
  });
});

describe("回答被截断时是否续写", () => {
  it("开关关着时不续写", () => {
    expect(shouldContinueOnTruncate(OFF, "length", 0)).toBe(false);
  });

  it("开关开着 + finish.reason 是 length + 还有次数 → 续写", () => {
    expect(shouldContinueOnTruncate({ ...OFF, onTruncate: true }, "length", 0)).toBe(true);
  });

  it("正常结束（stop）不续写", () => {
    expect(shouldContinueOnTruncate({ ...OFF, onTruncate: true }, "stop", 0)).toBe(false);
  });

  it("工具调用结束时也不续写（那也是正常完成）", () => {
    expect(shouldContinueOnTruncate({ ...OFF, onTruncate: true }, "tool-call", 0)).toBe(false);
  });

  it("次数用尽就停手", () => {
    const on = { ...OFF, onTruncate: true, maxAttempts: 2 };
    expect(shouldContinueOnTruncate(on, "length", 1)).toBe(true);
    expect(shouldContinueOnTruncate(on, "length", 2)).toBe(false);
  });
});
