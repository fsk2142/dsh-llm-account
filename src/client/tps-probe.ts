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

/** 探针需要的客户端上下文面（只用 `inject`，不碰别的服务）。 */
export interface TpsProbeContext {
  inject?(names: readonly string[], callback: (scoped: TpsProbeContext) => unknown): unknown;
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
    // 嵌套注入：`uiConversation` 不存在时回调不跑，其余注册不受影响。
    inject(["uiConversation"], (scoped) => {
      try {
        const service = (scoped as { uiConversation?: unknown }).uiConversation;
        if (typeof service !== "object" || service === null) {
          console.debug("[dsh-llm-account] tps probe: uiConversation is not an object, skipped");
          return () => undefined;
        }
        const events = (service as { events?: { register?: unknown } }).events;
        if (typeof events !== "object" || events === null || typeof events.register !== "function") {
          console.debug("[dsh-llm-account] tps probe: uiConversation.events.register is unavailable, skipped");
          return () => undefined;
        }
        const register = events.register as (definition: TpsProbeDefinition) => unknown;
        const off = register(definition());
        console.debug("[dsh-llm-account] tps probe: registered (waiting for assistant/live-chunk)");
        return () => {
          try {
            if (typeof off === "function") (off as () => void)();
          } catch (error: unknown) {
            console.error("[dsh-llm-account] tps probe: dispose failed:", error);
          }
        };
      } catch (error: unknown) {
        console.error("[dsh-llm-account] tps probe: registration failed:", error);
        return () => undefined;
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
  let frames = 0;

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
      // 首次匹配走 start，之后走 update。用 turn/step 做 id，让宿主能把同一流的更新归到一起。
      const id = `${PROBE_KIND}:${String(event.data?.turn)}:${String(event.data?.step)}`;
      return { id, role: chars === 0 ? "start" : "update" };
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
      log(match.event, "start");
      return { chars, frames };
    },
    update: (_context, match) => {
      const add = charsOf(match.event.data?.chunk);
      if (add > 0) {
        chars += add;
        frames += 1;
      }
      log(match.event, "update");
      return { chars, frames };
    },
  };
}
