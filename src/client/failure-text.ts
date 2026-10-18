/**
 * 失败原文 → 界面上的人话。
 *
 * 为什么需要这一层：`failures[]` 是**诊断字符串** —— 有端点短名（`whoami`、`credits`），
 * 也有带厂商名与原因的包装（`quota: commandcode "工作账号" read failed (…)`）。直接印给用户
 * 看就是调试输出：2026-10-18 用户报障「用量面板里面多了一些英文」，看到的就是 Command Code
 * 端口记下的端点短名 `whoami`。这一层把**已知形状**映射成人话；原文由各渲染处留在 `data-*`
 * 属性里供排查。
 *
 * 认不出的形状**原样返回**：自证优先于美观 —— 真正意外的失败（宿主的能力缺失原文、远程面
 * 没挂上之类）要看得见；翻译不了的东西不假装翻译。
 * @module dsh-llm-account/src/client/failure-text
 */

/** 端点短名 → 文案键（Command Code 的 `QUOTA_ENDPOINTS`、OpenCode 的窗口键）。 */
const SHORT_NAMES: Readonly<Record<string, string>> = {
  whoami: "usage.failure.whoami",
  usage: "usage.failure.usage",
  credits: "usage.failure.credits",
  subscriptions: "usage.failure.subscriptions",
  rolling: "usage.failure.window",
  weekly: "usage.failure.window",
  monthly: "usage.failure.window",
  "5h": "usage.failure.window",
  fiveHour: "usage.failure.window",
  daily: "usage.failure.window",
  day: "usage.failure.window",
};

/**
 * 把一条失败原文翻成人话。
 *
 * 已知形状（按顺序判定）：
 * 1. `quota: <厂商> "<账号名>" read failed (…)` —— 账号名留着（它是有用信息），原因泛化；
 * 2. `quota: …` / `models: …` 的其他包装 —— 只说哪一类读取失败；
 * 3. 含 `timeout` —— 「读取超时」；
 * 4. 端点短名 —— 逐名映射（`whoami` → 账号信息读取失败…）；
 * 5. 客户端接缝自己的诊断（`no models()` / `returned no value`）—— 归到模型目录读取失败；
 * 6. 其余原样返回。
 * @param t - 取词函数。
 * @param raw - 宿主或端口给出的失败原文。
 * @returns 界面文案（可能是原文）。
 */
export function failureText(t: (key: string) => string, raw: string): string {
  const text = raw.trim();
  if (text === "") return t("usage.failed");
  const accountQuota = /^quota:\s*\S+\s+"([^"]*)"\s+read failed\b/i.exec(text);
  if (accountQuota !== null) {
    const line = t("usage.failure.accountQuota").replace("{account}", accountQuota[1] ?? "");
    return /timeout/i.test(text) ? `${line}（${t("usage.failure.timeout")}）` : line;
  }
  if (/^quota:/i.test(text)) return t("usage.failure.quota");
  if (/^models:/i.test(text)) {
    return /does not expose|no models\(\)/i.test(text) ? t("usage.failure.modelsUnsupported") : t("usage.failure.models");
  }
  if (/timeout/i.test(text)) return t("usage.failure.timeout");
  if (Object.hasOwn(SHORT_NAMES, text)) return t(SHORT_NAMES[text]!);
  if (/no models\(\)|returned no value/i.test(text)) return t("usage.failure.models");
  return text;
}

/**
 * 多条失败（客户端接缝用 `；` 连接，如模型目录的失败项）→ 人话。
 * @param t - 取词函数。
 * @param raw - 连接后的失败原文。
 * @returns 连接后的人话。
 */
export function failureListText(t: (key: string) => string, raw: string): string {
  return raw
    .split("；")
    .map((item) => failureText(t, item))
    .join("；");
}
