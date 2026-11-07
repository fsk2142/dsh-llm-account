/**
 * DeepSeek 的 **DSML** 工具调用文本 → 结构化工具调用。
 *
 * ## 为什么需要它（2026-11-07 真机故障）
 *
 * `dsh-opencode-go` 上的 `deepseek-v4.1-flash` 偶尔不返回结构化的 `tool_calls`，
 * 而是把工具调用按 DeepSeek 自己的 DSL **写进正文/推理文本**里：
 *
 * ```text
 * <｜DSML｜ calls>
 * <｜DSML｜ invoke name="terminal_send">
 * <｜DSML｜ parameter name="sessionId" string="true">pty-9</｜DSML｜ parameter>
 * <｜DSML｜ parameter name="text" string="true">cd C:\Work\...; Select-String ...</｜DSML｜ parameter>
 * </｜DSML｜ invoke>
 * </｜DSML｜ calls>
 * ```
 *
 * 网关没有把这坨文本解析成 `tool_calls`，插件也就照原样透传。后果很隐蔽：
 *
 * - 正文**一个字都没有**，整段都进了 reasoning 通道；
 * - `finish` 是 `stop`（不是 `tool-calls`），宿主看到「没有工具调用 + 模型自己停了」，
 *   于是这一轮**空着结束**；
 * - 用户看到的就是「输出一点就被截断、任务莫名中断」。
 *
 * 实测：2026-11-07 11:08–11:37 之间连着发生 4 次（session-c0aacab8 的 seq 88150 /
 * 88192 / 88234 / 88268）。
 *
 * ## 边界
 *
 * 只认**明确的 DSML 块**。文本里没有 `<｜DSML｜ calls>` 就返回空数组 —— 绝不把普通
 * 正文里的尖括号当成工具调用。解析不出 `invoke` 时同样返回空数组（宁可让上层按
 * 「空响应」重试，也不猜一个可能错误的工具名去执行）。
 * @module dsh-llm-account/src/vendors/opencode/dsml
 */

/** 一次从文本里抢救出来的工具调用。 */
export interface DsmlToolCall {
  /** 工具名（来自 `invoke name="..."`）。 */
  name: string;
  /** 参数 JSON 字符串（与 `ToolCallBlock.arguments` 同一形状）。 */
  arguments: string;
}

/**
 * DSML 标记的正则片段。
 *
 * 分隔符在真机日志里是**全角**竖线 `｜`（U+FF5C），但模型偶尔也会输出半角 `|`。
 * 两种都认，避免同一份语法因为一个字符就完全失效。
 */
const BAR = "[｜|]";

/** `<｜DSML｜ calls>` … `</｜DSML｜ calls>` 整块。 */
const CALLS_BLOCK = new RegExp(`<${BAR}\\s*DSML\\s*${BAR}\\s*calls>([\\s\\S]*?)<\\/${BAR}\\s*DSML\\s*${BAR}\\s*calls>`, "g");

/** 块内的每一次 `<｜DSML｜ invoke name="x">` … `</｜DSML｜ invoke>`。 */
const INVOKE_BLOCK = new RegExp(
  `<${BAR}\\s*DSML\\s*${BAR}\\s*invoke\\s+name="([^"]+)"\\s*>([\\s\\S]*?)<\\/${BAR}\\s*DSML\\s*${BAR}\\s*invoke>`,
  "g",
);

/** 一次调用里的参数：`<｜DSML｜ parameter name="x" [string="true"]>值</｜DSML｜ parameter>`。 */
const PARAMETER_BLOCK = new RegExp(
  `<${BAR}\\s*DSML\\s*${BAR}\\s*parameter\\s+name="([^"]+)"([^>]*)>([\\s\\S]*?)<\\/${BAR}\\s*DSML\\s*${BAR}\\s*parameter>`,
  "g",
);

/**
 * 把一个参数值还原成 JSON 值。
 *
 * 声明了 `string="true"` 时**一定是字符串**（否则 `sessionId` 这类纯数字 id 会被
 * 解析成数字，工具收到的类型就变了）。没有声明时才尝试按 JSON 解析，失败就退回字符串。
 * @param value - 标签之间的原文。
 * @param attributes - `name` 之后的属性串。
 * @returns 可直接 `JSON.stringify` 的值。
 */
function parameterValue(value: string, attributes: string): unknown {
  if (/\bstring\s*=\s*"true"/.test(attributes)) return value;
  const trimmed = value.trim();
  if (trimmed === "") return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

/**
 * 从一段文本里抢救出所有 DSML 工具调用。
 * @param source - 模型输出（正文或 reasoning 的累计文本）。
 * @returns 解析出的调用；没有 DSML 块或解析不出调用时为空数组。
 */
export function parseDsmlCalls(source: string): DsmlToolCall[] {
  // 快速否定：绝大多数回复没有这个标记，别为它们跑正则。
  if (!source.includes("DSML")) return [];

  const calls: DsmlToolCall[] = [];
  CALLS_BLOCK.lastIndex = 0;
  for (let block = CALLS_BLOCK.exec(source); block !== null; block = CALLS_BLOCK.exec(source)) {
    const body = block[1] ?? "";
    INVOKE_BLOCK.lastIndex = 0;
    for (let invoke = INVOKE_BLOCK.exec(body); invoke !== null; invoke = INVOKE_BLOCK.exec(body)) {
      const name = (invoke[1] ?? "").trim();
      if (name === "") continue;
      const parameters: Record<string, unknown> = {};
      const inner = invoke[2] ?? "";
      PARAMETER_BLOCK.lastIndex = 0;
      for (let parameter = PARAMETER_BLOCK.exec(inner); parameter !== null; parameter = PARAMETER_BLOCK.exec(inner)) {
        const key = (parameter[1] ?? "").trim();
        if (key === "") continue;
        parameters[key] = parameterValue(parameter[3] ?? "", parameter[2] ?? "");
      }
      calls.push({ name, arguments: JSON.stringify(parameters) });
    }
  }
  return calls;
}
