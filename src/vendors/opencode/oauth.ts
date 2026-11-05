/**
 * OpenCode 网页登录的协议层：设备码、轮询、刷新与凭据 blob（实验性）。
 *
 * 凭据以 `ocoauth1:` 前缀的 JSON 存进**现有凭据槽**（与 API key 同一个槽位空间），
 * 因此账号表、`accountOrder`、凭据服务都不需要为新授权方式加字段；手动 API key 仍然可用，
 * 适配器按前缀区分。
 *
 * 端点（2026-10-17 实测）：
 * - `POST {authBase}/console/auth/device/code`，body `{client_id:"opencode-cli"}`；
 * - `POST {authBase}/console/auth/device/token`，轮询 `{client_id, device_code}`，
 *   刷新 `{grant_type:"refresh_token", refresh_token, client_id}`；
 * - `GET {authBase}/console/api/orgs`，Bearer access token。
 *
 * 本模块只做 HTTP + 归一化，不碰设置、账号或轮换；注入 `fetch` 与时钟，测试无需真网。
 * @module dsh-llm-account/src/vendors/opencode/oauth
 */
import { BodyTooLargeError, readBoundedJson, readBoundedJsonResult } from "../../core/bounded-body";

/** 凭据 blob 前缀（与普通 API key 区分）。 */
export const OAUTH_PREFIX = "ocoauth1:";

/** 设备码与 token 端点所在的 Console 基地址（与推理网关不同）。 */
export const DEFAULT_AUTH_BASE = "https://opencode.ai";

/** OpenCode CLI 的公共 client id（设备码流程用）。 */
export const OAUTH_CLIENT_ID = "opencode-cli";

/** 刷新提前量：过期前 60 秒就刷新，避免请求卡在边界上。 */
export const REFRESH_SKEW_MS = 60_000;

/** 存进凭据槽的 OAuth blob。 */
export interface OAuthCredential {
  /** blob 版本；当前只有 1。 */
  v: 1;
  /** 访问 token。 */
  access: string;
  /** 刷新 token。 */
  refresh: string;
  /** 访问 token 过期时刻（epoch 毫秒）。 */
  expiresAt: number;
  /** 工作区 id（推理请求必须带 `x-opencode-org-id`）。 */
  orgId: string;
  /** 工作区名称（账号标签用）。 */
  orgName?: string;
  /** 登录用户名（账号标签的兜底）。 */
  userName?: string;
  /** 可选的 Console 基地址（测试或自建部署用）。 */
  authBase?: string;
}

/** HTTP 依赖。 */
export interface OAuthHttpDeps {
  /** 注入的 `fetch`。 */
  fetchImpl: typeof fetch;
  /** Console 基地址；缺省 {@link DEFAULT_AUTH_BASE}。 */
  authBase?: string;
  /**
   * 允许的 Console 主机列表（含子域）；缺省 `["opencode.ai"]`（安全加固）。
   *
   * 测试与自建部署用这个显式放宽。**默认只放行真实服务** —— 目标地址决定了
   * refresh token 会被发到哪里，默认收紧比默认放开稳妥。
   */
  allowAuthHosts?: readonly string[];
  /** 时钟（测试注入）。 */
  now?: () => number;
}

/** 一次设备码尝试。 */
export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** 轮询间隔（毫秒，至少 1 秒）。 */
  intervalMs: number;
  /** 设备码过期时刻（epoch 毫秒）。 */
  expiresAt: number;
}

/** 一次轮询的结果。 */
export type PollResult =
  /**
   * `emptyBody`：这次 pending 是**空正文 400 的兜底**推断出来的，而不是服务端
   * 明确回了 `authorization_pending`（F14）。调用方据此决定要不要推进连续计数。
   */
  | { status: "pending"; emptyBody?: true }
  | { status: "slow_down" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "error"; message: string }
  | { status: "success"; access: string; refresh: string; expiresAt: number };

/**
 * 连续多少次「空正文 400」之后判定为协议错误（2026-11-05 外部审查 F14）。
 *
 * ## 为什么需要上限
 *
 * 空正文 400 在历史上是「缺 `grant_type`」的畸形请求形态（见
 * {@link DEVICE_CODE_GRANT_TYPE} 的注释），所以兜底成 pending 曾经是对的 ——
 * 它救了那个 bug。但同一形态也可能表示**参数错、协议变更、被中间代理拒绝**，
 * 这时把它当 pending，界面会一直停在「等待授权」，直到设备码过期才报 timeout。
 *
 * 复现：mock token 端点持续回空正文 400，实测轮询了 **300 次**才结束，
 * 最终原因是 `timeout` —— 真实故障被伪装成了「用户还没授权」。
 *
 * ## 为什么是 3 而不是 1
 *
 * 真有「空正文但其实是 pending」的服务端行为时，第一次多等一个间隔几乎无感；
 * 反过来，偶发的一次代理抖动也不该立刻把流程打死。3 次（≈3 个轮询间隔，
 * 默认 5 秒起）足以区分「持续异常」与「偶发」。
 */
export const EMPTY_BODY_PENDING_TOLERANCE = 3;

/** 解析凭据 blob；不是本前缀或形状不认识时返回 `undefined`（按普通 key 处理）。 */
export function parseOAuthCredential(raw: string | undefined): OAuthCredential | undefined {
  if (typeof raw !== "string" || !raw.startsWith(OAUTH_PREFIX)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(OAUTH_PREFIX.length));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const value = parsed as Record<string, unknown>;
  if (value.v !== 1) return undefined;
  if (typeof value.access !== "string" || value.access === "") return undefined;
  if (typeof value.refresh !== "string" || value.refresh === "") return undefined;
  if (typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) return undefined;
  if (typeof value.orgId !== "string" || value.orgId === "") return undefined;
  return {
    v: 1,
    access: value.access,
    refresh: value.refresh,
    expiresAt: value.expiresAt,
    orgId: value.orgId,
    ...(typeof value.orgName === "string" && value.orgName !== "" ? { orgName: value.orgName } : {}),
    ...(typeof value.userName === "string" && value.userName !== "" ? { userName: value.userName } : {}),
    ...(typeof value.authBase === "string" && value.authBase !== "" ? { authBase: value.authBase } : {}),
  };
}

/** 序列化成凭据槽里存的一行。 */
export function serializeOAuthCredential(credential: OAuthCredential): string {
  return `${OAUTH_PREFIX}${JSON.stringify(credential)}`;
}

/** 这个 blob 是否该刷新（过期前 {@link REFRESH_SKEW_MS} 开始）。 */
export function needsRefresh(credential: OAuthCredential, now: number): boolean {
  return credential.expiresAt - REFRESH_SKEW_MS <= now;
}

/**
 * OAuth 响应的字节上限：**256 KiB**（2026-11-05 外部审查 F13）。
 *
 * 这三个端点正常只回几百字节到几 KB（设备码、token、工作区列表）。256 KiB 是
 * 一个非常宽松的上限 —— 正常响应永远碰不到它，而异常响应（代理错误页、服务端
 * 把整个 HTML 页面甩回来）不会先把内存吃满再抛错。
 *
 * 为什么必须有：上一版走 `readJson` 里的 `response.text()`，先把**完整正文**
 * 读进内存再解析。多账号并发刷新时这份峰值会叠加。
 */
const OAUTH_MAX_BODY_BYTES = 256 * 1024;

/**
 * 读 JSON；非 2xx 不抛（调用方按端点语义处理）。
 *
 * **有界**（F13）：分块读、按 UTF-8 字节计、超限立刻取消正文。超限会抛
 * {@link BodyTooLargeError} —— 调用方必须把它与「空正文」「非法 JSON」区分开，
 * 尤其不能让 token 轮询把超限误判成 `pending`（那会一直等到设备码过期）。
 * @param response - 端点响应。
 * @returns 解析后的值；空正文或非法 JSON 时 `undefined`。
 * @throws {@link BodyTooLargeError} 正文超过 {@link OAUTH_MAX_BODY_BYTES}。
 */
async function readJson(response: Response): Promise<unknown> {
  return await readBoundedJson(response, OAUTH_MAX_BODY_BYTES);
}

/** 普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从响应里读字符串。 */
function stringOf(value: Record<string, unknown>, key: string): string | undefined {
  const found = value[key];
  return typeof found === "string" && found !== "" ? found : undefined;
}

/**
 * Console 基地址（去掉结尾斜杠），**并校验主机**（安全加固）。
 *
 * 校验放在这里而不是各调用点：设备码、轮询、刷新、工作区四条路径都经过它，
 * 漏一处的后果就是「refresh token 被发到了别处」。
 * @param deps - 注入的 HTTP 依赖。
 * @param credential - 可选的凭据 blob（它的 `authBase` 是第二来源）。
 * @returns 已校验的基地址。
 */
function authBaseOf(deps: OAuthHttpDeps, credential?: OAuthCredential): string {
  const allowed = deps.allowAuthHosts ?? DEFAULT_ALLOWED_AUTH_HOSTS;
  const base = deps.authBase ?? credential?.authBase ?? DEFAULT_AUTH_BASE;
  return assertAuthBase(base, allowed);
}

/**
 * 允许的 Console 主机（安全加固，2026-11-05 复审）。
 *
 * ## 为什么需要
 *
 * `authBase` 会决定**刷新 token 被发到哪个端点**。它有两个来源：
 *
 * 1. `deps.authBase`（装配层注入，生产路径上从不设置）；
 * 2. **凭据 blob 里的 `authBase` 字段** —— 一旦本机凭据库被写入伪造的 blob，
 *    刷新时 refresh_token 就会被送到攻击者主机。
 *
 * 后者需要先能写凭据库（那已经接近完全失控），所以这是**纵深防御**而不是当前
 * 可利用的漏洞。但代价极低：把目标限制在我们自己的域名上即可。
 *
 * ## 为什么默认只放行 opencode.ai
 *
 * 唯一的真实服务就是它。测试与自建部署通过 `allowAuthHosts` 显式放宽 ——
 * 「默认安全，需要时显式开口」比「默认随便连」稳妥。
 */
const DEFAULT_ALLOWED_AUTH_HOSTS: readonly string[] = ["opencode.ai"];

/** 主机是否在允许列表里（含子域）。 */
function isAllowedAuthHost(host: string, allowed: readonly string[]): boolean {
  const normalized = host.toLowerCase();
  return allowed.some((entry) => {
    const candidate = entry.toLowerCase();
    return normalized === candidate || normalized.endsWith(`.${candidate}`);
  });
}

/**
 * 校验并规范化 Console 基地址。
 *
 * 不接受 `http://`（token 明文过网）、不允许空主机、不允许非允许列表的主机。
 * 校验失败**抛错**而不是静默回落到默认值 —— 静默回落会让「配错了」表现为
 * 「登录莫名其妙走错地方」，比直接报错难查得多。
 * @param raw - 待校验的基地址。
 * @param allowed - 允许的主机列表（含子域）。
 * @returns 去掉结尾斜杠的基地址。
 * @throws 协议不是 https、无法解析、或主机不在允许列表时。
 */
function assertAuthBase(raw: string, allowed: readonly string[]): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`authBase is not a valid URL: ${trimmed}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`authBase must use https (got ${url.protocol.replace(":", "")}): ${trimmed}`);
  }
  if (!isAllowedAuthHost(url.hostname, allowed)) {
    throw new Error(
      `authBase host "${url.hostname}" is not allowed (allowed: ${allowed.join(", ")}). ` +
        "Refusing to send credentials to an unrecognized host.",
    );
  }
  return trimmed;
}

/**
 * 把服务端给的验证地址补成**可直接打开**的绝对 URL。
 *
 * ## 为什么需要（2026-11-02 真机报障）
 *
 * 真机实测 opencode 的 `device/code` 返回：
 *
 * ```json
 * {
 *   "verification_uri": "/console/device",
 *   "verification_uri_complete": "/console/device?user_code=RVFK-SRHG&client_id=opencode-cli"
 * }
 * ```
 *
 * 两个都是**相对路径**。界面用 `isHttpUrl(authUrl)` 判定能不能给 `href`，相对路径
 * 判为 `false` → 链接不可点，用户只看到一串没有域名的文字。
 *
 * ## 规则（含安全加固）
 *
 * - 以 `/` 开头（或其它相对形态）→ 接到 `authBase` 后面。这是**唯一**信任的来源，
 *   因为 `authBase` 已经过 {@link assertAuthBase} 校验；
 * - 已经是绝对 URL → **同样要校验**主机在允许列表内。否则服务端（或中间人）可以
 *   返回 `https://opencode.ai.evil.test/...` 把用户导向仿冒登录页，而用户看到的
 *   域名前半段是对的；
 * - 主机不在允许列表 → **拒绝并抛错**，不返回一个「看起来能点」的链接。
 * @param authBase - 已校验的 Console 基地址（已去掉结尾斜杠）。
 * @param uri - 服务端给的验证地址（可能是相对路径）。
 * @param allowed - 允许的主机列表（含子域）。
 * @returns 绝对 URL。
 * @throws 相对形态之外、且主机不在允许列表时。
 */
function absoluteVerificationUri(authBase: string, uri: string, allowed: readonly string[]): string {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(uri)) {
    // 绝对 URL（或其它带 scheme 的形态）：必须是我们信任的主机。
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new Error(`verification URI is not a valid URL: ${uri}`);
    }
    if (parsed.protocol !== "https:" || !isAllowedAuthHost(parsed.hostname, allowed)) {
      throw new Error(
        `verification URI points at an untrusted host (${parsed.hostname}); refusing to hand out the link`,
      );
    }
    return uri;
  }
  // 相对路径：拼到已校验的 authBase 上，天然可信。
  const suffix = uri.startsWith("/") ? uri : `/${uri}`;
  return `${authBase}${suffix}`;
}

/** 申请设备码。 */
export async function beginDeviceFlow(deps: OAuthHttpDeps, signal?: AbortSignal): Promise<DeviceCode> {
  const response = await deps.fetchImpl(`${authBaseOf(deps)}/console/auth/device/code`, {
    method: "POST",
    /**
     * **必须带 signal**（2026-11-05 外部审查 F02）。
     *
     * 上一版三个网络函数（设备码 / 轮询 / 读工作区）都没有 `signal` 参数：
     * 用户点「取消」只能改本地状态，已经发出的 `fetch` 继续挂在网络上，
     * `begin()` 也就永远等不到它 —— 界面上像没反应，进程里留下无主的请求。
     */
    ...(signal === undefined ? {} : { signal }),
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: OAUTH_CLIENT_ID }),
  });
  const payload = await readJson(response);
  if (!response.ok || !isRecord(payload)) throw new Error(`device code request failed (HTTP ${response.status})`);
  const deviceCode = stringOf(payload, "device_code");
  const userCode = stringOf(payload, "user_code");
  /**
   * **取 `verification_uri_complete`，并把相对路径补成绝对 URL**
   * （2026-11-02 修真机报障「网页链接无法打开」）。
   *
   * ## 真机实测的服务端响应
   *
   * ```json
   * {
   *   "verification_uri": "/console/device",
   *   "verification_uri_complete": "/console/device?user_code=RVFK-SRHG&client_id=opencode-cli"
   * }
   * ```
   *
   * 两个都是**相对路径**，没有域名。上一版：
   *
   * 1. **优先取 `verification_uri`** —— 它不含 `user_code`，用户还得手输验证码；
   * 2. **原样透传** —— 界面 `isHttpUrl("/console/device")` 为 `false`，于是**不给
   *    `href`**，链接根本点不动，只显示一串没有域名的路径。
   *
   * 现在的顺序：`verification_uri_complete`（带验证码，最省事）→ `verification_uri`
   * （兜底，用户手输）→ 相对当前 `authBase` 解析成绝对地址。
   */
  const rawUri = stringOf(payload, "verification_uri_complete") ?? stringOf(payload, "verification_uri");
  if (deviceCode === undefined || userCode === undefined || rawUri === undefined) {
    throw new Error("device code response is missing device_code/user_code/verification_uri");
  }
  const verificationUri = absoluteVerificationUri(authBaseOf(deps), rawUri, deps.allowAuthHosts ?? DEFAULT_ALLOWED_AUTH_HOSTS);
  const intervalSeconds = typeof payload.interval === "number" && payload.interval > 0 ? payload.interval : 5;
  const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : 600;
  const now = deps.now?.() ?? Date.now();
  return {
    deviceCode,
    userCode,
    verificationUri,
    intervalMs: Math.max(1_000, Math.round(intervalSeconds * 1_000)),
    expiresAt: now + Math.round(expiresIn * 1_000),
  };
}

/**
 * 设备码流程的 `grant_type`（OAuth 2.0 Device Authorization Grant 标准值）。
 *
 * ## 为什么必须带（2026-11-02 真机报障的**根因**）
 *
 * 真机实测 `POST /console/auth/device/token`：
 *
 * | 请求体 | 服务端返回 |
 * | --- | --- |
 * | `{client_id, device_code}` | **HTTP 400 + 空 body**（无法解析） |
 * | `{client_id, device_code, grant_type}` | `{"_tag":"DeviceTokenError","error":"authorization_pending"}` |
 *
 * 缺 `grant_type` 时服务端把它当成**畸形请求**，返回空 body。于是：
 *
 * 1. `readJson` 拿到 `undefined`；
 * 2. `error` 字段取不到 → 落到 `status: "error"`；
 * 3. 登录立刻结算成 `reason: "unavailable"` —— 界面上就是
 *    **「登录服务暂时不可用」**，而且发生在**第一次轮询**（用户还没授权完）。
 *
 * 这就是「登录后账户没添加」的直接原因：流程在第一拍就死了，永远到不了
 * `fetchOAuthOrg` 与 `storeKey`。
 */
export const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/**
 * 用设备码换一次 token（可能返回 pending/slow_down）。
 *
 * @param deps - 注入的 `fetch` 与时钟。
 * @param device - 设备码。
 * @param signal - 取消信号。
 * @param emptyBodyStreak - **此前连续出现过多少次空正文 400**（F14）。
 *
 *   调用方（`login.ts` 的轮询循环）负责计数并把它传进来：本函数是纯的，
 *   不该自己持有跨调用状态（那会让「同一次轮询里第几次」变得不可测）。
 *   达到 {@link EMPTY_BODY_PENDING_TOLERANCE} 就不再兜底成 pending，改为报协议错误。
 * @returns 轮询结论。
 */
export async function pollDeviceToken(
  deps: OAuthHttpDeps,
  device: DeviceCode,
  signal?: AbortSignal,
  emptyBodyStreak = 0,
): Promise<PollResult> {
  const response = await deps.fetchImpl(`${authBaseOf(deps)}/console/auth/device/token`, {
    method: "POST",
    // 取消要能真正停掉在途轮询（F02）。网络层抛出的 abort 由调用方按取消处理。
    ...(signal === undefined ? {} : { signal }),
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: OAUTH_CLIENT_ID,
      device_code: device.deviceCode,
      grant_type: DEVICE_CODE_GRANT_TYPE,
    }),
  });
  /**
   * **超限不是 pending**（F13）；**坏 JSON 也不是空正文**（F19）。
   *
   * 用三态结论而不是 `undefined`：空正文是 pending 的正常表达，而 HTML 错误页 /
   * 被截断的正文是**协议错误** —— 两者混在一起会让坏 JSON 一直等到过期。
   */
  const parsed = await readBoundedJsonResult(response, OAUTH_MAX_BODY_BYTES);
  const payload = parsed.kind === "json" ? parsed.value : undefined;
  if (!response.ok) {
    const error = isRecord(payload) ? stringOf(payload, "error") : undefined;
    if (error === "authorization_pending") return { status: "pending" };
    if (error === "slow_down") return { status: "slow_down" };
    if (error === "access_denied") return { status: "denied" };
    if (error === "expired_token") return { status: "expired" };
    /**
     * **非空但解析不出来**：不是 pending（F19）。
     *
     * 上一版把「空正文」与「坏 JSON」都折叠成 `undefined`，于是服务端回一页 HTML
     * 错误页时，轮询会把它当成「用户还没授权」，一路等到设备码过期。现在立刻报错，
     * 并把正文长度带进 message 便于排查（不打印正文本身：可能含敏感信息）。
     */
    if (parsed.kind === "invalid") {
      return { status: "error", message: `device token endpoint returned HTTP ${response.status} with a non-JSON body` };
    }
    /**
     * **空 body 的 400**：有限次兜底成 pending（F14）。
     *
     * 历史上它正是「缺 `grant_type`」的畸形请求形态，所以兜底曾经救过那个 bug。
     * 但同一形态也可能表示参数错、协议变更或被代理拒绝 —— 而兜底成 pending 会让
     * 界面一直停在「等待授权」，直到设备码过期才报 timeout（实测轮询 300 次）。
     *
     * 现在：前 {@link EMPTY_BODY_PENDING_TOLERANCE} 次仍按 pending（容忍偶发抖动，
     * 也兼容真实的服务端行为），连续超过就判定为协议错误，让用户立刻看到问题。
     */
    if (parsed.kind === "empty" && response.status === 400) {
      // 标记出来源：调用方要区分「服务端明确说 pending」与「我们从空正文推断的」。
      if (emptyBodyStreak < EMPTY_BODY_PENDING_TOLERANCE) return { status: "pending", emptyBody: true };
      return {
        status: "error",
        message: `device token endpoint returned HTTP 400 with an empty body ${emptyBodyStreak + 1} times in a row`,
      };
    }
    return { status: "error", message: `device token request failed (HTTP ${response.status})` };
  }
  if (!isRecord(payload)) return { status: "error", message: "device token response is not an object" };
  /**
   * 成功载荷可能被包一层（该 Console 用 `_tag` 风格的编码）。
   *
   * 错误响应是 `{"_tag":"DeviceTokenError","error":…}` —— 说明服务端会给每个对象
   * 打上 `_tag`。成功的 token 也可能包在 `value` / `data` 里，所以两个都试，
   * 拿不到再用顶层。
   */
  const body =
    isRecord(payload.value) && stringOf(payload.value, "access_token") !== undefined
      ? payload.value
      : isRecord(payload.data) && stringOf(payload.data, "access_token") !== undefined
        ? payload.data
        : payload;
  const access = stringOf(body, "access_token");
  const refresh = stringOf(body, "refresh_token");
  const expiresIn = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : undefined;
  if (access === undefined || refresh === undefined || expiresIn === undefined) {
    return { status: "error", message: "device token response is missing access_token/refresh_token/expires_in" };
  }
  const now = deps.now?.() ?? Date.now();
  return { status: "success", access, refresh, expiresAt: now + Math.round(expiresIn * 1_000) };
}

/** Refresh failures retain HTTP status so temporary outages remain retryable. */
export class OAuthRefreshError extends Error {
  constructor(readonly status: number) {
    super(`token refresh failed (HTTP ${status})`);
    this.name = "OAuthRefreshError";
  }
}

/** 刷新一次 token；失败抛出（调用方按「不可用」处理）。 */
export async function refreshOAuthCredential(
  deps: OAuthHttpDeps,
  credential: OAuthCredential,
  signal?: AbortSignal,
): Promise<OAuthCredential> {
  const response = await deps.fetchImpl(`${authBaseOf(deps, credential)}/console/auth/device/token`, {
    method: "POST",
    /**
     * **必须把 signal 传下去**（2026-11-04 外部审查 U03）。
     *
     * 原来这里一个 signal 都不传：刷新请求一旦挂起，调用者的停止与总期限**都不起作用** ——
     * 请求既不完成也不抛错，宿主等不到终态，于是「停止」像没反应，
     * 自动重试也永远等不到机会（它要等前一次失败落定）。
     */
    ...(signal === undefined ? {} : { signal }),
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: credential.refresh,
      client_id: OAUTH_CLIENT_ID,
    }),
  });
  const payload = await readJson(response);
  if (!response.ok || !isRecord(payload)) throw new OAuthRefreshError(response.status);
  const access = stringOf(payload, "access_token");
  const refresh = stringOf(payload, "refresh_token") ?? credential.refresh;
  const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : undefined;
  if (access === undefined || expiresIn === undefined) throw new Error("token refresh response is missing access_token/expires_in");
  const now = deps.now?.() ?? Date.now();
  return { ...credential, access, refresh, expiresAt: now + Math.round(expiresIn * 1_000) };
}

/** 读工作区；读不到或形状不认识时 `undefined`（登录流按失败处理）。 */
export async function fetchOAuthOrg(
  deps: OAuthHttpDeps,
  access: string,
  signal?: AbortSignal,
): Promise<{ id: string; name?: string } | undefined> {
  const response = await deps.fetchImpl(`${authBaseOf(deps)}/console/api/orgs`, {
    // 同上：这是登录流程的第三个网络阶段，取消必须能打断它（F02）。
    ...(signal === undefined ? {} : { signal }),
    headers: { authorization: `Bearer ${access}`, accept: "application/json" },
  });
  if (!response.ok) return undefined;
  const payload = await readJson(response);
  /**
   * 列表可能在顶层、`orgs`、`data`，或包在 `value` 里
   * （该 Console 用 `_tag` 风格的编码 —— 错误响应就是 `{"_tag":"Unauthorized"}`，
   * 成功也可能包一层 value）。
   */
  const items = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.orgs)
      ? payload.orgs
      : isRecord(payload) && Array.isArray(payload.data)
        ? payload.data
        : isRecord(payload) && Array.isArray(payload.value)
          ? payload.value
          : [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = stringOf(item, "id");
    if (id === undefined) continue;
    const name = stringOf(item, "name");
    return { id, ...(name === undefined ? {} : { name }) };
  }
  return undefined;
}

/** 把 blob 变成一次请求可用的 access token 与头；过期则刷新。 */
export async function resolveOAuthCredential(
  raw: string,
  deps: OAuthHttpDeps,
  options?: { signal?: AbortSignal; throwOnTransient?: boolean },
): Promise<{ key: string; headers: Record<string, string>; updated?: string } | undefined> {
  const credential = parseOAuthCredential(raw);
  if (credential === undefined) return undefined;
  if (!needsRefresh(credential, deps.now?.() ?? Date.now())) {
    return { key: credential.access, headers: { "x-opencode-org-id": credential.orgId } };
  }
  if (credential.refresh === "") return undefined;
  try {
    // 把调用者的 signal 传下去：停止时刷新必须立刻结束（审查 U03）。
    const refreshed = await refreshOAuthCredential(deps, credential, options?.signal);
    return {
      key: refreshed.access,
      headers: { "x-opencode-org-id": refreshed.orgId },
      updated: serializeOAuthCredential(refreshed),
    };
  } catch (error) {
    if (options?.throwOnTransient && (!(error instanceof OAuthRefreshError) || error.status === 408 || error.status === 429 || error.status >= 500)) throw error;
    return undefined;
  }
}
