/**
 * 模型 id → **官方展示名**（纯函数），外加同一份目录内的**去重**。
 *
 * ## 为什么所有厂商都用它，而不是厂商给的 `name`
 *
 * 2026-10-20 报障「模型名称又不一致了」的根因：同一个模型在三家网关的写法不同 ——
 * Command Code 的目录自带 `name: "DeepSeek V4.1 Flash (CC)"`（还带网关自己的 `(CC)` 标记）、
 * Open Code 的名字来自 models.dev（`DeepSeek V4.1 Flash`）、Open Design 只回 id。以前只有
 * Open Design 走名称规则，另两家照搬厂商 name，于是宿主的模型选择器里同一个模型三种写法。
 *
 * 规则只有一条：**展示名一律由 id 派生**，与是哪个网关无关；厂商的 `name` 只用来判断这一行
 * 是否有效（与旧插件同一道门槛），不再进界面。
 *
 * ## 规则（确定性、可测）
 *
 * 1. 已知品牌词按官方写法（`gpt` → `GPT`、`deepseek` → `DeepSeek`、`mimo` → `MiMo`…）；
 * 2. 相邻两段纯数字用点连起来（`4-5` → `4.5`，`2-5` → `2.5`）——版本号的通用写法；
 * 3. 结尾的日期/快照后缀（`-20250929`、`-2025-09-29`、`-0902`）去掉：它区分的是快照，不是
 *    模型名（真要区分时由 {@link assignUniqueNames} 把它加回括号里）；
 * 4. 斜杠前缀（`anthropic/claude-…`）取最后一段 —— 公司另有分组标签，名字里不重复；
 * 5. 各段之间用**连字符**连接（官方名就是带中心线的：`Claude-Sonnet-4.5`、`GPT-5.1-Codex`）；
 * 6. **大小写不参与语义**：`meituan/LongCat-2.0` 与 `longcat-2.0` 必须同名（2026-10-20 实测
 *    两家网关写出 `LongCat` / `Longcat` 两种，同一模型看起来是两个）。
 *
 * 只用于**展示**：请求里永远用原始 id（`model.id`），两者绝不互换。
 * @module dsh-llm-account/src/core/model-names
 */

/** 品牌/产品词的官方写法（小写键）。 */
const BRAND_WORDS: Readonly<Record<string, string>> = {
  gpt: "GPT",
  o: "o",
  claude: "Claude",
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  google: "Google",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  glm: "GLM",
  zai: "Zai",
  kimi: "Kimi",
  moonshot: "Moonshot",
  longcat: "LongCat",
  mimo: "MiMo",
  hy: "Hy",
  grok: "Grok",
  xai: "xAI",
  llama: "Llama",
  meta: "Meta",
  mistral: "Mistral",
  minimax: "MiniMax",
  step: "Step",
  stepfun: "StepFun",
  hunyuan: "Hunyuan",
  ernie: "ERNIE",
  doubao: "Doubao",
  seed: "Seed",
  nemotron: "Nemotron",
  nvidia: "NVIDIA",
  sonnet: "Sonnet",
  opus: "Opus",
  haiku: "Haiku",
  fable: "Fable",
  luna: "Luna",
  sol: "Sol",
  terra: "Terra",
  astra: "Astra",
  pro: "Pro",
  max: "Max",
  mini: "Mini",
  flash: "Flash",
  lite: "Lite",
  codex: "Codex",
  preview: "Preview",
  turbo: "Turbo",
  vision: "Vision",
  omni: "Omni",
  chat: "Chat",
  reasoner: "Reasoner",
  instruct: "Instruct",
  fast: "Fast",
  thinking: "Thinking",
  exp: "Exp",
  contributor: "Contributor",
};

/** 品牌词的常见连写（id 里没有分隔符时也能认出来）。 */
const BRAND_PREFIXES: readonly (readonly [RegExp, string])[] = [
  [/^gpt(?=\d)/i, "GPT-"],
  [/^glm(?=\d)/i, "GLM-"],
  [/^qwen(?=\d)/i, "Qwen"],
  [/^deepseek(?=v?\d)/i, "DeepSeek "],
  [/^gemini(?=\d)/i, "Gemini-"],
  [/^claude(?=\d)/i, "Claude"],
  [/^kimi(?=[a-z]?\d)/i, "Kimi"],
  [/^grok(?=\d)/i, "Grok-"],
];

/** 结尾的日期/快照后缀：`-20250929`、`-2025-09-29`、`-0918`（撞名时还会借它区分）。 */
const SNAPSHOT_SUFFIX = /(?:[-_@](?:20\d{6}|20\d{2}[-_]\d{2}[-_]\d{2}|\d{4}))+$/;

/**
 * 结尾的机器可读限定（`inclusionai/ling-3.1-flash:free` 的 `:free`）。
 *
 * 它是**价格标记**，不是模型名的一部分 —— 印成 `Ling-3.1-Flash:free` 是界面在泄漏内部
 * 语法。去掉它不影响「哪个模型」：同一份目录里真出现 `x` 与 `x:free` 两个 id 时，
 * {@link assignUniqueNames} 会把 `free` 加回括号里区分。
 */
const QUALIFIER_SUFFIX = /:[a-z][a-z0-9_.-]*$/i;

/** 一段是不是纯数字（版本号的一半）。 */
function isNumeric(token: string): boolean {
  return /^\d+$/.test(token);
}

/**
 * 把一串 id 片段转成官方展示名。
 * @param id - 模型 id（可带公司前缀与快照后缀）。
 * @returns 展示名；空输入原样返回空串。
 */
export function officialModelName(id: string): string {
  const trimmed = id.trim();
  if (trimmed === "") return "";

  // 公司前缀（`anthropic/claude-…`）：取最后一段。
  const segments = trimmed.split("/");
  let base = segments[segments.length - 1] ?? trimmed;
  base = base.replace(SNAPSHOT_SUFFIX, "");
  // `:free` 这类限定先摘掉：它是价格标记，不是名字的一部分。
  base = base.replace(QUALIFIER_SUFFIX, "");
  if (base === "") return trimmed;

  // 大小写不参与语义：品牌词表、连写规则与版本号都按小写比对，输出时再取回官方写法。
  // （`meituan/LongCat-2.0` 与 `longcat-2.0` 因此得到同一个名字。）
  base = base.toLowerCase();

  // 连写品牌词先拆开（`gpt5.1` → `GPT-5.1`、`qwen3-max` → `Qwen3-max`）。
  for (const [pattern, replacement] of BRAND_PREFIXES) {
    if (pattern.test(base)) {
      base = base.replace(pattern, replacement);
      break;
    }
  }

  const tokens = base.split(/[-_\s]+/).filter((token) => token !== "");
  const words: string[] = [];
  for (const token of tokens) {
    // 版本号的两段：`4` 后面跟 `5` → `4.5`。
    if (isNumeric(token) && words.length > 0 && /^\d+$/.test(words[words.length - 1] ?? "")) {
      words[words.length - 1] = `${words[words.length - 1]}.${token}`;
      continue;
    }
    const brand = BRAND_WORDS[token];
    if (brand !== undefined) {
      words.push(brand);
      continue;
    }
    // `4.5` / `3.8` 这类已带点的版本段原样保留。
    if (/^\d+(?:\.\d+)*$/.test(token)) {
      words.push(token);
      continue;
    }
    words.push(token.charAt(0).toUpperCase() + token.slice(1));
  }

  // 拼接：**全部用连字符**。官方名称就是这种写法（`Claude-Sonnet-4.5`、`GPT-5.1-Codex`、
  // `Qwen3-Max`、`DeepSeek-V4-Pro`、`GLM-5`），空格写法与厂商文档对不上（用户报障：官方名
  // 中间是有中心线的）。
  return words.join("-");
}

/**
 * 一个 id 与它的展示名之间「被规则吃掉的差异」。撞名时用它区分两行。
 *
 * 两种来源都算：日期快照（`-0902`）与价格限定（`:free`）。`step-5-preview` 与
 * `step-5-preview-free` 归一后同名，靠 `free` 才能区分。
 * @param id - 模型 id。
 * @returns 差异标记；没有就是空串。
 */
function markerOf(id: string): string {
  const tail = tailOf(id);
  const snapshot = (tail.match(SNAPSHOT_SUFFIX)?.[0] ?? "").replace(/^[-_@]+/, "").replace(/[-_]+/g, "");
  if (snapshot !== "") return snapshot;
  return (tail.match(QUALIFIER_SUFFIX)?.[0] ?? "").replace(/^:/, "");
}

/** id 去掉公司前缀后的最后一段（撞名时的最终退路）。 */
function tailOf(id: string): string {
  const segments = id.trim().split("/");
  return segments[segments.length - 1] ?? id.trim();
}

/**
 * 给一份目录定展示名：先按 {@link officialModelName} 归一，**再消掉撞名**。
 *
 * 为什么必须去重：归一后可能撞名。线上实测 `Qwen/Qwen3.8-Max` 与 `Qwen/Qwen3.8-Max-0902`
 * 都会变成 `Qwen3.8-Max` —— 界面上就是两个一模一样、但选哪一个都不知道的行。规则：
 *
 * 1. 不撞名的一个字符都不改（绝大多数行走这一条）；
 * 2. 撞名的先借**被规则吃掉的差异**区分：日期快照 `Qwen3.8-Max (0902)`、价格限定
 *    `Step-5-Preview (free)`；
 * 3. 还撞就退回 id 的最后一段；
 * 4. 仍撞才加序号。
 *
 * **撞名时短名归「没带快照后缀」的那个 id**：`Qwen3.8-Max` 必须叫 `Qwen3.8-Max`，让位的
 * 该是 `Qwen3.8-Max-0902`。按目录顺序先到先得会反过来 —— 目录里带日期的变体常排在前面，
 * 结果同一模型在别家（目录里只有短名）叫 `Qwen3.8-Max`、这家叫 `Qwen3.8-Max (2)`，
 * 名字又对不上了。排序只影响撞名的那一组，不撞名的顺序一字不动。
 *
 * 展示名之间**大小写不敏感**地唯一：宿主的模型选择器按名字展示，用户也按名字认。
 * @param ids - 目录里的模型 id，**保持目录顺序**。
 * @returns 与入参等长、一一对应的展示名。
 */
export function assignUniqueNames(ids: readonly string[]): string[] {
  const out = ids.map((id) => officialModelName(id));
  const groups = new Map<string, number[]>();
  out.forEach((name, index) => {
    const key = name.toLowerCase();
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [index]);
    else bucket.push(index);
  });

  for (const [, indexes] of groups) {
    if (indexes.length < 2) continue;
    // 短名（没带快照后缀）先挑，其余按目录顺序 —— 这样「正式名」不会被它的日期变体挤掉。
    const ordered = [...indexes].sort((left, right) => {
      const leftSnap = tailOf(ids[left] ?? "").match(SNAPSHOT_SUFFIX) === null ? 0 : 1;
      const rightSnap = tailOf(ids[right] ?? "").match(SNAPSHOT_SUFFIX) === null ? 0 : 1;
      return leftSnap - rightSnap || left - right;
    });
    // 第一行保留干净名字；其余行各拿一个带标记的名字，彼此不撞。
    const used = new Set<string>([(out[ordered[0]!] ?? "").toLowerCase()]);
    let counter = 1;
    for (const index of ordered.slice(1)) {
      const base = out[index] ?? "";
      const tail = tailOf(ids[index] ?? "");
      let candidate = base;
      // 1) 借被规则吃掉的差异（`Qwen3.8-Max-0902` → `(0902)`、`step-5-preview-free` → `(free)`）。
      const marker = markerOf(ids[index] ?? "");
      if (marker !== "") candidate = `${base} (${marker})`;
      // 2) 还撞就退回 id 的最后一段 —— 但**只在它确实比展示名多出信息时**用。
      //    `a/same-model` 与 `b/same-model` 的 tail 都是 `same-model`，加进括号只会得到
      //    `Same-Model (same-model)` 这种纯重复（2026-10-20 审计）。那时不如直接跳到序号。
      if (used.has(candidate.toLowerCase()) && tail !== base && !base.toLowerCase().includes(tail.toLowerCase())) {
        candidate = `${base} (${tail})`;
      }
      // 3) 最终退路：序号。
      while (used.has(candidate.toLowerCase())) {
        counter += 1;
        candidate = `${base} (${counter})`;
      }
      out[index] = candidate;
      used.add(candidate.toLowerCase());
    }
  }
  return out;
}
