/**
 * 凭据来源优先级：一次请求该用哪把密钥。
 *
 * 四个来源由各厂商适配器自己收集（本模块不做任何 I/O、不持有状态、不缓存），
 * 这里只按固定优先级 `literal → stored → environment → authFile` 挑出第一把可用密钥。
 * @module dsh-llm-account/src/core/credentials
 */

/** 密钥的来源。联合类型的书写顺序即优先级顺序。 */
export type CredentialSource = "literal" | "stored" | "environment" | "auth-file";

/**
 * 待挑选的四个来源。全部缺省（或全部为空串/纯空白）表示未配置。
 * 语义分别是：组合配置里写死的 key、凭据服务里的值、启动环境变量的值、
 * 厂商 CLI 的 auth.json 兜底值。
 */
export interface CredentialSources {
  /** 组合配置里写死的 key。 */
  literal?: string;
  /** 凭据服务里的值。 */
  stored?: string;
  /** 启动环境变量的值。 */
  environment?: string;
  /** 厂商 CLI 的 auth.json 兜底值。 */
  authFile?: string;
}

/**
 * 归一化一个候选密钥：裁剪首尾空白后判定非空。
 * 非字符串（例如设置文档里写错类型的值）与空串/纯空白一律视为未配置。
 * @param raw - 未经校验的候选值。
 * @returns 裁剪后的密钥，或 `undefined` 表示未配置。
 */
export function normalizeKey(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * 按优先级挑选密钥。高优先级的来源为空串或纯空白时继续往下找。
 * @param sources - 已收集到的候选来源；调用方负责读取，缺失的来源留空即可。
 * @returns 第一把可用密钥及其来源；都不可用时 `key` 与 `source` 同时为 `undefined`。
 */
export function pickApiKey(sources: CredentialSources): { key?: string; source?: CredentialSource } {
  const ordered: readonly { source: CredentialSource; raw: string | undefined }[] = [
    { source: "literal", raw: sources.literal },
    { source: "stored", raw: sources.stored },
    { source: "environment", raw: sources.environment },
    { source: "auth-file", raw: sources.authFile },
  ];
  for (const { source, raw } of ordered) {
    const key = normalizeKey(raw);
    if (key !== undefined) return { key, source };
  }
  return { key: undefined, source: undefined };
}
