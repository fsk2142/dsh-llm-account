/**
 * **实测的视觉能力覆盖表**（2026-11-09）。
 *
 * ## 为什么要覆盖厂商自己的声明
 *
 * 用户报障：「opendesign 最新的 eco 模型不能发送图片」。
 *
 * 查下来不是插件把模态读错了 —— 网关的目录里 `deepseek-v4.1-flash-eco` 确实写着
 * `architecture.input_modalities: ["text"]`。**是这条声明本身过时了。**
 *
 * 真机实测（同一把 key、同一个端点，2026-11-09）：
 *
 * | 模型 | 目录声明 | 实际能否读图 | 判据 |
 * | --- | --- | --- | --- |
 * | `deepseek-v4.1-flash-eco` | `["text"]` | **能** | 图里写 `4827` / `1593` / `7391`，三次全读对；`prompt_tokens` 39 → 241 |
 * | `deepseek-v4-flash` | `["text"]` | **能** | 同上三张全读对；`prompt_tokens` 39 → 241 |
 * | `deepseek-v4-pro` | `["text"]` | 不能 | 三张全读不出；`prompt_tokens` 92 → 97（图片根本没被接收） |
 *
 * `prompt_tokens` 那一列是关键判据：上游**真的把图片编码进了上下文**时，多出来的
 * token 量与图片体积同量级（+202）；没接收时几乎不变（+5）。只看回答像不像在描述
 * 图片是会被骗的 —— 模型可以猜。
 *
 * ## 与 `efforts.ts` 同一套道理
 *
 * 那个文件已经为「目录不公布档位」建了一张实测表。这里为「目录公布的模态过时」建同一类表，
 * 判据同样是**真机验证过**才写进来，不靠猜。表里没有的模型一律以目录声明为准。
 *
 * @module dsh-llm-account/src/vendors/opendesign/vision
 */

/**
 * 目录声明为「仅文本」、但实测**能**接收图片的模型（小写 id）。
 *
 * 只收录三次读图全部正确的 —— 一次对不足以排除偶然。
 */
const MEASURED_VISION: ReadonlySet<string> = new Set([
  "deepseek-v4.1-flash-eco",
  "deepseek-v4-flash",
]);

/**
 * 目录声明为「能看图」、但实测**不能**的模型（小写 id）。
 *
 * 目前为空：还没遇到「声称支持却没做到」的。留着这个集合是为了让两个方向都能表达 ——
 * 只写单向覆盖的话，将来遇到反例还得再造一个容器。
 */
const MEASURED_NO_VISION: ReadonlySet<string> = new Set([]);

/**
 * 用实测事实修正目录声明的输入模态。
 *
 * 只改**图片**这一项，文本永远保留（所有模型都收文本）。表里没有的模型原样返回。
 * @param model - 模型 id。
 * @param declared - 目录声明的模态（至少含 `"text"`）。
 * @returns 修正后的模态。
 */
export function measuredModalities(
  model: string,
  declared: readonly ("text" | "image")[],
): readonly ("text" | "image")[] {
  const id = model.trim().toLowerCase();
  if (id === "") return declared;
  if (MEASURED_NO_VISION.has(id)) return declared.includes("image") ? ["text"] : declared;
  if (MEASURED_VISION.has(id)) return declared.includes("image") ? declared : ["text", "image"];
  return declared;
}
