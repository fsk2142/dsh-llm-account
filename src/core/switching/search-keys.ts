/**
 * 搜索 key 的**引用名列表**与轮替规则（纯函数）。
 *
 * ## 为什么是「多引用名」而不是「多把明文 key」
 *
 * 密钥只经凭据服务进出，设置文档里**永远不落明文**（项目全局约束）。所以「多个 key」
 * 的实现方式是：设置里存**多个引用名**，每个引用名在凭据库里对应一把真 key。
 *
 * ## 轮替规则（为什么只对 401/402 换 key）
 *
 * - **401 无效 / 402 余额不足**：换下一条，那条可能还能用 —— 这是多 key 的**唯一目的**；
 * - **429 限流 / 5xx**：换 key 也一样（限速按账号、服务端错误与 key 无关），白折腾还多花钱；
 * - **400 参数错**：请求本身有问题，换谁都一样。
 *
 * @module dsh-llm-account/src/core/switching/search-keys
 */

/**
 * 清洗一份 key 引用名列表。
 *
 * 设置文档的形状不可信：可能是 `undefined`、字符串、含非字符串元素的数组。
 * 空串/纯空白一律丢掉（空引用名会解析到不存在的凭据），重复项去重但**保留首次出现的顺序**
 * —— 那个顺序就是用户的优先级。
 * @param raw - 设置文档里的原始值。
 * @returns 清洗后的引用名列表。
 */
export function normalizeSearchKeyRefs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed === "") continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/**
 * 一个引用名是否「可解析」的形状（与项目其它凭据引用同一条纪律）。
 *
 * 不允许空格、不允许以 `-` 开头（那会被命令行当成选项）、长度 1–64。
 * @param ref - 引用名。
 * @returns 形状是否合法。
 */
export function isResolvableKeyRef(ref: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(ref.trim());
}

/** 这些 HTTP 状态码意味着「这把 key 不行，换下一把可能行」。 */
const KEY_SPECIFIC_STATUS: ReadonlySet<number> = new Set([401, 402]);

/**
 * 一次失败之后该换哪个引用名。
 *
 * 语义是「**换下一个**」：调用方传入 `tried` 表示「已经试过、不能再试」的那些。
 * 通常调用方会把**当前正在用的**那把也放进 `tried`，于是这里返回的就是「还有没有别的」。
 * @param refs - 全部引用名（按优先级）。
 * @param status - 上一次失败得到的 HTTP 状态码。
 * @param tried - 已经试过（含当前这把）的引用名。
 * @returns 下一个要试的引用名；不该换或没有下一条时为 `undefined`。
 */
export function pickWorkingKey(
  refs: readonly string[],
  status: number | undefined,
  tried: ReadonlySet<string> = new Set(),
): string | undefined {
  // 只有「这把 key 特有的失败」才值得换。其余换了也一样。
  if (status === undefined || !KEY_SPECIFIC_STATUS.has(status)) return undefined;
  return refs.find((ref) => !tried.has(ref));
}

/** 一条引用名的配置状态。 */
export interface KeyStatus {
  /** 凭据引用名。 */
  ref: string;
  /** 凭据库里**真的**有这把 key 吗。 */
  configured: boolean;
}

/** 汇总后的状态。 */
export interface KeyStatusSummary {
  /** `none` 没填名字 / `missing` 填了但库里没有 / `partial` 部分有 / `configured` 全有。 */
  state: "none" | "missing" | "partial" | "configured";
  /** 已配置的条数。 */
  configured: number;
  /** 填了几条。 */
  total: number;
  /** 还缺哪几条（按声明顺序）。 */
  missing: string[];
}

/**
 * 把逐条状态汇总成界面能直接用的一句事实。
 *
 * 为什么要分四档而不是一个布尔：**「填了名字但库里没有」是最容易被误会的状态** ——
 * 用户以为自己加好了，其实搜索仍然用不了。那一档必须单独说出口。
 * @param rows - 逐条状态。
 * @returns 汇总结果。
 */
export function summarizeKeyStatus(rows: readonly KeyStatus[]): KeyStatusSummary {
  const total = rows.length;
  const configured = rows.filter((row) => row.configured).length;
  const missing = rows.filter((row) => !row.configured).map((row) => row.ref);
  const state: KeyStatusSummary["state"] =
    total === 0 ? "none" : configured === 0 ? "missing" : configured === total ? "configured" : "partial";
  return { state, configured, total, missing };
}

/**
 * 从「引用名」字段的文本里解析出要写入的引用名列表。
 *
 * **只按逗号切分**，不按空白：引用名本身不允许空格，所以 `bad key` 是一个**写错的条目**，
 * 不能被切成 `bad` 与 `key` 两个合法名字 —— 那会把密钥写进两个错误的凭据槽。
 * 形状非法的条目直接丢掉，并保留顺序去重。
 * @param text - 用户填的引用名文本。
 * @returns 合法的引用名（去重、保序）。
 */
export function parseSecretRefs(text: string): string[] {
  const out: string[] = [];
  for (const item of text.split(/[,，\n\r]+/)) {
    const ref = item.trim();
    if (ref === "" || !isResolvableKeyRef(ref)) continue;
    if (!out.includes(ref)) out.push(ref);
  }
  return out;
}

/**
 * 校验「保存密钥」这个动作的输入。
 *
 * 三条拒绝理由都是真实会踩的：
 * - 空 key：写空等于清掉密钥，不该用这个按钮做；
 * - 没有引用名：不知道往哪个槽写；
 * - key 里带空格：几乎必然是粘错（把两段粘在一起）。
 * @param secret - 用户贴进来的密钥。
 * @param refs - 目标引用名。
 * @returns 拒绝原因（人话）；合格时为 `undefined`。
 */
export function validateSecretInput(secret: string, refs: readonly string[]): string | undefined {
  if (secret.trim() === "") return "请先填写密钥。";
  if (refs.length === 0) return "请先在上面填写凭据引用名（例如 DEEPSEEK_API_KEY）。";
  if (/\s/.test(secret.trim())) return "密钥里不能有空格，请检查是否粘错。";
  return undefined;
}

/**
 * 给「再加一把密钥」分配一个没用过的引用名。
 *
 * 用户不再自己填名字（2026-10-20：「只保留保存密钥那个」），所以名字要自动生成：
 * 第一个用基础名，之后依次 `_2`、`_3`……
 *
 * **会复用空洞**：删掉中间那条之后再加，名字回到那个空洞（`{基础名, 基础名_3}` → `_2`）。
 * 这样编号不会越涨越大 —— 用户删了再加，看到的是「还是那几个名字」而不是一路涨到 `_17`。
 * @param existing - 已有的引用名。
 * @param base - 基础名（缺省 `DEEPSEEK_API_KEY`）。
 * @returns 可用的引用名。
 */
export function nextKeyRef(existing: readonly string[], base = "DEEPSEEK_API_KEY"): string {
  if (!existing.includes(base)) return base;
  let index = 2;
  while (existing.includes(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

/**
 * 从列表里摘掉一条。
 * @param refs - 当前列表。
 * @param ref - 要删除的引用名。
 * @returns 新列表（删不存在的条目是无操作）；不修改入参。
 */
export function removeKeyRef(refs: readonly string[], ref: string): string[] {
  return refs.filter((item) => item !== ref);
}
