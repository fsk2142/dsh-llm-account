/**
 * 出站 `messages[]` 条数上限（2026-11-05 修「Open Design 1003 > 1000」）。
 *
 * ## 现场证据
 *
 * ```
 * 本轮运行失败 Open Design stream error (status 400)：
 * [code=context_length_exceeded] Input is too long: conversation history
 * exceeds the allowed input item limit (1003 > 1000 items).
 * ```
 *
 * 注意这是**条数**而不是 token：宿主只按 token 判断压缩时机（`LlmModelContext`
 * 里没有条数字段），所以这条限制永远不会被提前发现。
 *
 * ## 为什么它是死循环（本文件最重要的一条）
 *
 * 报错正文让宿主「compact and retry」，宿主也照做了。但**压缩请求本身**发的还是
 * 同一份超限历史 —— 压缩也 400，`compaction/end` 带着同一个 400，回合结束。
 * 下一轮照样 1003 条。所以「压缩之后再试」这个策略在条数超限下**不可能自愈**：
 * 必须让出站请求本身不超过上限。
 *
 * 这里最后一条测试就钉这个：`purpose: "compaction"`（压缩器的请求）也必须被裁到上限内。
 */
import { describe, expect, it } from "vitest";

import type { ContentBlock, GenerateOptions } from "@deepseek-ai/dsh-llm";

import { WireLimitExceededError, omittedHistoryNotice, trimWireMessages } from "../../src/core/wire-limit";
import { DEFAULT_MAX_REQUEST_ITEMS } from "../../src/vendors/opendesign/adapter";
import { buildRequestBody } from "../../src/vendors/opendesign/protocol";

interface Wire {
  role: string;
  content: unknown;
  tool_calls?: unknown;
  tool_call_id?: unknown;
}

/** 造 n 条 user 消息。 */
function users(count: number): Wire[] {
  return Array.from({ length: count }, (_unused, index) => ({ role: "user", content: `m${index}` }));
}

const notice = (dropped: number): Wire => ({ role: "system", content: omittedHistoryNotice(dropped) });

/** 宿主消息：n 条纯文本 user 往来。 */
function longHistory(count: number): GenerateOptions["messages"] {
  const messages: { role: "user" | "assistant"; content: ContentBlock[] }[] = [];
  for (let index = 0; index < count; index += 1) {
    messages.push({ role: index % 2 === 0 ? "user" : "assistant", content: [{ type: "text", text: `第 ${index} 条` }] });
  }
  return messages as unknown as GenerateOptions["messages"];
}

describe("wire-limit · 纯裁剪逻辑", () => {
  it("未超限时原样返回（不插入任何提示）", () => {
    const input = users(5);
    const result = trimWireMessages(input, 10, notice);
    expect(result.messages).toEqual(input);
    expect(result.dropped).toBe(0);
    expect(result.noticeInserted).toBe(false);
  });

  it("超限时裁到上限以内，并插入明确提示", () => {
    const result = trimWireMessages(users(20), 10, notice);
    expect(result.messages.length).toBeLessThanOrEqual(10);
    expect(result.noticeInserted).toBe(true);
    expect(result.dropped).toBeGreaterThan(0);
    expect(JSON.stringify(result.messages[0])).toContain("省略");
  });

  it("**保留最近的**，丢最旧的", () => {
    const result = trimWireMessages(users(20), 10, notice);
    const text = JSON.stringify(result.messages);
    expect(text, "最后一条必须在").toContain("m19");
    expect(text, "最旧的被丢").not.toContain('"m0"');
  });

  it("**工具调用与结果不可拆开**（拆开会让请求本身非法）", () => {
    // 3 组「assistant(tool_calls) + 2 条 tool + 1 条 user」= 12 条。
    // 上限取 8，配 1 格提示 → 预算 7，**必然落在某一组中间**：按单条裁就会把
    // 某次调用和它的结果拆开，这正是要防的。
    const input: Wire[] = [];
    for (let index = 0; index < 3; index += 1) {
      input.push({ role: "assistant", content: "", tool_calls: [{ id: `c${index}`, type: "function" }] });
      input.push({ role: "tool", tool_call_id: `c${index}`, content: "r0" });
      input.push({ role: "tool", tool_call_id: `c${index}`, content: "r1" });
      input.push({ role: "user", content: `u${index}` });
    }
    const result = trimWireMessages(input, 8, notice);
    expect(result.messages.length).toBeLessThanOrEqual(8);

    const kept = result.messages;
    /** 取出消息里声明的工具调用 id。 */
    const callIdsOf = (message: Wire): string[] =>
      Array.isArray(message.tool_calls)
        ? (message.tool_calls as { id?: unknown }[]).map((call) => String(call.id))
        : [];
    const keptCallIds = new Set(kept.flatMap(callIdsOf));
    const keptResultIds = new Set(
      kept.filter((message) => message.role === "tool").map((message) => String(message.tool_call_id)),
    );

    // 方向一：每条保留的 tool 结果，其发起方必须在场。
    for (const id of keptResultIds) {
      expect(keptCallIds, `tool 结果 ${id} 的发起方被丢掉了`).toContain(id);
    }
    // 方向二：每个保留的 tool_calls id，其结果必须在场（否则模型看到「调用没有结果」）。
    for (const id of keptCallIds) {
      expect(keptResultIds, `tool_calls ${id} 的结果被丢掉了`).toContain(id);
    }
    expect(keptCallIds.size, "至少留下了一整组").toBeGreaterThan(0);
  });

  it("开头的 system 段整段保留", () => {
    const input: Wire[] = [
      { role: "system", content: "身份A" },
      { role: "system", content: "身份B" },
      ...users(30),
    ];
    const result = trimWireMessages(input, 10, notice);
    const text = JSON.stringify(result.messages);
    expect(text).toContain("身份A");
    expect(text).toContain("身份B");
  });

  it("最后一条消息一定保留（那是这一轮的用户输入）", () => {
    const result = trimWireMessages(users(50), 3, notice);
    expect(JSON.stringify(result.messages.at(-1))).toContain("m49");
  });

  it("`limit` 为 0 / 负数 / undefined 时完全不裁", () => {
    for (const limit of [0, -1, undefined]) {
      const result = trimWireMessages(users(20), limit, notice);
      expect(result.messages).toHaveLength(20);
      expect(result.noticeInserted).toBe(false);
    }
  });

  it("提示文本说明「不要假设读过被省略的内容」", () => {
    expect(omittedHistoryNotice(7)).toContain("7");
    expect(omittedHistoryNotice(7)).toContain("不要假设");
  });
});

describe("F16 · `limit` 是严格不变量，绝不超发", () => {
  /** 造一组「assistant(tool_calls) + 2 条 tool」的不可拆组。 */
  function toolGroup(id: string): Wire[] {
    return [
      { role: "assistant", content: "", tool_calls: [{ id, type: "function" }] },
      { role: "tool", tool_call_id: id, content: "r0" },
      { role: "tool", tool_call_id: id, content: "r1" },
    ];
  }

  it("**system 段占满预算时不再硬塞一条**（上一版 `Math.max(1, …)` 的漏洞）", () => {
    const input: Wire[] = [{ role: "system", content: "A" }, { role: "system", content: "B" }, ...users(5)];
    // limit=2、system 已占 2 条 —— 上一版会输出 3 条（超发 1）。
    expect(() => trimWireMessages(input, 2, notice)).toThrow(WireLimitExceededError);
  });

  it("**最后一组工具调用比预算大时不再整组塞进来**", () => {
    /**
     * limit=3、system 1 条（提示并进它、不额外占位）→ 预算 2；
     * 最后一组是 3 条 tool 组，装不下 → 必须抛，而不是硬塞成 limit+1。
     */
    const input: Wire[] = [{ role: "system", content: "S" }, ...users(1), ...toolGroup("c1")];
    expect(() => trimWireMessages(input, 3, notice)).toThrow(WireLimitExceededError);
  });

  it("**提示并进第一条 system，不自造第二条**（自审发现的 BUG）", () => {
    /**
     * 原实现把提示当成独立 system 插在 system 段之后，出站是
     * `["system","system",…]`。多数网关只读开头的第一条 system，于是
     * 「不要假设你读过被省略的内容」可能被静默忽略 —— 那正是这条提示要防的事。
     */
    const input: Wire[] = [{ role: "system", content: "你是助手" }, ...users(30)];
    const result = trimWireMessages(input, 10, notice);
    const systems = result.messages.filter((message) => message.role === "system");
    expect(systems, "**只能有一条 system**").toHaveLength(1);
    expect(systems[0]?.content, "原 system 文本保留").toContain("你是助手");
    expect(systems[0]?.content, "提示并进来了").toContain("省略");
    expect(result.messages[0]?.role, "它必须在开头").toBe("system");
  });

  it("原本没有 system 时，自建一条并在开头", () => {
    const result = trimWireMessages(users(30), 10, notice);
    expect(result.messages[0]?.role).toBe("system");
    expect(result.messages[0]?.content).toContain("省略");
    expect(result.messages.filter((message) => message.role === "system")).toHaveLength(1);
  });

  it("多条 system 时只合并进第一条，其余原样保留（不乱序）", () => {
    const input: Wire[] = [
      { role: "system", content: "A" },
      { role: "system", content: "B" },
      ...users(30),
    ];
    const result = trimWireMessages(input, 12, notice);
    const systems = result.messages.filter((message) => message.role === "system");
    expect(systems).toHaveLength(2);
    expect(systems[0]?.content, "第一条带提示").toContain("省略");
    expect(systems[0]?.content).toContain("A");
    expect(systems[1]?.content, "第二条不受影响").toBe("B");
  });

  it("**所有能裁的输入分支，输出都不超过 limit**（穷举边界）", () => {
    const inputs: Wire[][] = [
      users(30),
      [{ role: "system", content: "S" }, ...users(30)],
      [...users(50), ...toolGroup("a"), ...toolGroup("b")],
      [{ role: "system", content: "S" }, { role: "system", content: "T" }, ...users(40)],
    ];
    for (const input of inputs) {
      for (const limit of [3, 5, 8, 12, 20, 50]) {
        let output: Wire[];
        try {
          output = trimWireMessages(input, limit, notice).messages;
        } catch (error: unknown) {
          // 只有「无法合法裁剪」才允许抛，别的错一律不可接受。
          expect(error).toBeInstanceOf(WireLimitExceededError);
          continue;
        }
        expect(output.length, `limit=${limit} 时不得超发`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("超发错误带上限与不可约条数，便于上层给出可行动提示", () => {
    const error = new WireLimitExceededError(10, 12);
    expect(error.limit).toBe(10);
    expect(error.irreducible).toBe(12);
    expect(error.message).toContain("10");
  });
});

describe("wire-limit · 端到端（Open Design 请求体）", () => {
  it("**1003 条历史 → 出站不超过 1000 条**（正是现场那个数字）", () => {
    const body = buildRequestBody(
      { provider: "opendesign", model: "deepseek-v4.1-flash", messages: longHistory(1003) } as unknown as GenerateOptions,
      { maxTokens: 100, systemText: "你是助手。", maxRequestItems: DEFAULT_MAX_REQUEST_ITEMS },
    ) as { messages: Wire[] };

    expect(body.messages.length, "必须被裁到上限以内").toBeLessThanOrEqual(DEFAULT_MAX_REQUEST_ITEMS);
    const text = JSON.stringify(body.messages);
    expect(text, "模型要知道历史被省略了").toContain("省略");
    // 最近的那条必须在（这是这一轮要接着说的内容）。
    expect(text).toContain("第 1002 条");
  });

  it("未超限时不插入提示（不给正常请求加噪音）", () => {
    const body = buildRequestBody(
      { provider: "opendesign", model: "m", messages: longHistory(10) } as unknown as GenerateOptions,
      { maxTokens: 100, systemText: "", maxRequestItems: DEFAULT_MAX_REQUEST_ITEMS },
    ) as { messages: Wire[] };
    expect(body.messages).toHaveLength(10);
    expect(JSON.stringify(body.messages)).not.toContain("省略");
  });

  it("**压缩器的请求也必须被裁**（否则压缩永远失败、每轮都 400）", () => {
    const body = buildRequestBody(
      {
        provider: "opendesign",
        model: "deepseek-v4.1-flash",
        purpose: "compaction",
        messages: longHistory(1003),
      } as unknown as GenerateOptions,
      { maxTokens: 100, systemText: "", maxRequestItems: DEFAULT_MAX_REQUEST_ITEMS },
    ) as { messages: Wire[] };
    expect(body.messages.length, "压缩请求自己也要能发出去").toBeLessThanOrEqual(DEFAULT_MAX_REQUEST_ITEMS);
  });

  it("没有 maxRequestItems 时保持旧行为（其它厂商/其它网关不受影响）", () => {
    const body = buildRequestBody(
      { provider: "opendesign", model: "m", messages: longHistory(1500) } as unknown as GenerateOptions,
      { maxTokens: 100, systemText: "" },
    ) as { messages: Wire[] };
    expect(body.messages).toHaveLength(1500);
  });
});
