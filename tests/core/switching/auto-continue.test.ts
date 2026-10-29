/**
 * 自动继续的判定（纯函数）—— 2026-10-20 需求。
 *
 * 需求：「如果当前会话非人为停止然后出现了中断，就自动继续进行」。
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

/** 一份默认设置（总开关关 —— 与项目里其它危险开关一致）。 */
const OFF: AutoContinueSettings = { ...DEFAULT_AUTO_CONTINUE };

describe("默认值", () => {
  it("总开关默认关（重试会改变对话内容，不能默认开）", () => {
    expect(DEFAULT_AUTO_CONTINUE.enabled).toBe(false);
  });

  it("默认最多重试 3 次（防止无限重试烧钱）", () => {
    expect(DEFAULT_AUTO_CONTINUE.maxAttempts).toBe(3);
  });

  it("默认间隔 2 秒（2026-10-29 需求：每次错误重试中间间隔要 2s）", () => {
    expect(DEFAULT_AUTO_CONTINUE.intervalMs).toBe(2000);
  });
});

describe("哪些失败算「中断」（该重试）", () => {
  it("瞬时类算：网络、服务端、超时、限流", () => {
    for (const code of ["TRANSPORT", "SERVER", "TIMEOUT", "EMPTY_RESPONSE", "RATE_LIMIT", "THROTTLED"]) {
      expect(isTransientFailure(code), code).toBe(true);
    }
  });

  it("**只有四类**永远不重试：中止、上下文超长、凭据失效、额度用尽", () => {
    /**
     * 2026-10-29 改：从白名单换成黑名单。用户要求「除非手动暂停，剩下的异常中断都要
     * 自动重试三次」—— 白名单会漏掉宿主新增的或本插件没预料到的码。
     */
    for (const code of ["ABORTED", "CONTEXT_WINDOW_EXCEEDED", "INVALID_CREDENTIAL", "QUOTA"]) {
      expect(isTransientFailure(code), `${code} 应不重试`).toBe(false);
    }
  });

  it("**其余全部重试**（含以前被白名单排除的码）", () => {
    for (const code of [
      "MISSING_CREDENTIAL",
      "UNSUPPORTED_OPTION",
      "PROVIDER_HTTP_ERROR",
      "SERVER",
      "TIMEOUT",
      "TRANSPORT",
      "RATE_LIMIT",
      "EMPTY_RESPONSE",
      "THROTTLED",
    ]) {
      expect(isTransientFailure(code), `${code} 应重试`).toBe(true);
    }
  });

  it("用户主动中止**永远**不重试（那是他的意图，必须尊重）", () => {
    expect(isTransientFailure("ABORTED")).toBe(false);
  });

  it("**未知码与缺失码都重试**（新语义：宁可多试三次）", () => {
    /**
     * 与白名单时代相反：那时未知码按「不重试」处理（怕无限循环）。
     * 现在由 `maxAttempts` 封顶（默认 3），无限循环的风险不存在了，
     * 而漏掉一个真实故障的代价是用户要手动补救。
     */
    expect(isTransientFailure("SOME_NEW_CODE")).toBe(true);
    expect(isTransientFailure(undefined)).toBe(true);
  });
});

describe("重试的准入（开关 + 次数）", () => {
  it("开关关着时，即使瞬时失败也不重试", () => {
    expect(shouldRetryFailure(OFF, "TRANSPORT", 0)).toBe(false);
  });

  it("开关开着 + 瞬时失败 + 还有次数 → 重试", () => {
    expect(shouldRetryFailure({ ...OFF, enabled: true }, "TRANSPORT", 0)).toBe(true);
  });

  it("次数用尽就停手（不再无限重试）", () => {
    const on = { ...OFF, enabled: true, maxAttempts: 3 };
    expect(shouldRetryFailure(on, "TRANSPORT", 2)).toBe(true);
    expect(shouldRetryFailure(on, "TRANSPORT", 3)).toBe(false);
    expect(shouldRetryFailure(on, "TRANSPORT", 99)).toBe(false);
  });

  it("确定性失败在开关开着时也不重试", () => {
    expect(shouldRetryFailure({ ...OFF, enabled: true }, "CONTEXT_WINDOW_EXCEEDED", 0)).toBe(false);
  });
});

describe("回答被截断时是否续写", () => {
  it("开关关着时不续写", () => {
    expect(shouldContinueOnTruncate(OFF, "length", 0)).toBe(false);
  });

  it("开关开着 + finish.reason 是 length + 还有次数 → 续写", () => {
    expect(shouldContinueOnTruncate({ ...OFF, enabled: true }, "length", 0)).toBe(true);
  });

  it("正常结束（stop）不续写", () => {
    expect(shouldContinueOnTruncate({ ...OFF, enabled: true }, "stop", 0)).toBe(false);
  });

  it("工具调用结束时也不续写（那也是正常完成）", () => {
    expect(shouldContinueOnTruncate({ ...OFF, enabled: true }, "tool-call", 0)).toBe(false);
  });

  it("次数用尽就停手", () => {
    const on = { ...OFF, enabled: true, maxAttempts: 2 };
    expect(shouldContinueOnTruncate(on, "length", 1)).toBe(true);
    expect(shouldContinueOnTruncate(on, "length", 2)).toBe(false);
  });


  it("截断判定认 **max-tokens**（宿主用的）与 length（厂商字面量）", () => {
    /**
     * 宿主 `dsh-agent-loop` 内部是 `finish.kind === "max-tokens"`，本插件三家
     * 适配器也映射成 `{ kind: "max-tokens" }`。原来这里只认 `"length"` ——
     * 与实际传入的值对不上，于是「截断续写」从未触发过。
     */
    const on = { ...OFF, enabled: true };
    expect(shouldContinueOnTruncate(on, "max-tokens", 0), "宿主形态").toBe(true);
    expect(shouldContinueOnTruncate(on, "length", 0), "厂商字面量").toBe(true);
    // 正常结束与交给工具都不该续写。
    expect(shouldContinueOnTruncate(on, "stop", 0)).toBe(false);
    expect(shouldContinueOnTruncate(on, "tool-calls", 0)).toBe(false);
    expect(shouldContinueOnTruncate(on, undefined, 0)).toBe(false);
  });
});
