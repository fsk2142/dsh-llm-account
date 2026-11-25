/**
 * 诊断文案脱敏：保留错误码、HTTP 状态与病因，去掉密钥、邮箱、账号 ref 与本机用户路径。
 *
 * 账号 ref 本身仍是凭据槽身份，不在存储层改名；这里只保护会进入会话错误、日志和排障材料的副本。
 */

/** 把一段不可信诊断文本变成可安全展示的文本。 */
export function redactDiagnostic(text: string): string {
  return text
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/vela_[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/DSH_LLM_ACCOUNT_OPENDESIGN_[A-Za-z0-9_]+/g, "[redacted-account]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/([?&](?:email|userCode|deviceId|token|code|access_token|refresh_token)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/gi, "[user-path]")
    .replace(/\/(?:home|Users)\/[^/\s]+/gi, "[user-path]");
}
