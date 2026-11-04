import { describe, expect, it } from "vitest";

import { applyAutoContinue, CONTINUE_PROMPT, type AutoContinueProbe } from "../../src/vendors/auto-continue";

/**
 * 截断后的自动续写必须真正接到宿主（2026-11-04 外部审查 U14）。
 *
 * ## 审查原文
 *
 * > 生产只传 ctx 和 settings，无 probe；实现仅有 probe 才注册 agent/turn-stopping。
 * > 总开关打开也无法走截断续写分支。
 *
 * ## 顺带修掉的两个**接口形状错误**
 *
 * 原来的 probe 是 `inbox: { append(message) }`，但宿主真实 API 是
 * （从 `app.asar` 的类型声明核实，不是猜的）：
 *
 * ```ts
 * type InboxTarget = 'next-turn' | 'next-step';
 * interface Inbox {
 *   readonly nextStep: readonly UserMessage[];   // 只读数组，不是带 append 的对象
 *   append(target: InboxTarget, message: UserMessage): void;
 * }
 * ```
 *
 * 所以原来的写法有两个运行时问题：`nextStep` 上没有 `append`；`append` 少一个参数。
 * 这条测试盯的就是「调用形状必须与宿主一致」。
 */
/** 造一个最小的宿主事件总线。 */
function hostOf(): {
  fire(event: string, ...args: unknown[]): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => unknown): unknown;
} {
  const listeners = new Map<string, ((...args: unknown[]) => unknown)[]>();
  return {
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return () => {};
    },
    async fire(event, ...args) {
      for (const listener of listeners.get(event) ?? []) await listener(...args);
    },
  };
}

/** 记录 append 调用，形状与宿主 `Inbox` 一致。 */
function inboxOf(): { calls: [string, unknown][]; append(target: string, message: unknown): void } {
  const calls: [string, unknown][] = [];
  return {
    calls,
    append(target: string, message: unknown) {
      calls.push([target, message]);
    },
  };
}

const SETTINGS = {
  enabled: true,
  maxAttempts: 3,
  intervalMs: 0,
};

describe("U14 · 截断后续写接到宿主", () => {
  it("**没有 probe 时不注册续写监听**（这是被修的那个缺口）", async () => {
    const host = hostOf();
    applyAutoContinue(host as never, () => SETTINGS);
    const inbox = inboxOf();
    // 没有 probe：即使触发 turn-stopping，也不该有任何续写动作。
    await host.fire("agent/turn-stopping", { turn: 1 });
    expect(inbox.calls, "没有 probe 就没有续写入口").toHaveLength(0);
  });

  it("**有 probe 且被截断（max-tokens）→ 往 next-step 追加一条续写消息**", async () => {
    const host = hostOf();
    const inbox = inboxOf();
    const probe: AutoContinueProbe = {
      inbox: inbox as never,
      lastFinishReason: () => "max-tokens",
    };
    applyAutoContinue(host as never, () => SETTINGS, probe);

    await host.fire("agent/turn-stopping", { turn: 1 });

    expect(inbox.calls, "必须真的往 inbox 推了一条").toHaveLength(1);
    expect(inbox.calls[0]![0], "target 必须是宿主的 'next-step' 字面量").toBe("next-step");
    expect(
      (inbox.calls[0]![1] as { content?: readonly { type: string; text: string }[] }).content,
      "推的消息内容就是续写指令",
    ).toEqual([{ type: "text", text: CONTINUE_PROMPT }]);
  });

  it("**正常结束（stop）不续写**", async () => {
    const host = hostOf();
    const inbox = inboxOf();
    applyAutoContinue(
      host as never,
      () => SETTINGS,
      { inbox: inbox as never, lastFinishReason: () => "stop" },
    );

    await host.fire("agent/turn-stopping", { turn: 1 });
    expect(inbox.calls, "正常结束绝不能续写").toHaveLength(0);
  });

  it("**工具调用（tool-calls）不续写**", async () => {
    const host = hostOf();
    const inbox = inboxOf();
    applyAutoContinue(
      host as never,
      () => SETTINGS,
      { inbox: inbox as never, lastFinishReason: () => "tool-calls" },
    );

    await host.fire("agent/turn-stopping", { turn: 1 });
    expect(inbox.calls, "交给工具是正常流程，不该续写").toHaveLength(0);
  });

  it("开关关着时即使被截断也不续写", async () => {
    const host = hostOf();
    const inbox = inboxOf();
    applyAutoContinue(
      host as never,
      () => ({ ...SETTINGS, enabled: false }),
      { inbox: inbox as never, lastFinishReason: () => "max-tokens" },
    );

    await host.fire("agent/turn-stopping", { turn: 1 });
    expect(inbox.calls).toHaveLength(0);
  });

  it("次数用尽后不再续写（同一轮）", async () => {
    const host = hostOf();
    const inbox = inboxOf();
    applyAutoContinue(
      host as never,
      () => ({ ...SETTINGS, maxAttempts: 2 }),
      { inbox: inbox as never, lastFinishReason: () => "max-tokens" },
    );

    await host.fire("agent/turn-stopping", { turn: 7 });
    await host.fire("agent/turn-stopping", { turn: 7 });
    expect(inbox.calls, "前两次续写").toHaveLength(2);

    await host.fire("agent/turn-stopping", { turn: 7 });
    expect(inbox.calls, "达到上限就不再续写").toHaveLength(2);
  });

  it("**`length` 也认**（厂商字面量，防止探针换了写法就静默失效）", async () => {
    const host = hostOf();
    const inbox = inboxOf();
    applyAutoContinue(
      host as never,
      () => SETTINGS,
      { inbox: inbox as never, lastFinishReason: () => "length" },
    );

    await host.fire("agent/turn-stopping", { turn: 1 });
    expect(inbox.calls, "两种写法都要认").toHaveLength(1);
  });
});

describe("U14 · max-tokens 粘住场景不能多余续写", () => {
  /**
   * 宿主的 `turnEnds` **会粘住**（从 `app.asar` 解出的真实循环）：
   *
   * ```js
   * if (turnEnds === null || turnEnds.kind !== 'max-tokens') turnEnds = stepEnd;
   * ```
   *
   * 一旦是 `max-tokens` 就不再更新 —— 于是**即使下一步正常收尾**，宿主仍会调用
   * `agent/turn-stopping`。若我们盲目 append，就会「已经答完了还继续答」。
   *
   * 我们的防线是 `lastFinishReason` **每次现读**最新值：
   * 第二步是 `stop` → 判定 false → 不 append → inbox 为空 → 宿主正常 break。
   */
  it("第一次 max-tokens 续写后，第二次是 stop → 不再续写", async () => {
    const host = hostOf();
    const inbox = inboxOf();
    /** 模拟「finish.kind 随每步变化」。 */
    let finish = "max-tokens";
    applyAutoContinue(
      host as never,
      () => SETTINGS,
      { inbox: inbox as never, lastFinishReason: () => finish },
    );

    // 第一步：被截断 → 应当续写一次。
    await host.fire("agent/turn-stopping", { turn: 1 });
    expect(inbox.calls, "第一次截断要续写").toHaveLength(1);

    // 续写后模型正常收尾。
    finish = "stop";

    // 宿主因为 turnEnds 粘着 max-tokens，**仍会**再调一次 turn-stopping。
    await host.fire("agent/turn-stopping", { turn: 1 });
    expect(inbox.calls, "已经正常收尾，不能再多续一次").toHaveLength(1);
  });
});

describe("U14 补遗 · 多会话不能串 inbox", () => {
  /**
   * `agent/turn-stopping` 的 payload **只有 `{ turn, signal }`**，不带 agent。
   * 若实现用「全局最近一次见到的 agent」定位 inbox，多会话并发时 A 的 pre-step
   * 会覆盖 B 的缓存 —— B 收尾时续写消息就推进了 A 的会话。
   *
   * 生产实现因此优先用宿主 `agents.currentInitiator()`（当前执行上下文的 agent），
   * 缓存只作兜底。这条测试在 probe 层锁住「每次取的是当前 run 的 inbox」这一契约：
   * 同一个 probe，两次触发时若 `agentOfCurrentRun` 换了对象，就必须写到新的那个。
   */
  it("probe 的 inbox 每次访问都现取（不是首次快照）", async () => {
    const host = hostOf();
    let currentInbox = inboxOf();
    const seen: string[] = [];

    const probe: AutoContinueProbe = {
      get inbox() {
        // 模拟「当前 run 的 agent 换了」：getter 每次读到新的。
        seen.push("read");
        return currentInbox as never;
      },
      lastFinishReason: () => "max-tokens",
    };

    applyAutoContinue(host as never, () => ({ ...SETTINGS, maxAttempts: 5 }), probe);

    await host.fire("agent/turn-stopping", { turn: 1 });
    expect(currentInbox.calls, "第一次写到当时的 inbox").toHaveLength(1);

    // 换到另一个会话的 inbox（模拟 currentInitiator 变了）。
    currentInbox = inboxOf();
    await host.fire("agent/turn-stopping", { turn: 1 });

    expect(currentInbox.calls, "第二次必须写到**新的**那个 inbox").toHaveLength(1);
    expect(seen.length, "getter 必须每次访问都执行（不是首次快照）").toBe(2);
  });
});
