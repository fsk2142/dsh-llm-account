/**
 * 账号试完时该抛哪一条失败（2026-11-06 修「额度已用尽」误报）。
 *
 * 真实事故：一个请求内按规则顺序连试 3 个账号 —— 第 1 个只是瞬时 5xx，
 * 第 2、3 个是被拒的 402 `insufficient_balance`。旧代码用尽时抛**最后一条**（配额），
 * 于是用户看到「本轮运行失败，当前请求的额度已用尽」，而且 `QUOTA` 在
 * `NEVER_RETRY_CODES` 里，宿主的自动继续不会重试，这一轮直接死掉。
 * 用户手动发「继续」立刻成功 —— 因为跨请求 `tried` 重置、第 1 个账号本来就没问题。
 *
 * 本文件只测**选择规则**（纯函数）：抛哪一条决定了宿主会不会救这一轮。
 */
import { describe, expect, it } from "vitest";

import { pickExhaustedFailure, rejection, type FailureKind } from "../../src/core/failures";

/** 造一条候选：只需 `rejection`，`thrown` 用 kind 当标记便于断言取到的是哪一条。 */
function attempt(kind: FailureKind): { rejection: ReturnType<typeof rejection>; thrown: string } {
  return { rejection: rejection(kind, `fail:${kind}`), thrown: `thrown:${kind}` };
}

describe("pickExhaustedFailure", () => {
  it("空链条返回 undefined（调用方负责抛「没有可用账号」）", () => {
    expect(pickExhaustedFailure([])).toBeUndefined();
  });

  it("**有可重试分类时抛它，哪怕最后一条是 quota**（2026-11-06 事故的回归）", () => {
    // 正是真实顺序：瞬时失败在前，两条配额在后。
    const picked = pickExhaustedFailure([attempt("server"), attempt("quota"), attempt("quota")]);
    expect(picked?.rejection.kind, "抛 server 才能让宿主在 2 秒后自动重试").toBe("server");
    expect(picked?.thrown).toBe("thrown:server");
  });

  it("多条可重试时取**最后**一条（最新鲜的信号）", () => {
    const picked = pickExhaustedFailure([attempt("network"), attempt("server"), attempt("quota")]);
    expect(picked?.rejection.kind).toBe("server");
  });

  it("四个可重试分类都算：server / network / rate-limit / unavailable", () => {
    for (const kind of ["server", "network", "rate-limit", "unavailable"] as const) {
      const picked = pickExhaustedFailure([attempt(kind), attempt("quota")]);
      expect(picked?.rejection.kind, kind).toBe(kind);
    }
  });

  it("全是终态时抛最后一条（换谁都一样，最后那条信息量最大）", () => {
    const picked = pickExhaustedFailure([attempt("invalid-credential"), attempt("quota")]);
    expect(picked?.rejection.kind).toBe("quota");
  });

  it("只有一条时原样返回（不论分类）", () => {
    for (const kind of ["quota", "server", "invalid-credential"] as const) {
      expect(pickExhaustedFailure([attempt(kind)])?.rejection.kind).toBe(kind);
    }
  });

  it("不改输入、不改顺序（纯函数：拒绝表与轮换顺序照旧）", () => {
    const input = [attempt("quota"), attempt("server"), attempt("quota")];
    const snapshot = input.map((item) => item.rejection.kind);
    pickExhaustedFailure(input);
    expect(input.map((item) => item.rejection.kind)).toEqual(snapshot);
  });

  it("保留原对象引用（`thrown` 携带的 cause 不能被重建）", () => {
    const first = attempt("server");
    expect(pickExhaustedFailure([first, attempt("quota")])).toBe(first);
  });
});
