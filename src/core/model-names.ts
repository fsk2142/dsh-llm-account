/**
 * 模型 id → **官方展示名**（纯函数）。
 *
 * 为什么需要：有的网关（Open Design 的 `GET /v1/models`）只回 `{ id, object, created, owned_by }`，
 * **不公布展示名**。界面直接印 id（`claude-sonnet-4-5-20250929`）既难看又与另两家不一致 ——
 * 同一张模型列表里 Command Code 是「Claude Sonnet 4.5」、Open Design 是原始 slug。
 *
 * 规则（确定性、可测）：
 * 1. 已知品牌词按官方写法大写（`gpt` → `GPT`、`deepseek` → `DeepSeek`、`qwen` → `Qwen`…）；
 * 2. 相邻两段纯数字用点连起来（`4-5` → `4.5`，`2-5` → `2.5`）——版本号的通用写法；
 * 3. 结尾的日期后缀（`-20250929`、`-2025-09-29`、`-0918`）去掉：它区分的是快照，不是模型名；
 * 4. 斜杠前缀（`anthropic/claude-…`）取最后一段 —— 公司另有分组标签，名字里不重复；
 * 5. 各段之间用**连字符**连接（官方名就是带中心线的：`Claude-Sonnet-4.5`、`GPT-5.1-Codex`）。
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

/** 结尾的日期/快照后缀：`-20250929`、`-2025-09-29`、`-0918`。 */
const SNAPSHOT_SUFFIX = /(?:[-_@](?:20\d{6}|20\d{2}[-_]\d{2}[-_]\d{2}|\d{4}))+$/;

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
  if (base === "") return trimmed;

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
    const lower = token.toLowerCase();
    // 版本号的两段：`4` 后面跟 `5` → `4.5`。
    if (isNumeric(token) && words.length > 0 && /^\d+$/.test(words[words.length - 1] ?? "")) {
      words[words.length - 1] = `${words[words.length - 1]}.${token}`;
      continue;
    }
    const brand = BRAND_WORDS[lower];
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
