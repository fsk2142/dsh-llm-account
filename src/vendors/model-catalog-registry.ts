/**
 * **跨厂商模型清单**的宿主侧注册表：限额换模型时用来找「同名模型」。
 *
 * 为什么需要它：每个 adapter 只认识自己那一家（`registerAdapter` 给的是单个 provider），
 * 而「换到别家的同名模型」必须知道另外两家有哪些模型。三条 provider 行在同一个进程里跑，
 * 各自 `apply` 时把自己的目录读口登记进来，谁要换模型就查这份合并清单。
 *
 * 纪律：
 * - 纯登记，不做网络：读口由各行的适配器提供（`catalogModels`），本模块只负责合并且
 *   带一次短 TTL 缓存（换模型是**失败路径**上的事，不该每次失败都打三次目录端点）；
 * - 登记用 `provider` 作键，重复登记覆盖（同一行重载时不该出现两份）；
 * - 任何读口失败都只是「这家这次没有候选」，不影响别家。
 * @module dsh-llm-account/src/vendors/model-catalog-registry
 */

import { isOfficialProvider, isSwitchableProvider } from "../core/switching/model-fallback";

/** 一家的目录读口 **+ 流式委托**。 */
export interface CatalogSource {
  /** provider 路由 id（`commandcode` / `dsh-opencode-go` / `opendesign`）。 */
  provider: string;
  /**
   * 读该家的模型 id 列表。
   *
   * 必须返回**用户可选范围内**的模型（宿主模型选择器里能选到的那些）—— 换模型只能在用户
   * 已经允许的模型之间换，否则会切到一个他明确关掉的模型上
   *。
   */
  models: () => Promise<readonly CatalogRow[]>;
  /**
   * 用**这一家**发一次流式请求（跨厂商换模型的执行入口）。
   *
   * 为什么必须由注册表提供：宿主的 `GenerateOptions.provider` 由路由决定，一个 adapter
   * **不能**改它去别家发请求（宿主只把对应路由的调用投给它）。所以「换到别家的同名模型」
   * 只能由目标那一家的 adapter 自己来发 —— 这里登记它的 `stream`，编排层
   * （{@link delegateStream}）负责把请求转过去。
   *
   * 缺省表示这家不支持被跨厂商委托（那就只能同家换）。
   */
  stream?: (options: unknown) => AsyncIterable<unknown>;
  /**
   * 这家**当前是否可用**（2026-11-04 外部审查 U08）。
   *
   * `enabled: false` 只撤下宿主路由，注册表里的 `stream` 仍在 —— 于是「换模型」
   * 路径照样能把请求转给一家用户明确关掉的厂商。登记这个查询后：
   *
   * 1. {@link modelCandidates} 不再把禁用厂商的模型列进候选；
   * 2. {@link delegateStream} 执行前**再复核一次** —— 缓存里的旧候选也拦得住。
   *
   * 缺省视为「可用」：与 `enabled` 的缺省语义一致（只有显式 `false` 才撤下）。
   */
  available?: () => boolean;
  /** Current model visibility, rechecked immediately before delegation. */
  allowsModel?: (model: string) => boolean;
}

/** 一个候选：provider + model。 */
/** 一家目录里的一行：id 必填，能力信息**有则带上**（供换模型时比较「接近度」）。 */
export interface CatalogRow {
  id: string;
  /** 上下文窗口（token）；厂商没公布时缺省。 */
  contextWindow?: number;
  /** 推理档位数量；没公布时缺省。 */
  effortCount?: number;
  /**
   * 该模型支持的输入模态（`["text"]` / `["text","image"]` …）；厂商没公布时缺省。
   *
   * 缺省表示**我们不知道**，不是「不支持」—— 换模型时据此排除会误伤没公布模态的模型
   * （详见 `pickFallbackModel` 的 `requiresImages` 注释）。
   */
  inputModalities?: readonly string[];
}

/** 一个候选：provider + model + 可选能力信息。 */
export interface ModelCandidate {
  provider: string;
  model: string;
  contextWindow?: number;
  effortCount?: number;
  /** 该模型支持的输入模态；缺省表示厂商没公布。 */
  inputModalities?: readonly string[];
}

/** 合并清单的缓存新鲜期（毫秒）：一分钟。失败路径上的目录查询不该每次都打三个端点。 */
const CACHE_TTL_MS = 60_000;

/** 已登记的读口（provider → source）。 */
const sources = new Map<string, CatalogSource>();

/** Store each gateway separately so a fresh list from one cannot mask another. */
const cache = new Map<string, { at: number; value: ModelCandidate[] }>();
let generation = 0;

/** Capture before reading a picker catalog so it cannot publish across a settings change. */
export function catalogCandidateRevision(): number {
  return generation;
}

export function registerCatalogSource(source: CatalogSource): void {
  if (!isSwitchableProvider(source.provider)) return;
  sources.set(source.provider, source);
  invalidateCatalogCandidates();
}

function fresh(provider: string, now: number): { at: number; value: ModelCandidate[] } | undefined {
  const entry = cache.get(provider);
  return entry !== undefined && now - entry.at < CACHE_TTL_MS ? entry : undefined;
}

function allowsModel(provider: string, model: string): boolean {
  const source = sources.get(provider);
  return source?.available?.() !== false && source?.allowsModel?.(model) !== false;
}

function store(provider: string, rows: readonly CatalogRow[], now: number): void {
  const value = rows.flatMap((row): ModelCandidate[] => {
    if (typeof row.id !== "string" || row.id.trim() === "" || !allowsModel(provider, row.id)) return [];
    return [{
      provider,
      model: row.id,
      ...(row.contextWindow === undefined ? {} : { contextWindow: row.contextWindow }),
      ...(row.effortCount === undefined ? {} : { effortCount: row.effortCount }),
      // 模态也一起缓存：换模型时要用它判断「目标能不能吃图」（审查 A06）。
      ...(row.inputModalities === undefined ? {} : { inputModalities: row.inputModalities }),
    }];
  });
  cache.set(provider, { at: now, value });
}

/** Read any registered gateway whose cached list is missing or expired. */
export async function modelCandidates(now: number = Date.now()): Promise<ModelCandidate[]> {
  const started = generation;
  await Promise.all([...sources.values()].map(async (source) => {
    if (fresh(source.provider, now) !== undefined) return;
    try {
      if (source.available?.() === false) return;
      const rows = await source.models();
      if (started === generation) store(source.provider, rows, now);
    } catch {
      // Cache this failed read independently without masking other gateways.
      if (started === generation && fresh(source.provider, now) === undefined) store(source.provider, [], now);
    }
  }));
  return cachedModelCandidates(now) ?? [];
}

/** Return only fresh cached candidates without contacting any gateway. */
export function cachedModelCandidates(now: number = Date.now()): ModelCandidate[] | undefined {
  const values: ModelCandidate[] = [];
  let found = false;
  for (const provider of cache.keys()) {
    const entry = fresh(provider, now);
    if (entry === undefined) continue;
    found = true;
    for (const candidate of entry.value) {
      if (allowsModel(provider, candidate.model)) values.push(candidate);
    }
  }
  return found ? values : undefined;
}

/** Reuse the visible models read by a gateway's normal model picker. */
export function noteCatalogModels(
  provider: string,
  models: readonly CatalogRow[],
  now: number = Date.now(),
  revision = generation,
): void {
  if (revision !== generation || !isSwitchableProvider(provider)) return;
  const source = sources.get(provider);
  if (source?.available?.() === false) {
    store(provider, [], now);
    return;
  }
  // The picker may have started before a visibility change. Its old rows are
  // evidence that this list is obsolete, so leave any newer list alone.
  if (models.some((row) => source?.allowsModel?.(row.id) === false)) return;
  store(provider, models, now);
}

/** Settings changed. Drop cached rows and prevent old in-flight reads from restoring them. */
export function invalidateCatalogCandidates(): void {
  generation += 1;
  cache.clear();
}

/** Reset the registry for test isolation. */
export function resetCatalogSources(): void {
  sources.clear();
  invalidateCatalogCandidates();
}

/**
 * 把一次请求**委托给另一家**（跨厂商换模型的执行层）。
 *
 * 为什么需要这一层：宿主的 `GenerateOptions.provider` 由路由决定，adapter 不能改它 ——
 * 一个 commandcode 的 adapter 无法「以 opendesign 的身份」发请求。所以换到别家同名模型时，
 * 必须由**目标那一家的 adapter** 自己去发。这里就是那个转接点：查注册表拿到目标家的
 * `stream`，把 `options` 的 `provider` 改成目标家再调过去。
 *
 * 安全约束：
 * - 目标家必须**已登记且提供了 `stream`**（否则返回 `undefined`，调用方按「换不了」处理）；
 * - 目标家必须**不是官方直连**（`isOfficialProvider` 由调用方在挑候选时已排除，这里再挡一次
 *   作为纵深防御）；
 * - 只换 `provider` / `model` 两个字段，其余（消息、工具、signal）**原样透传** —— 请求语义
 *   不该因为换了家而变。
 * @param target - 目标 (provider, model)。
 * @param options - 原始请求（形状由调用方保证；本层只做字段替换）。
 * @returns 目标家的 chunk 流；不能委托时为 `undefined`。
 */
export function delegateStream(
  target: ModelCandidate,
  options: Record<string, unknown>,
): AsyncIterable<unknown> | undefined {
  /**
   * **白名单闸门**（2026-11-08，需求「只准在三个网关之间切换」）。
   *
   * 放在 `sources.get` **之前**：即使有别的插件把自己的 `stream` 登记进来，
   * 也不该从我们这条路径被当成切换目标。判据与 `pickFallbackModel` 是同一个函数，
   * 两处不会分叉。
   */
  if (!isSwitchableProvider(target.provider)) return undefined;
  const source = sources.get(target.provider);
  if (source === undefined || source.stream === undefined) return undefined;
  /**
   * **执行前复核一次可用性**（2026-11-04 外部审查 U08）。
   *
   * 光在 {@link modelCandidates} 里过滤还不够：候选清单有 60 秒缓存，
   * 用户在这段时间里关掉厂商，缓存里的旧候选仍然会把请求转过去。
   * 这一行保证「禁用之后立刻不会再被调用」。
   */
  if (!allowsModel(target.provider, target.model)) return undefined;
  if (isOfficialProvider(target.provider)) return undefined;
  return source.stream({ ...options, provider: target.provider, model: target.model });
}

/**
 * 这家能不能被跨厂商委托（已登记且有 `stream`）。
 * @param provider - provider 路由 id。
 * @returns 能否委托。
 */
export function canDelegate(provider: string): boolean {
  const source = sources.get(provider);
  return source !== undefined && source.stream !== undefined;
}
