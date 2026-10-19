/**
 * 网页搜索的错误类型：**本地镜像** `@deepseek-ai/dsh-web` 的 `WebError`。
 *
 * 为什么不用 import 那个类（2026-10-19 用户报障「插件改完后 DSH 起不来」的排查结论）：
 * `@deepseek-ai/dsh-web` 是**可选**依赖 —— 宿主没装桌面端搜索时，profile 的 node_modules 里
 * 根本没有这个包；而静态 `import` 在**加载期**就会解析不到，整行插件加载失败，宿主因此起不来
 * （cordis 的 `inject: ["web"]` 只保证不调用 `apply`，救不了加载期这一层）。
 *
 * 代价与取舍：宿主若用 `instanceof` 判断，跨包实例本来就互不成立（我们的错误来自另一个包），
 * 而它的调用面读的是 `name` 与 `code`（`WEB_PROVIDER_ERROR` / `WEB_ABORTED` 等）—— 两者都逐字对齐。
 * @module dsh-llm-account/src/web-search/web-error
 */

/** 与厂商一致的错误码词汇表（开放词表：宿主按需识别）。 */
export type WebErrorCode = string;

/** 结构与 `WebError` 一致：错误码挂在 `code` 上，`name` 也是 `WebError`。 */
export class WebError extends Error {
  /** 开放词表的错误码；宿主按它决定重试/提示。 */
  readonly code: WebErrorCode;

  /**
   * @param message - 面向人读的说明。
   * @param code - 错误码（如 `WEB_PROVIDER_ERROR`）。
   */
  constructor(message: string, code: WebErrorCode, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WebError";
    this.code = code;
  }
}
