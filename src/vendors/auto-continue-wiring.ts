/**
 * **自动继续的共享接线**（2026-11-12 审查 A03 后续）。
 *
 * ## 为什么需要这个模块
 *
 * `applyAutoContinue`（判定 + 宿主两个接缝）原本**只有 commandcode 接了**。
 * opendesign / opencode 两家连调用都没有 —— 于是「自动继续」这个开关在那两家上
 * 从来不会生效，而界面上它是可见的。
 *
 * 接线本身有 4 个部分，三份复制必然漂移（这个仓库已经因此吃过亏）：
 *
 * 1. `agent/pre-step` —— 修补旧版续写消息（`repairLegacyContinueMessages`）；
 * 2. `session/event` —— 按 session 记下 `assistant/message` 的 turn 与 **finish**；
 * 3. `agentOfCurrentRun()` —— 只允许**当前执行作用域**选 inbox；
 * 4. `applyAutoContinue(ctx, settings, probe)` —— 把上面三样接进去。
 *
 * 所以抽成这一份，三家各调一次。
 *
 * ## 三家各调一次会不会重复注册
 *
 * 会 —— 但**这是既有设计**，不是本模块引入的问题：`cordis` 的 profile 行各在自己的
 * 作用域里 apply，`applyAutoContinue` 注册的事件也跟着那个作用域走。
 * 真正需要避免的是「**同一个作用域**里注册两份」，而三家的 `apply` 各在自己的行里跑，
 * 天然不重叠。
 *
 * 反过来说：**如果用户只装了其中一家**，那也只有那一家会接线 —— 这正是要修的
 * 「另两家开关失效」问题的另一半。
 *
 * @module dsh-llm-account/src/vendors/auto-continue-wiring
 */

import type { AssistantStreamRecord } from "@deepseek-ai/dsh-llm";
import { lastAssistantStreamChunk } from "@deepseek-ai/dsh-llm";

import { applyAutoContinue, repairLegacyContinueMessages } from "./auto-continue";

/**
 * 一次 finish 的记录：`kind` 给「截断续写」用，`failureCode` 给「断流续写」用。
 *
 * 两个字段必须分开存：宿主的 `finish.kind` 只有
 * `stop | tool-calls | max-tokens | aborted | error` 这五个值，
 * 而「流被截断」被我表达成 `kind: "error"` + `failure.code: "PROVIDER_STREAM_TRUNCATED"`
 * （见 `core/stream-truncation`）。只看 `kind` 分不出「断流」与「真错误」。
 */
interface FinishRecord {
  turn: number;
  kind: string;
  /** `kind === "error"` 时的稳定码；其他 kind 缺省。 */
  failureCode?: string;
}

/** 宿主事件的弱类型视图（`agent/pre-step`、`session/event` 不在 Events 声明里）。 */
interface HostEvents {
  on(event: string, listener: (...args: unknown[]) => unknown): unknown;
}

/** 能读到 `agents` 服务的上下文（只用到 `get`）。 */
interface HostContext {
  get?: (name: string) => unknown;
  on(event: string, listener: (...args: unknown[]) => unknown): unknown;
}

/** 宿主的 inbox（形状照抄 `app.asar`：`nextStep` 是只读数组，`append(target, message)`）。 */
type CurrentInbox = { append(target: "next-step", message: unknown): unknown };

/** 一个记录的 `isRecord` 窄化（跨远程边界的形状不可信）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 读设置文档里的「自动继续开关」。
 *
 * ## 三条优先级（与 commandcode 那一份同义，但那一份还多了一层「原始文档」判定）
 *
 * 1. **显式 `autoContinue`** 优先：用户在界面上打开/关闭它，那就是最终决定；
 * 2. `autoContinue` 缺失时看两个**旧字段**（v1.4.0 之前拆成
 *    `autoContinueOnError` / `autoContinueOnTruncate`）—— 任一为 true 就当作开启，
 *    否则升级后原本开着的用户会被静默关掉；
 * 3. 都没有 → `false`（默认关闭，与 schema 的 `default(false)` 一致）。
 *
 * 为什么不能只读 `autoContinue`：`z.object` 会**剥掉**未声明字段，所以旧字段必须在
 * schema 里显式声明才读得到（三家 schema 都这么做了）。它们**没有 default** ——
 * 未提供是 `undefined`，与「用户显式关着」区分得开。
 *
 * @param document - 设置文档（形状不可信）。
 * @returns 是否开启。
 */
/**
 * 读设置文档里的「自动继续开关」。
 *
 * ## 两种调用方式，因为「有没有原始文档」决定了能不能分清「没配过」与「显式关」
 *
 * 实测（`tests/vendors/auto-continue-switch-semantics.test.ts`）：
 * `schemastery` 的 `z.boolean().default(false)` 在解析后**会把字段填成 `false`**，
 * 于是 `Object.hasOwn(parsed, "autoContinue")` **恒为 `true`** ——
 * 「用户没配过」与「用户显式关着」在**解析后**的文档里长得一模一样。
 *
 * 所以：
 *
 * | 传入的文档 | `authoritative` | 判据 | 结果 |
 * | --- | --- | --- | --- |
 * | 原始文档（未经 schema 解析，如 commandcode 的 `rawDocument`） | `true` | `hasOwn` | 显式 `false` **优先**，旧字段不复活 |
 * | 解析后的文档（opendesign / opencode 目前只有这一份） | 缺省 | 只看值 | 任一条 `true` 即开启（**宁开不关**） |
 *
 * ## 为什么非权威模式下选择「宁开不关」
 *
 * 解析后 `autoContinue` 恒存在且默认 `false`。若据此否掉旧字段，**升级用户**
 *（只写过 `autoContinueOnTruncate: true` 的那批）会发现「以前开着的自动继续突然关了」。
 * 那是静默关掉用户的功能 —— 比「显式关掉后可能被旧字段复活」更糟。
 *
 * 代价如实记：非权威模式下**「显式关掉 + 旧字段残留 true」会被旧字段重新打开**。
 * 要彻底解决，另两家也得像 commandcode 一样读一份原始文档 —— 留给下一版。
 *
 * @param document - 设置文档（**一定要说清是哪一种**）。
 * @param options - `authoritative: true` 表示这是未经 schema 解析的原始文档。
 * @returns 是否开启。
 */
export function autoContinueEnabledOf(
  document: Record<string, unknown>,
  options: { authoritative?: boolean } = {},
): boolean {
  if (options.authoritative === true) {
    /*
     * 原始文档：`hasOwn` 在这里**是可靠的** —— 没写过的字段真的不存在。
     * 于是显式 `false` 必须优先（用户在新界面关掉之后，残留旧字段不该把它重新打开）。
     */
    if (Object.hasOwn(document, "autoContinue")) return document["autoContinue"] === true;
    return document["autoContinueOnError"] === true || document["autoContinueOnTruncate"] === true;
  }
  /*
   * 解析后的文档：`hasOwn` 不可靠，只能看值。
   * 任一条 `true` 即开启 —— 见上面「宁开不关」的理由。
   */
  return (
    document["autoContinue"] === true ||
    document["autoContinueOnError"] === true ||
    document["autoContinueOnTruncate"] === true
  );
}

/**
 * 接线自动继续。
 *
 * @param ctx - 插件上下文（只需要 `on` 与 `get`）。
 * @param settings - **函数**而不是快照：`loader/volatile-update` 不会重跑 apply，
 *   快照会让「运行时改开关/次数/间隔」全部不生效。
 * @param vendorLabel - 只用于诊断日志。
 * @returns 注销函数（把注册的事件都摘掉）。
 */
export function wireAutoContinue(
  ctx: unknown,
  settings: () => { enabled: boolean; maxAttempts: number; intervalMs: number },
  vendorLabel: string,
): () => void {
  const host = ctx as HostContext;
  const events = host as unknown as HostEvents;

  /** 按 session.id 记下最近一轮的 finish（只读当前轮，避免拿上一轮的判断这一轮）。 */
  const finishesBySession = new Map<string, FinishRecord>();

  /** 只允许**当前执行作用域**选 inbox：从别的 agent 那里拿会发错会话。 */
  const agentOfCurrentRun = (): { inbox: CurrentInbox } | undefined => {
    try {
      const get = host.get;
      const agents = typeof get === "function" ? get.call(host, "agents") : undefined;
      const current = (agents as { currentInitiator?: () => unknown } | undefined)?.currentInitiator?.();
      if (!isRecord(current) || !isRecord(current.session) || typeof current.session.id !== "string") {
        return undefined;
      }
      if (!isRecord(current.inbox) || typeof current.inbox.append !== "function") return undefined;
      return current as { inbox: CurrentInbox };
    } catch {
      return undefined;
    }
  };

  const offPreStep = events.on("agent/pre-step", (payload: unknown, next?: unknown) => {
    const record = isRecord(payload) ? payload : undefined;
    if (record !== undefined) repairLegacyContinueMessages(record["messages"]);
    // waterfall：必须把下游的 enter/reject 决策交回去，否则链路断在这里。
    return typeof next === "function" ? (next as () => unknown)() : undefined;
  });

  const offSession = events.on("session/event", (session: unknown, event: unknown) => {
    if (!isRecord(event) || event["type"] !== "assistant/message") return;
    const data = isRecord(event["data"]) ? event["data"] : undefined;
    if (data === undefined) return;
    /*
     * 宿主的终止原因藏在 compact stream 记录里；拿它而不是从 data 顶层读 ——
     * 顶层没有这个字段（`assistant/message` 只带 message/usage/turn）。
     */
    const finish = Array.isArray(data["stream"])
      ? lastAssistantStreamChunk(data["stream"] as readonly AssistantStreamRecord[], "finish")?.reason
      : undefined;
    if (!isRecord(finish) || typeof finish["kind"] !== "string") return;
    if (!isRecord(session) || typeof session["id"] !== "string" || session["id"].length === 0) return;
    const turn = data["turn"];
    if (typeof turn !== "number" || !Number.isSafeInteger(turn)) return;
    const finishRecord = finish as Record<string, unknown>;
    const failureRaw = finishRecord["failure"];
    const failure: Record<string, unknown> | undefined = isRecord(failureRaw) ? failureRaw : undefined;
    const code = failure === undefined ? undefined : failure["code"];
    finishesBySession.set(session["id"], {
      turn,
      kind: finish["kind"],
      ...(typeof code === "string" && code !== "" ? { failureCode: code } : {}),
    });
    // 有界：会话很多时不无限增长（超了丢最旧的）。
    if (finishesBySession.size > 128) {
      const oldest = finishesBySession.keys().next().value;
      if (oldest !== undefined) finishesBySession.delete(oldest);
    }
  });

  try {
    applyAutoContinue(
      host as never,
      settings,
      {
        get inbox() {
          return agentOfCurrentRun()?.inbox;
        },
        /*
         * 只给 `kind`。断流的续写判据（要不要因为 `PROVIDER_STREAM_TRUNCATED` 也继续）
         * 由**核心判定**决定，不在这一层拼字符串 —— 那样会让「error 到底是什么错误」
         * 的信息在接线处丢失，日后没法区分。
         */
        lastFinishReason: (sessionId, turn) => {
          const finish = finishesBySession.get(sessionId);
          return finish?.turn === turn ? finish.kind : undefined;
        },
      },
    );
  } catch (error: unknown) {
    // 接线失败不该拖垮整个插件：没有自动继续，其余功能照常。
    console.error(`[dsh-llm-account] ${vendorLabel}: auto-continue wiring failed:`, error);
    return () => undefined;
  }

  return () => {
    try {
      if (typeof offPreStep === "function") (offPreStep as () => void)();
    } catch {
      // 注销失败不影响其余清理。
    }
    try {
      if (typeof offSession === "function") (offSession as () => void)();
    } catch {
      // 同上。
    }
  };
}