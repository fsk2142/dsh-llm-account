# 第三方 DeepSeek 模型的图片输入：调研结论

日期：2026-10-19（本轮）
用户报障：「我发现每次第三方 deepseek 模型不支持图片输入，理论上官方都是支持的，你顺便检查一下」。

**结论先说：这不是一个「声明写错了」的小修，而是图片通路根本没做。** 本包目前既没有把图片
内容块序列化进请求，也没有声明图片模态；只改声明会让模型**收到一个它看不见的图片**然后
若无其事地回答，比现在明确拒绝更糟。所以本轮只做调研，没有改代码。

## 证据 1：厂商目录里根本没有模态字段

`C:\Users\me\.dsh\commandcode\commandcode-models.json`（旧插件落盘的线上目录，85 个模型）
每一行的键只有 `id` / `name` / `reasoning` / `contextWindow` / `maxTokens`。deepseek 家族全都在，
一行示例：

```json
{"id":"deepseek/deepseek-v4-flash-vision-exp","name":"DeepSeek V4 Flash Vision (exp) (CC)","reasoning":false,"contextWindow":1000000,"maxTokens":65536}
```

本包 `src/vendors/commandcode/catalog.ts` 与 `.../opendesign/catalog.ts` 的
`inputModalitiesOf()` 只认 `modalities` 数组里的 `"image"` 或布尔 `image: true` —— 负载什么都没
声明，于是每个模型都按 `["text"]` 广告。宿主的语义是「显式省略 = 否定能力」，所以界面/分发
层就认定这些模型不能收图。

## 证据 2：请求侧把图片块直接丢掉了

`src/vendors/commandcode/protocol.ts` 的 `textOf()`（opendesign 同形）：

```ts
/** 把一段内容压成纯文本（文件/图片块属于第 3 期，这里只取文本块）。 */
function textOf(content: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) if (block.type === "text") parts.push(block.text);
  return parts.join("");
}
```

opencode 的 `toPiContext()` 同样只产出 `{ type: "text" }` 的 part。也就是说：**即使**把
`inputModalities` 改成 `["text","image"]`，图片也到不了厂商。

## 证据 3：官方通路是怎么做的

宿主自带的官方 DeepSeek 适配器（`app.asar` → `@deepseek-ai/dsh-llm-deepseek/lib/index.js`）：

- 目录里 `DEFAULT_MODELS` 只有两条，其中 **`deepseek-flash`（DeepSeek-V4.1-Flash）声明了
  `inputModalities: ["text","image"]`，`deepseek-v4-pro` 没有声明**（= 只有文本）；
- 送图要注入 `ctx.get("attachments")`，调 `attachments.readImageRequest(ref, target, signal)`
  拿到请求版的字节，再序列化成 `{ type: "image", source: { type: "base64", media_type, data } }`；
- 还有一整套图片预算 / offload 投影（`LlmImageRequestBudget`、`requiredImageOffload`、
  `imagePixelBudget`）、视觉 token 计价与 Files API 回退。

`@earendil-works/pi-ai` 的静态模型表（本包 opencode 路由用的就是这份库）给出的模态：

| 模型 | input |
| --- | --- |
| `deepseek-flash`（= V4.1 Flash） | text, image |
| `deepseek-v4.1-flash` | text, image |
| `deepseek-v4-flash-vision-exp` | text, image |
| `deepseek-v4-flash` / `deepseek-v4-pro` | text |

所以「官方都支持」这个前提本身要修正：**官方也只有 V4.1-Flash（及其 vision-exp 变体）支持
图片**，V4-Pro 是纯文本。

## 要做的话，需要三步（属设计文档的第 3 期）

1. **按证据补模态**：负载没声明时，按一张已知表兜底（`deepseek-v4.1-flash`、
   `deepseek-v4-flash-vision-exp`、`deepseek-flash` → image；`-vision` 命名也算证据）。
   ✅ 这一步本身很小，但只做它会让行为更假 —— 必须有第 2 步。
2. **真的送图**：注入 `ctx.get("attachments")`，把 `ImageBlock` 解析成请求版字节，按三种协议
   序列化（Chat Completions 的 `image_url`、Messages 的 `image` 源块、pi-ai 的 image part），
   并处理 offload 占位与字节预算。
3. **计价与限额**：视觉 token 计价（现在 `imageRequestPricing` 仍是基类的 `undefined`）、
   图片像素/字节上限。

工作量与风险都不小（要动三个协议的请求构造 + 附件服务注入 + 一整套预算逻辑），
建议单独立项，而不是塞进这一轮 UI 修整里。
