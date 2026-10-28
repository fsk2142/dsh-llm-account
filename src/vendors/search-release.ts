/**
 * 搜索关闭时**让出**宿主的 `web.searchProvider` 槽位（2026-10-23）。
 *
 * ## 为什么需要（实际情况的场景）
 *
 * 用户的 profile 里显式写着：
 *
 * ```yaml
 * - id: web
 *   config:
 *     searchProvider: llm-account-deepseek
 * ```
 *
 * 宿主的选路是「按 id 精确匹配，命中就用」：
 *
 * ```js
 * if (configuredId !== undefined) {
 *   const provider = providers.get(configuredId);
 *   if (!provider) throw new WebError("not registered");
 *   if (!provider.available()) throw new WebError("registered but unavailable");
 *   return provider;
 * }
 * ```
 *
 * 于是三种坏结果：
 *
 * 1. 用户在本插件里选了 `off`（不启用网页搜索）→ `search()` 抛
 *    「网页搜索已被关闭」，**但宿主仍然把请求交给本插件**，别的搜索插件排不上队；
 * 2. 用户装了第二个搜索插件、又删掉 `searchProvider` 行 → 本插件
 *    `available()` 恒为 `true`，两个都「可用」→ 宿主报
 *    `WEB_PROVIDER_AMBIGUOUS`，**两个都用不了**；
 * 3. 用户既选 `off` 又装别的插件 → 组合了上面两条。
 *
 * ## 做法
 *
 * **只在用户切到 `off` 的那一刻改一次配置**，把
 * `web` 行的 `searchProvider` 置空 —— 于是宿主走「未指定 id」的选路：
 *
 * - 只注册了一个 provider → 用它（这时可能是别的插件，正是用户想要的）；
 * - 一个都没有 → 报 `no usable web provider`（诚实，不是静默失败）。
 *
 * 切回任何启用态时再把值写回本插件的 id，恢复原来的绑定。
 *
 * ## 为什么不在启动时校准（有意为之）
 *
 * 启动时改配置意味着「每次开 DSH 都可能写一次 profile」，而用户看配置文件时
 * 会以为那是自己写的。只在**用户动作**的瞬间改，因果关系清楚。
 *
 * @module dsh-llm-account/src/vendors/search-release
 */

import type { SettingsPort } from "../core/adapter";
import { SEARCH_PROVIDER_ID } from "./search-provider";

/**
 * 本插件注册的搜索 provider id —— 从 `search-provider.ts` 复用，**不要在这里再写一份**。
 *
 * 2026-10-26 修审查 LOW-C：原来两处各写 `"llm-account-deepseek"` 字面量，改一处忘
 * 另一处会让「让出 / 收回」逻辑与注册 id 失配 —— 表现是槽位同步静默失效（不报错，
 * 但 `searchProvider` 永远对不上真实注册的 id）。
 */
export { SEARCH_PROVIDER_ID };

/** 宿主 `web` 行的固定 id（`cordis.patch.yml` 里的 `- id: web`）。 */
export const WEB_ROW_ID = "web";

/**
 * 宿主自带的搜索 provider id（`dsh-web-search-deepseek` 注册的那个）。
 *
 * 写死而不是运行时发现：`dsh-web` 只暴露 `registerSearchProvider` / `search` /
 * `fetch`，**没有枚举接口**（`searchProviders` 是私有 Map）。插件侧拿不到「现在有
 * 哪些 provider」，只能记住已知的 id。
 *
 * 这也是 dsh-base bundle 里 `web.searchProvider` 的默认值 —— 我们把槽位让回给它，
 * 等价于「回到出厂状态」。
 */
export const HOST_DEFAULT_SEARCH_PROVIDER = "deepseek-official";

/**
 * 让位时写回的值。
 *
 * **不能写空串**（2026-10-28 修）：空串让宿主走「未指定 id」的自动选路，而我们和
 * 宿主的 `deepseek-official` 都注册了 —— 两个都 `available()` 时报
 * `WEB_PROVIDER_AMBIGUOUS`，**两个都用不了**。那正是用户报的「关掉我们的搜索后，
 * 自带的也用不了」。
 *
 * 写回宿主默认 id 则明确指向它：即使我们也注册着，选路是精确匹配，不会歧义。
 */
const RELEASE_TARGET = HOST_DEFAULT_SEARCH_PROVIDER;

/**
 * 写设置时用到的端口形状。
 *
 * 直接复用 `SettingsPort` —— 它的 `describe` / `mutate` 都按**profile 行 id** 取参数
 * （`assembly.ts` 的 `createSettingsPort` 实测如此），所以能操作 `web` 那一行，
 * 不需要另写一个跨命名空间的端口。
 */
export type SearchReleaseSettings = SettingsPort;

/** `web` 行配置里我们关心的那一个字段。 */
const FIELD = "searchProvider";

/**
 * 从 `describe` 的返回值里读出 `searchProvider` 的现值。
 * @param value - `web` 行的配置对象（形状不可信）。
 * @returns 现值；缺失或不是字符串时为 `undefined`。
 */
function configuredProviderOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = (value as Record<string, unknown>)[FIELD];
  return typeof raw === "string" ? raw : undefined;
}

/**
 * 按当前策略校准 `web.searchProvider`。
 *
 * - 策略是 `off` 且当前值指向本插件 → 置空（让出槽位）；
 * - 策略不是 `off` 且当前值为空 → 写回本插件 id（恢复绑定）；
 * - 其它组合一律**不动**（用户显式指向别的插件时，绝不抢）。
 *
 * @param input - 设置端口、策略读取器与可选的日志函数。
 * @returns 是否真的改了配置（测试与调用方据此决定是否提示用户）。
 */
export async function syncSearchProviderSlot(input: {
  settings: SearchReleaseSettings;
  /** 当前搜索策略的读取器（形状不可信，内部自己判定）。 */
  strategy: () => unknown;
  /** 写失败时的日志出口；缺省 `console.warn`。 */
  warn?: (message: string) => void;
}): Promise<boolean> {
  const { settings, strategy } = input;
  const warn = input.warn ?? ((message: string) => console.warn(message));

  let snapshot: { value: unknown; revision: number };
  try {
    snapshot = await settings.describe(WEB_ROW_ID);
  } catch {
    // 没有 `web` 行（没装 dsh-web）或读失败：不归我们管，静默返回。
    return false;
  }

  const current = configuredProviderOf(snapshot.value);
  const disabled =
    typeof strategy() === "string" && (strategy() as string).trim().toLowerCase() === "off";

  /**
   * **关闭态：把槽位让回宿主自带的 provider**（2026-10-28 修正）。
   *
   * 旧行为是写空串，期望宿主走「未指定 id」的自动选路 —— 但那条路有个致命前提：
   * **恰好一个** provider 可用。我们又注册着（关闭态的模型外调用仍可能触发搜索），
   * 宿主自带的 `deepseek-official` 也在，于是 `available()` 两个都真 →
   * `WEB_PROVIDER_AMBIGUOUS` → **两个都用不了**。
   *
   * 用户的原话是「关掉自己的搜索就要自动切到软件自带的，除非两边都没启用」。所以：
   *
   * 1. 关掉我们的 → 把 `searchProvider` 写回宿主默认 id（精确匹配，无歧义）；
   * 2. 已经是宿主默认 id → 无事可做；
   * 3. 指向别的第三方 provider → **不动**（用户的选择，可能是别家插件）。
   */
  if (disabled) {
    // 已经指向宿主默认：无需动作（这是期望的终态）。
    if (current === RELEASE_TARGET) return false;
    // 空串 / 未配置：也补成宿主默认 —— 否则「两边都没启用」的用户会落到
    // `WEB_PROVIDER_UNAVAILABLE`，而宿主其实自带一个能用的。
    const needsFix = current === undefined || current === "" || current === SEARCH_PROVIDER_ID;
    if (!needsFix) return false; // 指向第三方：不关我们的事
    const nextValue = RELEASE_TARGET;
    try {
      await settings.mutate(WEB_ROW_ID, [{ op: "set", path: [FIELD], value: nextValue }], snapshot.revision);
      return true;
    } catch (error) {
      warn(`[dsh-llm-account] 未能把 web.searchProvider 让回 ${RELEASE_TARGET}（搜索已关闭）：${String(error)}`);
      return false;
    }
  }

  /**
   * **启用态：把槽位拿回来**（2026-10-28 修正）。
   *
   * 判据从「只认显式空串」放宽为「空串 / 未配置 / 指向宿主默认」——
   * 因为关闭态现在把值写成 `RELEASE_TARGET`（宿主默认 id），不再是空串。
   * 不这样改的话，「关一次再开」会让槽位永远留在宿主那边，我们的搜索启用了却不生效。
   *
   * 仍然**不动**指向第三方的配置（用户显式选了别家插件）。
   */
  const oursToTake =
    current === undefined || current === "" || current === RELEASE_TARGET;
  if (oursToTake) {
    try {
      await settings.mutate(
        WEB_ROW_ID,
        [{ op: "set", path: [FIELD], value: SEARCH_PROVIDER_ID }],
        snapshot.revision,
      );
      return true;
    } catch (error) {
      warn(`[dsh-llm-account] 未能恢复 web.searchProvider 绑定：${String(error)}`);
      return false;
    }
  }
  return false;
}
