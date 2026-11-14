/**
 * 凭据类字段的「已添加 / 未添加」汇总。
 *
 * ## 这不是搜索专用代码 —— 所以它从 `search-keys.ts` 里搬了出来
 *
 * 2026-11-14 剥离网页搜索时删掉了 `core/switching/search-keys.ts`（那里面还有
 * 引用名解析、命名校验、密钥写入规则，全部服务搜索）。但 `summarizeKeyStatus`
 * 是**唯一一处与搜索无关**的东西：
 *
 * 界面上「环境变量名」类字段（三家的 `apiKeyEnv`）也要显示「已配置 / 未配置」徽标
 * —— 那填的是**环境变量名**，真 key 在环境或凭据库里，所以同样要查一次再说。
 *
 * 把它跟着搜索一起删，症状是「三家的环境变量名输入框旁边的状态徽标整片消失」，
 * 且不会报错 —— 属于静默功能损失。所以单独留在这里。
 *
 * ## 为什么分四档而不是一个布尔
 *
 * **「填了名字但库里没有」是最容易被误会的状态** —— 用户以为自己加好了，
 * 其实那一项仍然用不了。那一档必须单独说出口。
 *
 * @module dsh-llm-account/src/core/credential-summary
 */

/** 一条凭据的「配没配」。 */
export interface KeyStatus {
  /** 凭据引用名（或环境变量名）。 */
  ref: string;
  /** 是否真的配置了。 */
  configured: boolean;
}

/** 汇总结果。 */
export interface KeyStatusSummary {
  /** `none` 没有条目；其余按全部配置 / 部分配置 / 全部未配置分档。 */
  state: "none" | "missing" | "partial" | "configured";
  /** 已配置条数。 */
  configured: number;
  /** 总条数。 */
  total: number;
  /** 未配置的引用名（按入参顺序）。 */
  missing: string[];
}

/**
 * 汇总一组凭据状态。
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
