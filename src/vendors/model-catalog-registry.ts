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

import { isOfficialProvider } from "../core/model-fallback";

/** 一家的目录读口 **+ 流式委托**。 */
export interface CatalogSource {
  /** provider 路由 id（`commandcode` / `dsh-opencode-go` / `opendesign`）。 */
  provider: string;
  /**
   * 读该家的模型 id 列表。
   *
   * 必须返回**用户可选范围内**的模型（宿主模型选择器里能选到的那些）—— 换模型只能在用户
   * 已经允许的模型之间换，否则会切到一个他明确关掉的模型上
   * （2026-10-19 用户要求「根据当前的可选模型配置切换模型名单」）。
   */
  models: () => Promise<readonly string[]>;
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
}

/** 一个候选：provider + model。 */
export interface ModelCandidate {
  provider: string;
  model: string;
}

/** 合并清单的缓存新鲜期（毫秒）：一分钟。失败路径上的目录查询不该每次都打三个端点。 */
const CACHE_TTL_MS = 60_000;

/** 已登记的读口（provider → source）。 */
const sources = new Map<string, CatalogSource>();

/** 上次合并的结果与时刻。 */
let cached: { at: number; value: ModelCandidate[] } | undefined;

/**
 * 登记一家的目录读口（幂等：同一个 provider 再登记就覆盖）。
 * @param source - 该家的读口。
 */
export function registerCatalogSource(source: CatalogSource): void {
  sources.set(source.provider, source);
  // 目录可能变了，缓存作废。
  cached = undefined;
}

/**
 * 注销一家的读口（该行卸载时调用）。
 * @param provider - 要摘掉的 provider。
 */
export function unregisterCatalogSource(provider: string): void {
  if (sources.delete(provider)) cached = undefined;
}

/**
 * 取合并后的候选清单（带一次短 TTL 缓存）。
 *
 * 读失败的那一家只是缺席，不影响别家 —— 换模型是尽力而为的补救，不该因为某家目录读不到
 * 就把整次补救也废掉。**只收已登记且读成功的**；一条都没有时返回空数组。
 * @param now - 时钟（测试注入）。
 * @returns 候选清单；同一份缓存在 TTL 内复用。
 */
export async function modelCandidates(now: number = Date.now()): Promise<ModelCandidate[]> {
  if (cached !== undefined && now - cached.at < CACHE_TTL_MS) return cached.value;
  const listed = await Promise.all(
    [...sources.values()].map(async (source) => {
      try {
        const ids = await source.models();
        return ids.map((model): ModelCandidate => ({ provider: source.provider, model }));
      } catch {
        // 这一家的目录读不到：它这次没有候选。
        return [];
      }
    }),
  );
  const value = listed.flat();
  cached = { at: now, value };
  return value;
}

/**
 * 取**已经缓存**的候选清单；没有缓存时返回 `undefined`（**不发起任何请求**）。
 *
 * 为什么需要这个变体：换模型是失败路径上的补救，而它前面可能已经有一次注定失败的原因
 * （一条凭据都没解析到）。那种情况下再去打三家的目录端点纯属浪费 —— 而「连密钥都没有」
 * 是用户报障里最需要保持安静的场景（不该为一次必然失败的请求产生额外网络流量）。
 * @param now - 时钟（测试注入）。
 * @returns 缓存中的候选；缓存过期或从未读过时为 `undefined`。
 */
export function cachedModelCandidates(now: number = Date.now()): ModelCandidate[] | undefined {
  if (cached === undefined) return undefined;
  if (now - cached.at >= CACHE_TTL_MS) return undefined;
  return cached.value;
}

/**
 * 直接写入某一家已知的模型清单（零额外请求）。
 *
 * 这是缓存**真正的填充路径**：各家的适配器本来就会为了「模型选择器」读目录（`listModels` /
 * `catalogModels`），读成功后把结果顺手交进来即可。这样换模型永远走缓存，既不预热、也不在
 * 失败路径上打网络。
 * @param provider - provider 路由 id。
 * @param models - 该家的模型 id 列表。
 * @param now - 时钟（测试注入）。
 */
export function noteCatalogModels(provider: string, models: readonly string[], now: number = Date.now()): void {
  const value = cached === undefined ? [] : [...cached.value];
  // 先摘掉这一家的旧条目，再追加新的（同一家重复调用不会累积）。
  const kept = value.filter((candidate) => candidate.provider !== provider);
  for (const model of models) {
    if (model.trim() !== "") kept.push({ provider, model });
  }
  cached = { at: now, value: kept };
}

/**
 * 后台预热候选清单（`apply` 期调一次）。
 *
 * 为什么要预热：换模型走**缓存优先**（{@link cachedModelCandidates}），从不因为一次失败去
 * 现打三家目录端点。但缓存得有东西 —— 所以在启动时安静地读一次（失败只记日志）。
 *
 * 为什么可以接受这次读：目录数据本来就要为「模型选择器」准备，三条 provider 行各自维护一份；
 * 这里只是在启动时提前触发，而不是在失败路径上现读。
 * @param onError - 失败回调（缺省静默）。
 * @returns 预热完成的 promise（测试可 await；生产不等待）。
 */
export function primeModelCandidates(onError?: (error: unknown) => void): Promise<void> {
  return modelCandidates().then(
    () => undefined,
    (error: unknown) => {
      onError?.(error);
    },
  );
}

/** 复位（测试隔离；生产不会调用）。 */
export function resetCatalogSources(): void {
  sources.clear();
  cached = undefined;
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
  const source = sources.get(target.provider);
  if (source === undefined || source.stream === undefined) return undefined;
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
