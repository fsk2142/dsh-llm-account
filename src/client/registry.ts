/**
 * Client-side **vendor registry** — the module-level singleton shared by every
 * plugin instance of this package.
 *
 * The host loads ONE client bundle (`lib/client.js`, id `dsh-llm-account`) and
 * mounts it once per profile row (`llm-commandcode`, `opencode-go`). Both rows
 * therefore resolve to the same module instance, so a registry declared here is
 * shared by both `apply` calls. That matters for the one `settings.section`
 * page (see `shell.ts`) and for nothing else: per the controller's
 * vendor-discovery ruling, this package cannot tell which vendor a given
 * `apply` call belongs to, so the page discovers vendors from the settings
 * namespaces that exist (`remote.settings.describe()`) and uses this registry
 * only for the vendor metadata that discovery cannot provide (display order,
 * locale key).
 *
 * @module dsh-llm-account/src/client/registry
 */

/** 通用字段卡片的三组（规格 §8 的卡片顺序，厂商专属内容各自声明）。 */
export type CardGroupId = "switch" | "privacy" | "integrations" | "advanced";

/** 字段的控件种类（页面按它渲染，不认识的一律不渲染）。 */
export type FieldKind = "boolean" | "text" | "number" | "select" | "duration";

/**
 * 一个设置字段的声明。
 *
 * `key` 是**设置文档里的真实字段名**：页面不发明字段，厂商没声明的组不渲染（预检 Ruling 1）。
 * `fallback` 是该字段的声明默认值，用于「默认关闭」这类断言 —— 它是**声明**，不是读到的当前值；
 * 当前值来自宿主设置文档。
 */
export interface FieldSpec {
  /** 设置文档里的字段名。 */
  key: string;
  kind: FieldKind;
  /** 标签文案键（`copy.ts`）。 */
  labelKey: string;
  /** 说明文案键；没有说明时不渲染提示。 */
  hintKey?: string;
  /** `select` 的选项与各自的文案键，按展示顺序。 */
  options?: readonly { value: string; labelKey: string }[];
  /** 声明默认值；`undefined` 表示没有默认（例如可选超时）。 */
  fallback?: unknown;
}

/** 一组通用字段卡片。 */
export interface CardGroupSpec {
  group: CardGroupId;
  /** 该组要渲染的字段，按展示顺序。空数组的组**不渲染**。 */
  fields: readonly FieldSpec[];
}

/**
 * 模型可见性的字段声明。
 *
 * 存在 = **这家支持模型卡片**；不声明 = 不渲染该卡片（规格 §8 的「厂商不支持的卡片不渲染」）。
 * 两个字段名都是设置文档里的真实字段（与各厂商的 Config schema 一致）。
 */
export interface ModelsSpec {
  /** 「只显示这些模型」白名单字段名（`visibleModels`）。 */
  visible: string;
  /** 逐模型显隐字段名（`modelVisibility`）。 */
  visibility: string;
}

/** The two provider routes this package hosts (`src/core/adapter.ts` `VendorId`). */
export interface VendorEntry {
  /** Settings namespace — the vendor's stable identity here (`llm-commandcode` / `llm-opencode-go`). */
  ns: string;
  /**
   * 宿主上这一行可能出现的**设置行名**（按优先级）。
   *
   * 页面靠它认出厂家的设置文档（Ruling 2 的「按设置命名空间发现」）。opencode 的**行 id 与核心
   * 命名空间不同**（`opencode-go` vs `llm-opencode-go`，见宿主侧 `SETTINGS_ROWS`），所以这里必须
   * 列出两个候选 —— 少了它，opencode 的标签页在真机上永远不出现（这条由测试抓出来）。
   */
  rowIds: readonly string[];
  /** Image/model route id (`commandcode` / `dsh-opencode-go`), for later tasks' remote calls. */
  providerId: string;
  /** Page-side tab order (ascending). */
  order: number;
  /** Key into the page's locale namespace for this vendor's tab label. */
  labelKey: string;
  /**
   * 该厂商声明的通用字段卡片（隐私与安全 / 集成与显示 / 高级设置）。
   *
   * 必须显式给出（哪怕是空数组）：页面的规则是「厂商未声明的组不渲染」，所以「这家没有这一组」
   * 与「忘了声明」必须是能区分开的两种状态。
   */
  cards: readonly CardGroupSpec[];
  /** 模型可见性声明；不声明表示这家不渲染模型卡片。 */
  models?: ModelsSpec;
}

/** Registrations keyed by settings namespace: a namespace names exactly one vendor. */
const vendorRegistry = new Map<string, VendorEntry>();

/**
 * Register (or update) one vendor. Idempotent by `ns`: a namespace maps to one
 * vendor, so re-registering the same vendor never produces a duplicate entry.
 * @param entry - the vendor metadata.
 */
export function registerVendor(entry: VendorEntry): void {
  vendorRegistry.set(entry.ns, entry);
}

/**
 * The registered vendors, in tab order.
 * @returns a fresh array (callers cannot mutate the registry by accident).
 */
export function vendors(): VendorEntry[] {
  return [...vendorRegistry.values()].sort((left, right) => left.order - right.order);
}

/**
 * Forget every registration.
 *
 * Test isolation hook: the registry is module state, so a test that observes
 * `apply` must start from a known state. Production code never calls it.
 */
export function resetRegistry(): void {
  vendorRegistry.clear();
}
