/**
 * 搜索关闭时**让出**宿主的 `web.searchProvider` 槽位（2026-10-23）。
 *
 * ## 为什么需要（用户报障的场景）
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
 * **只在用户切到 `off` 的那一刻改一次配置**（用户 2026-10-23 的选择），把
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

/** 本插件注册的搜索 provider id（宿主注册表的键）。 */
export const SEARCH_PROVIDER_ID = "llm-account-deepseek";

/** 宿主 `web` 行的固定 id（`cordis.patch.yml` 里的 `- id: web`）。 */
export const WEB_ROW_ID = "web";

import type { SettingsPort } from "../core/adapter";

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

  if (disabled) {
    // 已经是空的了：没有可让的槽位。
    if (current === undefined || current === "") return false;
    // 只在**指向本插件**时让位 —— 用户可能显式指向了别人的 provider，那不关我们的事。
    if (current !== SEARCH_PROVIDER_ID) return false;
    try {
      await settings.mutate(WEB_ROW_ID, [{ op: "set", path: [FIELD], value: "" }], snapshot.revision);
      return true;
    } catch (error) {
      warn(`[dsh-llm-account] 未能让出 web.searchProvider（搜索已关闭，但宿主仍会把它交给我们）：${String(error)}`);
      return false;
    }
  }

  // 启用态：只在本插件曾被让位（值为空）时写回，绝不覆盖用户的显式选择。
  if (current === undefined || current === "") {
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
