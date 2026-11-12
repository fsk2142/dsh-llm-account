/**
 * **实时 tok/s 的探针**（2026-11-12，第 1 步）。
 *
 * ## 这个文件是干什么的
 *
 * 验证一件事：**我们的客户端插件能不能吃到 `assistant/live-chunk` 事件**。
 *
 * - 能 → 第 2 步才值得写「1 秒滑动窗口 + token 换算 + 输入框右侧显示」；
 * - 不能 → 完整版写出来也没有数据源，等于白写。
 *
 * 现在它**只打控制台日志，不渲染任何 UI**，也**不写任何设置**。
 *
 * ## 为什么单独一个文件、而不塞进 `seams.ts`
 *
 * `seams.ts` 是 3900 行、几十处注册的共享文件。往那里加东西，一旦写错就会伤到
 * 设置页/侧边栏 —— 用户报过好几次「升级后功能坏掉 / DSH 起不来」。新开一个文件、
 * 只在 `index.ts` 末尾加一道 guarded 调用，失败半径就只有这一个功能。
 *
 * ## 为什么**不**把 `uiConversation` 放进 `inject` 数组
 *
 * `inject` 数组里的服务缺失会让 cordis 判定**整个客户端包激活失败** —— 那时设置页
 * 和侧边栏会一起消失。所以这里走 `ctx.inject([...], cb)` 的**嵌套注入**：服务不在
 * 就只是这个回调不跑，其余一切照常。插件里 `remote.credentials` 已有同样的用法。
 *
 * ## 为什么定义里**不写** `target` / `buildViewNode`
 *
 * 宿主的 `assertDefinitionTarget` 把这个条件写死了：
 *
 * ```
 * if (definition.target === undefined !== (definition.buildViewNode === undefined)) throw
 * ```
 *
 * 也就是说这两者**必须同时存在或同时缺席**。探针不产出任何可见节点，所以两个都
 * 不写 —— 这样既通过校验，又不会往会话视图里塞空节点。
 *
 * @module dsh-llm-account/src/client/tps-probe
 */

import { pushLiveChunk, TpsPill } from "./tps-pill";

/** 探针需要的客户端上下文面（只用 `inject`，不碰别的服务）。 */
export interface TpsProbeContext {
  inject?(names: readonly string[], callback: (scoped: TpsProbeContext) => unknown): unknown;
}

/** 宿主 `ctx.slots` 的最小面（只认 `register`）。 */
interface SlotsLike {
  register?: (spec: Record<string, unknown>, component: unknown) => unknown;
}

/**
 * 显示胶囊的注销句柄（**模块级**：它由嵌套注入的回调赋值，回调清理时需要看到它）。
 *
 * 单独存一份而不是塞进闭包，是因为同一个 `installTpsProbe` 可能被多次触发
 * （槽位声明变化时宿主会重跑回调），每次都要先撤掉上一份。
 */
let pillDispose: (() => void) | undefined;

/**
 * 撤销显示胶囊。
 *
 * 只在**注册成功过**时才需要调；拿不到句柄时是空操作。
 */
function disposePill(): void {
  const off = pillDispose;
  pillDispose = undefined;
  if (typeof off !== "function") return;
  try {
    off();
  } catch (error: unknown) {
    console.error("[dsh-llm-account] tps pill: dispose failed:", error);
  }
}

/**
 * 释放本次注册产生的一切（事件定义 + 显示胶囊）。
 *
 * 各个早退分支都返回它 —— 否则「事件拿到了但显示没挂上」那种半成品状态会留下
 * 一个没有人喂数据的胶囊。
 * @returns 注销函数（可重复调用）。
 */
function releaseAll(): void {
  disposePill();
}

/** 一条 `assistant/live-chunk` 事件里我们关心的形状。 */
interface LiveChunkEvent {
  type?: string;
  time?: number;
  data?: {
    chunk?: {
      type?: string;
      /** 正文/推理的增量文本（流式协议里是字符串片段）。 */
      text?: string;
      /** 工具调用参数增量。 */
      argumentsDelta?: string;
    };
    turn?: number;
    step?: number;
  };
}

/** 一个事件定义（只列探针用到的字段）。 */
interface TpsProbeDefinition {
  kind: string;
  match: (event: LiveChunkEvent) => { id: string; role: "start" | "update" } | null;
  start: (context: unknown, match: { event: LiveChunkEvent }) => unknown;
  update: (context: { state?: unknown }, match: { event: LiveChunkEvent }) => unknown;
}

/** 探针用的 Definition kind（必须全局唯一；与插件 id 同前缀，避免撞宿主内置的名字）。 */
const PROBE_KIND = "llm-account-tps-probe";

/**
/**
 * 帧到达时刻：**一律用本地墙钟**（2026-11-12 修「速度恒为 0」）。
 *
 * ## 之前错在哪
 *
 * 第一版用 `event.time`（宿主事件的时刻）作为 `meter.push` 的时间轴，而读数时用
 * `Date.now()`。**两个时钟互相比较**，只要基准不同，`at - latest` 就会算成一个
 * 很大的值 —— 直接命中「空闲超过 800ms」那条分支，读数恒为 `undefined`（显示 0）。
 *
 * 症状正是用户报的两条：**数字一直是 0**，以及「运行一段时间后就不行了」
 * （组件的「归零就停表」逻辑让它再也不会重启）。
 *
 * ## 为什么本地墙钟才是对的
 *
 * 这个仪表测的是「**字到达我这台机器的真实速率**」—— 本来就该用本地时钟。
 * 当初选 `event.time` 的理由（历史重放能落回正确位置）属于回放/审计场景，
 * 不属于一个实时速度表。
 *
 * @param event - 流式事件（仅用于时钟漂移诊断，不参与计时）。
 * @returns 本地墙钟毫秒。
 */
function arrivalTime(event: LiveChunkEvent): number {
  const now = Date.now();
  /*
   * 诊断：宿主事件时间与本地时钟明显不一致时**只打一次**，下次换宿主版本
   * 就能立刻看出「是不是又换了时间基准」。
   */
  if (typeof event.time === "number" && Number.isFinite(event.time)) {
    const drift = now - event.time;
    if (Math.abs(drift) > DIAGNOSTIC_DRIFT_MS && !driftLogged) {
      driftLogged = true;
      console.debug(
        `[dsh-llm-account] tps probe: event.time differs from local clock by ${drift}ms; using the local clock`,
      );
    }
  }
  return now;
}

/** 超过这个差值才打一次时钟漂移诊断（避免每帧刷屏）。 */
const DIAGNOSTIC_DRIFT_MS = 5_000;

/** 时钟漂移诊断是否已经打过（只打一次，够定位就行）。 */
let driftLogged = false;

/** 两次 `console.debug` 之间至少隔多久（毫秒）：流式帧很密，逐帧打会淹没控制台。 */
const LOG_INTERVAL_MS = 250;

/**
 * 注册探针。
 *
 * 所有失败都在这里兜住：探针注册不上，只是看不到日志，**不允许**影响插件的其余部分。
 * @param ctx - 客户端上下文。
 */
export function installTpsProbe(ctx: TpsProbeContext): void {
  const inject = ctx.inject;
  if (typeof inject !== "function") {
    console.debug("[dsh-llm-account] tps probe: ctx.inject is unavailable, skipped");
    return;
  }
  try {
    /*
     * 嵌套注入两个服务：`uiConversation`（吃流式事件）与 `slots`（挂显示胶囊）。
     *
     * 两个都走**嵌套注入**而不是顶层 `inject` 数组 —— 服务缺失时只有这个回调不跑，
     * 不会让整个客户端包激活失败（那会连带让设置页与侧边栏消失）。
     */
    inject(["uiConversation", "slots"], (scoped) => {
      try {
        const slots = (scoped as { slots?: SlotsLike }).slots;
        // 先挂显示（它不依赖事件是否可用）；失败半径仍只在这一个胶囊。
        if (typeof slots === "object" && slots !== null && typeof slots.register === "function") {
          try {
            const off = slots.register(
              {
                name: "conversation.composer.dock",
                id: "llm-account-tps",
                // 负 order → 排在官方两个胶囊（轮次/步数 = 0、用量 = 1）的**左边**。
                order: -1,
              },
              TpsPill,
            );
            pillDispose = typeof off === "function" ? (off as () => void) : undefined;
            console.debug("[dsh-llm-account] tps pill: registered into conversation.composer.dock (order -1)");
          } catch (error: unknown) {
            console.error("[dsh-llm-account] tps pill: slot registration failed:", error);
          }
        } else {
          console.debug("[dsh-llm-account] tps pill: slots.register is unavailable, skipped");
        }
        const service = (scoped as { uiConversation?: unknown }).uiConversation;
        if (typeof service !== "object" || service === null) {
          console.debug("[dsh-llm-account] tps probe: uiConversation is not an object, skipped");
          return releaseAll;
        }
        const events = (service as { events?: unknown }).events;
        if (typeof events !== "object" || events === null) {
          console.debug("[dsh-llm-account] tps probe: uiConversation.events is unavailable, skipped");
          return releaseAll;
        }
        /*
         * **把方法挂在对象上调用，绝不先取出来再调**（2026-11-12 真机崩溃的根因）。
         *
         * 第一次实现写的是：
         *
         * ```ts
         * const register = events.register as (...) => unknown;
         * const off = register(definition());   // ← this 丢了
         * ```
         *
         * 而宿主的 `register` 是 **class 方法**，内部第一句就是
         * `this.registerDefinition(...)`。把方法赋给变量后 `this` 变成 `undefined`，
         * 于是抛 `Cannot read properties of undefined (reading 'registerDefinition')`。
         *
         * 这不只是 JS 常识问题 —— 它当时**真的在用户的控制台里刷了错误**。现在的写法
         * `events.register(...)` 保持接收者在原位，`this` 正确绑定。
         */
        const target = events as { register?: unknown; registerDefinition?: unknown; registerFallback?: unknown };
        // 诊断用：把该对象上真实可用的方法名列出来（下次一看日志就知道 API 形状）。
        const methods = Object.keys(target).filter(
          (key) => typeof (target as Record<string, unknown>)[key] === "function",
        );
        if (typeof target.register !== "function") {
          console.debug(
            `[dsh-llm-account] tps probe: events.register is unavailable; available methods=[${methods.join(", ")}]`,
          );
          return releaseAll;
        }
        const off = (target.register as (this: unknown, definition: TpsProbeDefinition) => unknown).call(
          target,
          definition(),
        );
        console.debug(
          `[dsh-llm-account] tps probe: registered (waiting for assistant/live-chunk); events methods=[${methods.join(", ")}]`,
        );
        return () => {
          try {
            if (typeof off === "function") (off as () => void)();
          } catch (error: unknown) {
            console.error("[dsh-llm-account] tps probe: dispose failed:", error);
          }
          // 事件定义撤销后，显示胶囊也要撤（否则它会留在一个没人喂数据的槽位里）。
          disposePill();
        };
      } catch (error: unknown) {
        console.error("[dsh-llm-account] tps probe: registration failed:", error);
        return releaseAll;
      }
    });
  } catch (error: unknown) {
    console.error("[dsh-llm-account] tps probe: nested inject failed:", error);
  }
}

/**
 * 把一次 chunk 折算成字符数（探针只关心「有多少内容进来了」）。
 * @param chunk - 事件里的 `chunk`。
 * @returns 字符数；认不出的形状为 0。
 */
function charsOf(chunk: unknown): number {
  if (typeof chunk !== "object" || chunk === null) return 0;
  const text = (chunk as { text?: unknown }).text;
  if (typeof text === "string") return text.length;
  const args = (chunk as { argumentsDelta?: unknown }).argumentsDelta;
  if (typeof args === "string") return args.length;
  return 0;
}

/**
 * 造事件定义。
 *
 * 三条分工（照宿主 `uiConversation` 的 Definition 约定）：
 * - `match`：只认 `assistant/live-chunk`，首帧给 `start`、其余给 `update`；
 * - `start`：第一帧到达时复位计数并打日志；
 * - `update`：后续帧累加并节流打日志。
 *
 * @returns 事件定义。
 */
function definition(): TpsProbeDefinition {
  /** 上一次打日志的时刻。 */
  let lastLogAt = 0;
  /** 本次流累计收到的字符数。 */
  let chars = 0;
  /** 本次流累计的帧数。 */
  /** 本次流累计的帧数。 */
  let frames = 0;
  /**
   * 最近一次见过的 turn/step 拼成的流 id。
   *
   * ## 为什么不能用 `chars === 0` 判 start（2026-11-12 修「运行一段时间后就不行了」）
   *
   * 第一版写的是 `role: chars === 0 ? "start" : "update"` —— 判据基于**可变计数器**。
   * 一旦某一轮真正收到过文本，`chars` 就不再是 0；于是**下一轮的第一个帧**也会被
   * 报成 `"update"`，而宿主对 `"update"` 要求已有对应 Context —— 没有就直接丢弃。
   *
   * 结果：之后每一轮的第一帧都被丢，计数再也起不来 —— 用户看到的正是
   * 「运行一段时间后就不行了，速度始终 0」。
   *
   * 现在看 **id 有没有变**：id 由 turn/step 拼成，换了流就是 `start`。
   */
  let lastStreamId: string | undefined;

  /** 打一条节流后的日志。 */
  const log = (event: LiveChunkEvent, label: string): void => {
    const now = Date.now();
    if (now - lastLogAt < LOG_INTERVAL_MS) return;
    lastLogAt = now;
    console.debug(
      `[dsh-llm-account] live-chunk ${label}: frames=${frames} chars=${chars} ` +
        `type=${String(event.data?.chunk?.type)} turn=${String(event.data?.turn)} step=${String(event.data?.step)}`,
    );
  };

  return {
    kind: PROBE_KIND,
    match: (event) => {
      if (event.type !== "assistant/live-chunk") return null;
      const id = `${PROBE_KIND}:${String(event.data?.turn)}:${String(event.data?.step)}`;
      /*
       * **按 id 变化判 start**：第一帧建 Context，之后都是 update。
       * 这是宿主的约定（`start` 会创建 state，`update` 只更新已存在的 state），
       * 不能用「计数器是否为 0」这种业务状态来猜。
       */
      const isFirstForStream = id !== lastStreamId;
      lastStreamId = id;
      return { id, role: isFirstForStream ? "start" : "update" };
    },
    start: (_context, match) => {
      chars = 0;
      frames = 0;
      lastLogAt = 0;
      const add = charsOf(match.event.data?.chunk);
      if (add > 0) {
        chars += add;
        frames += 1;
      }
      /*
       * **把这一帧喂给显示层**。
       *
       * 探针原本只打日志；现在同一次回调顺手推进速度计 —— 避免再注册第二个
       * 事件定义（宿主要求 kind 全局唯一，多注册一份就多一份维护面）。
       *
       * 时间用 `arrivalTime`（**本地墙钟**），不用 `event.time`：读数时用的是
       * `Date.now()`，两个时钟混用会让每次比较都落进「空闲」分支（详见那函数的说明）。
       */
      pushLiveChunk(match.event.data?.chunk, { turn: match.event.data?.turn, step: match.event.data?.step }, arrivalTime(match.event));
      log(match.event, "start");
      return { chars, frames };
    },
    update: (_context, match) => {
      const add = charsOf(match.event.data?.chunk);
      if (add > 0) {
        chars += add;
        frames += 1;
      }
      pushLiveChunk(match.event.data?.chunk, { turn: match.event.data?.turn, step: match.event.data?.step }, arrivalTime(match.event));
      log(match.event, "update");
      return { chars, frames };
    },
  };
}