/**
 * 三家适配器共用的**回合循环**：选账号 → 取凭据 → 发请求 → 透传 chunk → 分类失败 → 换号/换模型。
 *
 * ## 为什么抽到这里（2026-11-07）
 *
 * 这段循环原先在 `opendesign` / `opencode` / `commandcode` 三个适配器里各有一份，
 * 约 90 行，几乎逐字相同。代价不是行数，而是**同一个 bug 要修三次且总会漏**：
 *
 * | 事故 | 当时后果 |
 * | --- | --- |
 * | 「额度已用尽」误报（2.1.4） | 三家都抛「最后一条失败」→ 三家一起错 |
 * | 条数上限失效（2.1.5–2.1.7） | 只修了 opendesign，另两家留着同样的坑 |
 *
 * 现在这里持有**全部控制流**：`tried` 记账、`maxTried` 判断、失败分类结果的处理、
 * 「已输出就不换号」闸门、换模型与跨厂商委托、成功/取消/失败三条出口、用量累加。
 *
 * 各家只提供真正不同的东西（{@link AttemptLoopHost}）：凭据怎么取、请求怎么发、
 * 失败怎么分类、chunk 要不要改写。
 *
 * ## 行为等价
 *
 * 抽取前的差异用三个开关保留，默认值与原来一致：
 * - {@link AttemptLoopHost.deferUsage}：usage 块是否延后一个内容块再发（仅 opencode 为真）；
 * - {@link AttemptLoopHost.usageCountsAsEmitted}：usage 块算不算「已输出」（仅 opencode 为假）；
 * - {@link AttemptLoopHost.onChunk}：DSML 抢救与 pi-ai 终态转换（仅 opencode 用）。
 *
 * 2000+ 条既有用例是这次重构的护栏。
 * @module dsh-llm-account/src/core/attempt-loop
 */
import { LlmError } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, StreamChunk, TokenUsage } from "@deepseek-ai/dsh-llm";

import type { FailureKind, Rejection } from "./adapter";
import { AttemptLedger, type AttemptFailure } from "./attempt-ledger";

/** 一次尝试累计的四个用量计数。 */
export interface AttemptCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** 一份干净的用量计数。 */
export function emptyCounts(): AttemptCounts {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

/**
 * 一个 usage 块计入的 token 总数（缺 `totalTokens` 时按分项相加）。
 *
 * 与抽取前三家各自的实现一致：厂商可能把 `totalTokens` 省掉，那时用三项之和。
 * @param usage - 宿主的用量块。
 * @returns 计入 `totalTokens` 的数量。
 */
export function usageTotal(usage: TokenUsage): number {
  const explicit = usage.totalTokens;
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

/** 轮换引擎里本模块用到的部分（结构类型：不把适配器和轮换实现绑死）。 */
export interface AttemptLoopRotation {
  pick(request: { model: string; tried: ReadonlySet<string> }): string | undefined;
  markRejected(ref: string, rejection: Rejection): void;
  fallbackAllowed(context: { emitted: boolean; totalTokens: number; aborted: boolean }): boolean;
  noteSettled(ref: string): void;
}

/** 换到的模型（可能是另一家厂商）。 */
export interface SwappedTarget {
  provider: string;
  model: string;
}

/** chunk 透传过程中暴露给钩子的状态（DSML 抢救要读）。 */
export interface StreamPumpState {
  /**
   * **仅用户可见正文**的累计文本（**不含 reasoning**）。
   *
   * ## 为什么把推理排除在外（2026-11-10 审查 A02，P1）
   *
   * 原来这里累积的是「正文 + 推理」，而 opencode 的 DSML 抢救会拿它整段去
   * `parseDsmlCalls()` 找工具调用。于是模型只要在**思考过程**里推演一遍 DSML 语法
   * （「用户问这个格式怎么用，那大概是 `<｜DSML｜ calls>` 这样……」），那段推演就会
   * 被当成真实的工具调用意图去执行。
   *
   * 推理是模型的自言自语，不是它对宿主的指令；把两者混成一块再「猜」调用，
   * 判断依据本身就是错的。所以这里只收 `text-delta`。
   */
  text: string;
  /** 是否已经出现过工具调用块。 */
  sawToolCall: boolean;
  /** 已出现的最大块序号（补发新块时用 `+1`）。 */
  lastBlockIndex: number;
}

/**
 * 一家厂商接入回合循环需要提供的东西。
 *
 * 只有 {@link resolveCredential}、{@link attempt}、{@link classify} 是必须的；
 * 其余是行为差异明确的开关。
 */
export interface AttemptLoopHost<Config, Credential, AttemptContext> {
  /** 厂商名，用于「没有可用账号」这类消息（`llm-opendesign` 等）。 */
  readonly label: string;
  readonly rotation: AttemptLoopRotation;
  /** 本请求最多试几个账号（现读设置）。 */
  maxTried(): number;
  /** 解析本家配置（每次请求一次）。 */
  resolveConfig(): Config;
  /** 判断错误是不是「用户取消」。 */
  isAbort(error: unknown): boolean;
  /** 构造取消错误。 */
  abortError(signal?: AbortSignal): unknown;
  /** 选号前的钩子（账号切换策略）。 */
  beforeRequest?(input: { sessionId?: string; purpose?: string }): Promise<void> | void;
  /** 换模型（额度拒绝时）；返回 `undefined` 表示不换。 */
  fallbackModel?(options: GenerateOptions, kind: FailureKind): Promise<SwappedTarget | undefined>;
  /** 跨厂商委托；返回 `undefined` 表示目标家不能委托。 */
  delegate?(target: SwappedTarget, options: GenerateOptions): AsyncIterable<StreamChunk> | undefined;
  /** 换到同名模型后要做的清理（opencode 重置「本轮首选」）。 */
  onModelSwitched?(): void;
  /** 一次尝试的前置上下文（opencode 的网关证据记录器）。 */
  beginAttempt?(): AttemptContext | undefined;
  /** 取凭据；`undefined` 表示这个账号没有可用凭据。 */
  resolveCredential(ref: string, signal?: AbortSignal): Promise<Credential | undefined>;
  /** 凭据解析抛错时的分类（只有 opencode 需要）；`undefined` 表示原样抛出。 */
  classifyCredentialError?(error: unknown): AttemptFailure | undefined;
  /**
   * 请求级拒绝时要不要换一个错误再抛。
   *
   * opencode 用它在抛出前把 pi-ai 的证据载体换成宿主认识的稳定终态码
   * （`PI_AI_ERROR`），否则宿主会把它当未知错误处理。
   */
  wrapRequestLevelError?(error: unknown): unknown;
  /** 「没有可用凭据」时的失败（含 markRejected 的调用）。 */
  missingCredential(ref: string): AttemptFailure;
  /** 一次尝试的 chunk 流。 */
  attempt(
    config: Config,
    options: GenerateOptions,
    credential: Credential,
    context: AttemptContext | undefined,
  ): AsyncIterable<StreamChunk>;
  /** 失败分类；`undefined` 表示请求级拒绝（换账号没有意义）。 */
  classify(
    error: unknown,
    context: AttemptContext | undefined,
  ): Promise<AttemptFailure | undefined> | AttemptFailure | undefined;
  /** 记一次用量（旁路：绝不改变请求结果）。 */
  recordUsage(ref: string, model: string | undefined, outcome: "success" | "failure", counts: AttemptCounts, failureKind?: string): void;
  /** 「最近成功者」（卡片跟随真实账号）。 */
  noteSettled(ref: string): void;
  /** 备用账号服务成功后的提位。 */
  promoteServed?(ref: string): void;
  /**
   * 「一个可用账号都没有」时的错误。
   *
   * **只在第一次选号就选不到时出现**（一条失败都没有）：这时候用户需要的是
   * 「去账号页加一个」这种可行动的话，不是「都不可用」。
   * 抽完所有账号的那条路不会走到这里 —— 那条路上 {@link AttemptLedger.throwExhausted}
   * 一定有失败可抛（取不到候选本身就意味着已有失败），所以不需要另一条文案。
   */
  noAccount(model: string): LlmError;
  /** chunk 改写/补发（DSML 抢救）；抛出即终止本次尝试（不参与换号分类）。 */
  onChunk?(state: StreamPumpState, chunk: StreamChunk): void | StreamChunk[];
  /** usage 块延后到下一个内容块之前再发（opencode 的行为）。 */
  deferUsage?: boolean;
  /** usage 块是否计入「已输出」（opencode 为假）。 */
  usageCountsAsEmitted?: boolean;
}

/**
 * 跑完一次请求：账号轮换、失败分类、有条件的换号与换模型。
 * @param host - 厂商提供的那一组钩子。
 * @param initialOptions - 宿主的完整请求。
 * @returns 与线上同序的 chunk 流。
 */
export async function* runAttemptLoop<Config, Credential, AttemptContext>(
  host: AttemptLoopHost<Config, Credential, AttemptContext>,
  initialOptions: GenerateOptions,
): AsyncGenerator<StreamChunk> {
  await host.beforeRequest?.({
    ...(initialOptions.sessionId === undefined ? {} : { sessionId: String(initialOptions.sessionId) }),
    ...(initialOptions.purpose === undefined ? {} : { purpose: initialOptions.purpose }),
  });

  const config = host.resolveConfig();
  const ledger = new AttemptLedger(() => host.maxTried());
  /**
   * 本次请求是否**已经换过模型**（只换一次：替代也限额就停手，不再套娃）。
   *
   * 从 `options` 里读初值（2026-11-01 修 R01）：跨网关委托时 `delegateStream` 会把
   * options 透传给目标家的 adapter，如果每家都用自己实例上的 `false` 重新开始，
   * 就会出现 **A→B→A** 的无限往返 —— 每家都觉得自己"还没换过"。
   */
  let swappedOnce = (initialOptions as { swappedOnce?: boolean }).swappedOnce === true;
  let options = initialOptions;
  /** 本轮第一个被选中的账号（opencode 的提位判定用；其余两家不读）。 */
  let firstPick: string | undefined;

  for (;;) {
    // 取成局部布尔量：`options.signal` 是只读参数对象上的属性，直接比较会让
    // TypeScript 把下面的同名比较收窄成「恒假」。
    const aborted = options.signal?.aborted === true;
    if (aborted) throw host.abortError(options.signal);

    const ref = host.rotation.pick({ model: options.model, tried: ledger.tried });
    if (ref === undefined) {
      /**
       * 换模型的机会：所有账号都被**拒绝**了（继续换账号已无意义，换同名模型往往还能服务）。
       *
       * 只在「确实有账号被拒绝」时才尝试 —— `ledger.last === undefined` 意味着一条凭据
       * 都没解析到（`MISSING_CREDENTIAL`），那种情况换模型毫无意义，而且查候选要读各家
       * 目录（会发额外请求）。先抛确定性的失败，别为一次注定失败的请求去打网络。
       */
      if (!swappedOnce && ledger.last !== undefined && ledger.last.rejection.kind !== "invalid-credential") {
        const swapped = await host.fallbackModel?.(options, ledger.last.rejection.kind);
        if (swapped !== undefined && (swapped.provider !== options.provider || swapped.model !== options.model)) {
          swappedOnce = true;
          // **跨厂商**：本 adapter 不能以别家身份发请求，转给目标家的 adapter。
          if (swapped.provider !== options.provider) {
            const delegated = host.delegate?.(swapped, {
              ...options,
              // **把「已换过模型」传给下一家**（2026-11-01 修 R01）。
              swappedOnce: true,
            } as unknown as GenerateOptions);
            if (delegated !== undefined) {
              yield* delegated;
              return;
            }
          } else {
            options = { ...options, model: swapped.model };
            ledger.tried.clear();
            host.onModelSwitched?.();
            continue;
          }
        }
      }
      if (ledger.last !== undefined) ledger.throwExhausted(() => host.noAccount(options.model));
      throw host.noAccount(options.model);
    }
    ledger.beginAttempt(ref);
    // 本轮第一个被选中的账号 = 这次的「首选」；后面成功的都是备用账号（晋升判定用）。
    if (firstPick === undefined) firstPick = ref;

    let credential: Credential | undefined;
    const attemptContext = host.beginAttempt?.();
    try {
      credential = await host.resolveCredential(ref, options.signal);
    } catch (error) {
      // 用户取消优先：凭据路径超时/取消不该被当成厂商失败去换号。
      if (options.signal?.aborted === true) throw host.abortError(options.signal);
      const classified = host.classifyCredentialError?.(error);
      // 认不出来的凭据错误原样抛出（不是所有厂商的错误都能换号解决）。
      if (classified === undefined) throw error;
      ledger.note(classified);
      if (ledger.reachedMax()) ledger.throwExhausted(() => host.noAccount(options.model));
      continue;
    }
    if (credential === undefined) {
      // 没有可用凭据的账号不可能自行恢复：`missingCredential` 负责记入拒绝表
      // （`invalid-credential` 只能被显式清除），否则每次请求都会重新选中它并再次失败。
      ledger.note(host.missingCredential(ref));
      if (ledger.reachedMax()) ledger.throwExhausted(() => host.noAccount(options.model));
      continue;
    }

    const counts = emptyCounts();
    let emitted = false;
    let totalTokens = 0;
    /** usage 块延后发送（opencode）：避免「先报用量、随后整轮失败」。 */
    let pendingUsage: StreamChunk | undefined;
    const pump: StreamPumpState = { text: "", sawToolCall: false, lastBlockIndex: -1 };

    // 逐次索取上游：**只有** `iterator.next()` 的失败算本次尝试的失败；
    // 消费方在 `yield` 处的中断/抛错原样冒泡，不会被当成厂商失败而重放。
    const iterator = host.attempt(config, options, credential, attemptContext)[Symbol.asyncIterator]();
    let failure: unknown;
    let exhausted = false;
    try {
      for (;;) {
        let step: IteratorResult<StreamChunk>;
        try {
          step = await iterator.next();
        } catch (error) {
          failure = error;
          break;
        }
        if (step.done === true) {
          exhausted = true;
          break;
        }
        let chunk = step.value;

        // 累计状态：**只收正文**（推理不算判断工具调用的依据，见 StreamPumpState.text）、
        // 工具调用出现与否、最大块序号。
        if (chunk.type === "text-delta") pump.text += chunk.text;
        if (chunk.type === "tool-call-delta" || (chunk.type === "block-start" && chunk.blockType === "tool-call")) {
          pump.sawToolCall = true;
        }
        if (chunk.type === "block-start" || chunk.type === "block-end" || chunk.type === "tool-call-delta") {
          if (chunk.index > pump.lastBlockIndex) pump.lastBlockIndex = chunk.index;
        }
        if (chunk.type === "block-end" && chunk.block.type === "tool-call") pump.sawToolCall = true;

        if (chunk.type === "usage") {
          // usage 不算「已输出」：它只说明这个账号已经产生了计费，由 `totalTokens` 表达。
          totalTokens += usageTotal(chunk.usage);
          counts.inputTokens += chunk.usage.inputTokens ?? 0;
          counts.outputTokens += chunk.usage.outputTokens ?? 0;
          counts.cacheReadTokens += chunk.usage.cacheReadTokens ?? 0;
          counts.cacheWriteTokens += chunk.usage.cacheWriteTokens ?? 0;
          if (host.deferUsage === true) {
            pendingUsage = chunk;
            continue;
          }
        }

        const rewritten = host.onChunk?.(pump, chunk);
        if (rewritten !== undefined) {
          if (pendingUsage !== undefined) {
            yield pendingUsage;
            pendingUsage = undefined;
          }
          for (const replacement of rewritten) {
            emitted = true;
            yield replacement;
          }
          continue;
        }

        if (pendingUsage !== undefined) {
          yield pendingUsage;
          pendingUsage = undefined;
        }
        if (!(chunk.type === "usage" && host.usageCountsAsEmitted === false)) emitted = true;
        yield chunk;
      }
    } finally {
      if (!exhausted) {
        // 与 `runStream` 同一条纪律：只发关闭请求，不等它完成。
        const closing = iterator.return?.(undefined);
        if (closing !== undefined) void closing.catch(() => {});
      }
    }

    if (exhausted) {
      if (pendingUsage !== undefined) yield pendingUsage;
      // 请求由这个账号**服务完了**：记一次成功，卡片跟随真实账号。
      host.noteSettled(ref);
      host.recordUsage(ref, options.model, "success", counts);
      // 服务成功的不是本轮首选 → 它是备用账号：报告给装配层提位。提位失败不影响结果。
      if (firstPick !== undefined && ref !== firstPick) host.promoteServed?.(ref);
      return;
    }

    if (options.signal?.aborted === true || host.isAbort(failure)) {
      // 用户主动取消：不算厂商失败，但 token 已经花掉了 —— 仍然记一条。
      host.recordUsage(ref, options.model, "failure", counts, "aborted");
      throw failure;
    }
    const classified = await host.classify(failure, attemptContext);
    if (classified === undefined) {
      // 请求级拒绝：换账号没有意义（同样的请求发给谁都一样）。
      host.recordUsage(ref, options.model, "failure", counts, "request");
      // 有的厂商在这里要换一个宿主认识的稳定终态码再抛（opencode 的 pi-ai 证据）。
      throw host.wrapRequestLevelError?.(failure) ?? failure;
    }
    host.rotation.markRejected(ref, classified.rejection);
    ledger.note(classified);
    host.recordUsage(ref, options.model, "failure", counts, classified.rejection.kind);
    // 唯一的换账号条件：已输出 / 已消耗 token / 已中止都不换。
    if (!host.rotation.fallbackAllowed({ emitted, totalTokens, aborted: false })) throw classified.thrown;
    if (ledger.reachedMax()) ledger.throwExhausted(() => host.noAccount(options.model));
  }
}
