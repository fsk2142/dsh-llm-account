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
 * 这种控件「改了就存」还是「留在草稿里等卡片上的保存按钮」。
 *
 * 需求 的两条要求合起来是这一条规则：
 * 1. 「任何选项修改了就是直接保存，不需要那个保存按钮了」→ 开关/下拉：一次点击就是完整决定；
 * 2. 「输入框那个…一个卡片保留一个保存按钮，点完保存后按钮消失，如果复原则不显示保存」
 *    → 文本/数字/时长：键盘输入是**过程**不是决定，所以留在草稿里，由**所在卡片**的保存按钮
 *    提交；没有未保存输入时那个按钮根本不渲染。
 *
 * 为什么输入类不能每敲一个字符就写：(a) 中间态会进设置文档（`https://` 会短暂成为生效值）；
 * (b) 打字比一次往返快得多，后一次写入拿着过期修订号，会撞上自己刚写出来的冲突。
 *
 * 放在注册表旁边：这是「控件语义」，不是某个页面的排版选择。
 * @param kind - 字段的控件种类。
 * @returns 是否改了就立刻写入设置文档。
 */
export function savesImmediately(kind: FieldKind): boolean {
  return kind === "boolean" || kind === "select";
}

/**
 * `models` 类型使用说明：一个**逗号分隔的模型 id 输入框**。
 *
 * 为什么不是勾选列表：页面拿不到模型目录（那是各厂商适配器的读口，容器没往下传），
 * 而白名单的语义是「出错时允许自动换到哪些模型」——用户通常只填一两个名字，
 * 手输比在一长串目录里翻找更快。写库前会清洗（去空白、丢空串、去重）。
 */

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
  /** 从目录里移除、暂时不显示的模型字段名（`removedModels`）。 */
  removed: string;
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
