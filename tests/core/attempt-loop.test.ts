/**
 * 共享回合循环（`runAttemptLoop`）的行为契约。
 *
 * 这段控制流原来在三个适配器里各有一份，2026-11-07 抽到 `core/attempt-loop`。
 * 抽出来以后它就是三家**唯一**的换号/换模型/失败处理实现，所以这里用假 host 把每条
 * 出口都固定住 —— 任何一次「顺手改一下循环」都会在这里留下痕迹。
 *
 * 覆盖的出口：成功、换号、已输出不换号（直接抛）、用尽（抛可重试那条）、
 * 换模型一次、跨厂商委托、用户取消、请求级拒绝、usage 延后发送、chunk 改写（DSML）。
 */
import { describe, expect, it } from "vitest";
import { LlmError } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";

import { runAttemptLoop, usageTotal, type AttemptLoopHost, type AttemptCounts } from "../../src/core/attempt-loop";
import type { AttemptFailure } from "../../src/core/attempt-ledger";
import type { FailureKind, Rejection } from "../../src/core/adapter";

/** 一条最小请求。 */
function request(model = "m1"): GenerateOptions {
  return { provider: "p", model, messages: [{ role: "user", content: [] }] } as unknown as GenerateOptions;
}

/** 一次尝试的剧本：产出哪些 chunk，或抛什么错。 */
type Script = { chunks?: StreamChunk[]; fail?: unknown };

/**
 * 假 host：把三家的差异压成「按账号给剧本」，其余全走真实循环。
 */
function harness(input: {
  order: string[];
  scripts: Record<string, Script>;
  maxTried?: number;
  aborted?: boolean;
  classify?: (error: unknown) => AttemptFailure | undefined;
  fallback?: { provider: string; model: string } | undefined;
  credentialMissing?: string[];
  deferUsage?: boolean;
  usageCountsAsEmitted?: boolean;
  onChunk?: AttemptLoopHost<unknown, string, undefined>["onChunk"];
  /** 自定义「没有可用账号」文案（用于固定提示语回归）。 */
  noAccountText?: string;
  /** 跨厂商委托时目标家交回来的流（`undefined` = 不能委托）。 */
  delegateChunks?: StreamChunk[];
}) {
  const events: string[] = [];
  const usage: { ref: string; outcome: string; kind?: string; counts: AttemptCounts }[] = [];
  const rejections: { ref: string; kind: FailureKind }[] = [];
  const settled: string[] = [];
  const promoted: string[] = [];
  let current = "m1";
  const triedSeen: string[] = [];

  const host: AttemptLoopHost<unknown, string, undefined> = {
    label: "test",
    rotation: {
      pick: ({ tried }) => {
        const next = input.order.find((ref) => !tried.has(ref));
        if (next !== undefined) triedSeen.push(next);
        return next;
      },
      markRejected: (ref, rejection: Rejection) => rejections.push({ ref, kind: rejection.kind }),
      // 与真实引擎同一条规则：已输出 / 已消耗 token / 已取消都不换号。
      fallbackAllowed: ({ emitted, totalTokens, aborted }) => !emitted && !aborted && totalTokens <= 0,
      noteSettled: (ref) => settled.push(ref),
    },
    maxTried: () => input.maxTried ?? 3,
    resolveConfig: () => ({}),
    isAbort: (error) => error instanceof Error && error.message === "aborted",
    abortError: () => new LlmError("user aborted", "ABORTED"),
    resolveCredential: async (ref) => {
      if ((input.credentialMissing ?? []).includes(ref)) return undefined;
      return `key-${ref}`;
    },
    missingCredential: (ref) => {
      rejections.push({ ref, kind: "invalid-credential" });
      return { rejection: { kind: "invalid-credential", message: `no key ${ref}` }, thrown: new Error(`no key ${ref}`) };
    },
    attempt: async function* (_config, _options, credential) {
      events.push(`attempt:${credential}`);
      const script = input.scripts[credential!] ?? {};
      for (const chunk of script.chunks ?? []) yield chunk;
      if (script.fail !== undefined) throw script.fail;
    },
    classify: (error) => (input.classify !== undefined ? input.classify(error) : { rejection: { kind: "server", message: "x" }, thrown: error }),
    recordUsage: (ref, _model, outcome, counts, kind) => usage.push({ ref, outcome, ...(kind === undefined ? {} : { kind }), counts }),
    noteSettled: (ref) => settled.push(ref),
    promoteServed: (ref) => promoted.push(ref),
    noAccount: (model) => new LlmError(input.noAccountText ?? `no account for ${model}`, "MISSING_CREDENTIAL"),
    fallbackModel: async () => input.fallback,
    delegate: () =>
      input.delegateChunks === undefined
        ? undefined
        : (async function* () {
            for (const chunk of input.delegateChunks ?? []) yield chunk;
          })(),
    ...(input.onChunk === undefined ? {} : { onChunk: input.onChunk }),
    ...(input.deferUsage === undefined ? {} : { deferUsage: input.deferUsage }),
    ...(input.usageCountsAsEmitted === undefined ? {} : { usageCountsAsEmitted: input.usageCountsAsEmitted }),
  };

  /** 收流；返回 chunk 或抛出的错误。 */
  async function run(): Promise<{ chunks: StreamChunk[]; error?: unknown }> {
    const chunks: StreamChunk[] = [];
    const options = { ...request(), ...(input.aborted === true ? { signal: { aborted: true } } : {}) } as GenerateOptions;
    try {
      for await (const chunk of runAttemptLoop(host, options)) chunks.push(chunk);
      return { chunks };
    } catch (error) {
      return { chunks, error };
    }
    finally {
      void current;
    }
  }

  return { run, events, usage, rejections, settled, promoted, triedSeen, host };
}

/** 一次成功的回复。 */
const OK: Script = {
  chunks: [
    { type: "text-delta", index: 0, text: "hi" },
    { type: "finish", reason: { kind: "stop" } },
  ],
};

describe("成功路径", () => {
  it("交给宿主的 chunk 原样透传，并记一条成功用量、标最近成功者", async () => {
    const h = harness({ order: ["a"], scripts: { "key-a": OK } });
    const { chunks, error } = await h.run();
    expect(error).toBeUndefined();
    expect(chunks.map((chunk) => chunk.type)).toEqual(["text-delta", "finish"]);
    expect(h.settled).toEqual(["a"]);
    expect(h.usage).toHaveLength(1);
    expect(h.usage[0]).toMatchObject({ ref: "a", outcome: "success" });
  });

  it("备用账号服务成功 → 报告提位", async () => {
    // a 失败换到 b；b 成功时它与「本轮首选」不同，应当被提位。
    const h = harness({
      order: ["a", "b"],
      scripts: { "key-a": { fail: new Error("boom") }, "key-b": OK },
    });
    const { error } = await h.run();
    expect(error).toBeUndefined();
    expect(h.promoted).toEqual(["b"]);
  });
});

describe("换号与闸门", () => {
  it("未输出时失败 → 换下一个账号", async () => {
    const h = harness({ order: ["a", "b"], scripts: { "key-a": { fail: new Error("boom") }, "key-b": OK } });
    const { error } = await h.run();
    expect(error).toBeUndefined();
    expect(h.triedSeen).toEqual(["a", "b"]);
    expect(h.rejections).toEqual([{ ref: "a", kind: "server" }]);
  });

  it("**已经输出过就不换号**：直接抛出这次失败（换号会重放已交付给宿主的输出）", async () => {
    const h = harness({ order: ["a", "b"], scripts: { "key-a": { chunks: [{ type: "text-delta", index: 0, text: "partial" }], fail: new Error("boom") } } });
    const { chunks, error } = await h.run();
    expect(chunks).toHaveLength(1);
    expect(String(error)).toContain("boom");
    expect(h.triedSeen, "b 不该被联系").toEqual(["a"]);
    expect(h.usage.at(-1)).toMatchObject({ outcome: "failure" });
  });

  it("请求级拒绝（分类为 undefined）→ 不换号、原样抛", async () => {
    const h = harness({ order: ["a", "b"], scripts: { "key-a": { fail: new Error("bad request") } }, classify: () => undefined });
    const { error } = await h.run();
    expect(String(error)).toContain("bad request");
    expect(h.triedSeen).toEqual(["a"]);
    expect(h.usage.at(-1)).toMatchObject({ outcome: "failure", kind: "request" });
  });
});

describe("用尽与上限", () => {
  it("**用尽时抛可重试的那一条**（真实顺序：5xx 在前、配额在后）", async () => {
    const h = harness({
      order: ["a", "b", "c"],
      maxTried: 3,
      scripts: {
        "key-a": { fail: new Error("server-down") },
        "key-b": { fail: new Error("quota-b") },
        "key-c": { fail: new Error("quota-c") },
      },
      classify: (error) => {
        const quota = String(error).includes("quota");
        return { rejection: { kind: quota ? "quota" : "server", message: String(error) }, thrown: error };
      },
    });
    const { error } = await h.run();
    expect(String(error), "抛配额会让宿主不肯重试").toContain("server-down");
  });

  it("上限按 `maxTried` 现读：到点就不再试下一个账号", async () => {
    const h = harness({
      order: ["a", "b", "c"],
      maxTried: 2,
      scripts: { "key-a": { fail: new Error("e1") }, "key-b": { fail: new Error("e2") }, "key-c": OK },
    });
    const { error } = await h.run();
    expect(String(error)).toContain("e2");
    expect(h.triedSeen).toEqual(["a", "b"]);
  });

  it("没有可用凭据的账号被记入拒绝表，并继续换下一个", async () => {
    const h = harness({ order: ["a", "b"], credentialMissing: ["a"], scripts: { "key-b": OK } });
    const { error } = await h.run();
    expect(error).toBeUndefined();
    expect(h.rejections).toEqual([{ ref: "a", kind: "invalid-credential" }]);
  });

  it("一个账号都没有 → MISSING_CREDENTIAL", async () => {
    const h = harness({ order: [], scripts: {} });
    const { error } = await h.run();
    expect((error as LlmError).code).toBe("MISSING_CREDENTIAL");
  });
});

describe("取消与换模型", () => {
  it("请求一开始就已被取消 → 抛取消错误，一个账号都不选", async () => {
    const h = harness({ order: ["a"], scripts: { "key-a": OK }, aborted: true });
    const { error } = await h.run();
    expect((error as LlmError).code).toBe("ABORTED");
    expect(h.triedSeen).toEqual([]);
  });

  it("换到同名模型后清空已试账号，再按新模型重选", async () => {
    const h = harness({
      order: ["a"],
      scripts: { "key-a": { fail: new Error("quota") } },
      fallback: { provider: "p", model: "m2" },
      classify: () => ({ rejection: { kind: "quota", message: "q" }, thrown: new Error("quota") }),
    });
    const { error } = await h.run();
    // 换模型后仍只有 a 可用、仍失败、且只换一次 → 最终抛错而不是无限循环。
    expect(error).toBeDefined();
    expect(h.triedSeen.length).toBeLessThanOrEqual(2);
  });
});

describe("跨厂商委托", () => {
  it("\u6362\u5230\u540c\u540d\u6a21\u578b\u4f46\u5c5e\u4e8e\u53e6\u4e00\u5bb6 \u2192 \u8f6c\u4ea4\u59d4\u6258\u6d41\u5e76\u7ed3\u675f\uff08\u4e0d\u518d\u81ea\u5df1\u53d1\u8bf7\u6c42\uff09", async () => {
    const h = harness({
      order: ["a"],
      scripts: { "key-a": { fail: new Error("quota") } },
      fallback: { provider: "other", model: "m2" },
      delegateChunks: [{ type: "text-delta", index: 0, text: "from-other" }],
    });
    const { chunks, error } = await h.run();
    expect(error).toBeUndefined();
    expect(chunks, "\u59d4\u6258\u5bb6\u7684 chunk \u5e94\u539f\u6837\u900f\u7ed9\u5bbf\u4e3b").toHaveLength(1);
    expect((chunks[0] as Extract<StreamChunk, { type: "text-delta" }>).text).toBe("from-other");
    expect(h.triedSeen, "\u59d4\u6258\u540e\u4e0d\u8be5\u518d\u5c1d\u8bd5\u672c\u5bb6\u8d26\u53f7").toEqual(["a"]);
  });
});

describe("用量与 chunk 处理", () => {
  it("usage 计数累加（多次 usage 累加而不是覆盖）", async () => {
    const chunks: StreamChunk[] = [
      { type: "usage", usage: { inputTokens: 3, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 4 } },
      { type: "usage", usage: { inputTokens: 7, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 9 } },
      { type: "finish", reason: { kind: "stop" } },
    ];
    const h = harness({ order: ["a"], scripts: { "key-a": { chunks } } });
    const { error } = await h.run();
    expect(error).toBeUndefined();
    expect(h.usage[0]!.counts).toMatchObject({ inputTokens: 10, outputTokens: 3 });
  });

  it("totalTokens 缺失时按分项相加", () => {
    expect(usageTotal({ inputTokens: 2, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 7 } as never)).toBe(17);
    expect(usageTotal({ inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 100 } as never)).toBe(100);
  });

  it("deferUsage：usage 延后到下一个内容块之前再发", async () => {
    const chunks: StreamChunk[] = [
      { type: "usage", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2 } },
      { type: "text-delta", index: 0, text: "x" },
      { type: "finish", reason: { kind: "stop" } },
    ];
    const h = harness({ order: ["a"], scripts: { "key-a": { chunks } }, deferUsage: true });
    const { chunks: out } = await h.run();
    expect(out.map((chunk) => chunk.type), "usage 必须在 text 之前发出").toEqual(["usage", "text-delta", "finish"]);
  });

  it("onChunk 返回的 chunk 取代原 chunk（DSML 抢救的形状）", async () => {
    const extra: StreamChunk = { type: "finish", reason: { kind: "tool-calls" } };
    const h = harness({
      order: ["a"],
      scripts: { "key-a": { chunks: [{ type: "finish", reason: { kind: "stop" } }] } },
      onChunk: (_state, chunk) => (chunk.type === "finish" ? [extra] : undefined),
    });
    const { chunks } = await h.run();
    expect(chunks).toHaveLength(1);
    expect((chunks[0] as Extract<StreamChunk, { type: "finish" }>).reason.kind).toBe("tool-calls");
  });

  it("**state.text 只收正文、不收推理**（A02：思考里的 DSML 不能算调用意图）", async () => {
    /*
     * 旧实现把 `text-delta` 与 `reasoning-delta` 一起累进 `state.text`，而 opencode
     * 的 DSML 抢救拿它整段去解析工具调用。于是模型只要在思考里推演 DSML 语法
     * （「格式大概是 `<｜DSML｜ calls>` 这样……」），那段推演就会被当成真实调用。
     *
     * 推理是模型的自言自语，不是它对宿主的指令 —— 这条用例钉住「只收正文」。
     */
    let seen = "";
    const h = harness({
      order: ["a"],
      scripts: {
        "key-a": {
          chunks: [
            { type: "reasoning-delta", index: 0, text: '<｜DSML｜ calls><｜DSML｜ invoke name="terminal_send">' },
            { type: "text-delta", index: 1, text: "正文" },
            { type: "finish", reason: { kind: "stop" } },
          ],
        },
      },
      onChunk: (state) => {
        seen = state.text;
        return undefined;
      },
    });
    await h.run();
    expect(seen, "推理里的 DSML 不得进入被扫描的文本").toBe("正文");
  });
});

describe("「没有可用账号」的提示（文案回归）", () => {
  it("**一个账号都没有**时给的是可行动的提示，不是「都不可用」", async () => {
    // 抽取循环时把两条文案合并成了一条，结果新用户（一个账号都没有）看到的是
    // 「所有账号都不可用」——那句话对没加过账号的人毫无指引。这条用例固定住。
    const h = harness({ order: [], scripts: {}, noAccountText: "请先在账号页添加账号" });
    const { error } = await h.run();
    expect((error as LlmError).code).toBe("MISSING_CREDENTIAL");
    expect(String((error as Error).message)).toContain("请先在账号页添加账号");
  });
});
