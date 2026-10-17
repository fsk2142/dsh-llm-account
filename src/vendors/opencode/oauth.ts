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
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "error"; message: string }
  | { status: "success"; access: string; refresh: string; expiresAt: number };

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

/** 读 JSON；非 2xx 不抛（调用方按端点语义处理）。 */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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

/** Console 基地址（去掉结尾斜杠）。 */
function authBaseOf(deps: OAuthHttpDeps, credential?: OAuthCredential): string {
  const base = deps.authBase ?? credential?.authBase ?? DEFAULT_AUTH_BASE;
  return base.replace(/\/+$/, "");
}

/** 申请设备码。 */
export async function beginDeviceFlow(deps: OAuthHttpDeps): Promise<DeviceCode> {
  const response = await deps.fetchImpl(`${authBaseOf(deps)}/console/auth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: OAUTH_CLIENT_ID }),
  });
  const payload = await readJson(response);
  if (!response.ok || !isRecord(payload)) throw new Error(`device code request failed (HTTP ${response.status})`);
  const deviceCode = stringOf(payload, "device_code");
  const userCode = stringOf(payload, "user_code");
  const verificationUri = stringOf(payload, "verification_uri") ?? stringOf(payload, "verification_uri_complete");
  if (deviceCode === undefined || userCode === undefined || verificationUri === undefined) {
    throw new Error("device code response is missing device_code/user_code/verification_uri");
  }
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

/** 用设备码换一次 token（可能返回 pending/slow_down）。 */
export async function pollDeviceToken(deps: OAuthHttpDeps, device: DeviceCode): Promise<PollResult> {
  const response = await deps.fetchImpl(`${authBaseOf(deps)}/console/auth/device/token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: OAUTH_CLIENT_ID, device_code: device.deviceCode }),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const error = isRecord(payload) ? stringOf(payload, "error") : undefined;
    if (error === "authorization_pending") return { status: "pending" };
    if (error === "slow_down") return { status: "slow_down" };
    if (error === "access_denied") return { status: "denied" };
    if (error === "expired_token") return { status: "expired" };
    return { status: "error", message: `device token request failed (HTTP ${response.status})` };
  }
  if (!isRecord(payload)) return { status: "error", message: "device token response is not an object" };
  const access = stringOf(payload, "access_token");
  const refresh = stringOf(payload, "refresh_token");
  const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : undefined;
  if (access === undefined || refresh === undefined || expiresIn === undefined) {
    return { status: "error", message: "device token response is missing access_token/refresh_token/expires_in" };
  }
  const now = deps.now?.() ?? Date.now();
  return { status: "success", access, refresh, expiresAt: now + Math.round(expiresIn * 1_000) };
}

/** 刷新一次 token；失败抛出（调用方按「不可用」处理）。 */
export async function refreshOAuthCredential(deps: OAuthHttpDeps, credential: OAuthCredential): Promise<OAuthCredential> {
  const response = await deps.fetchImpl(`${authBaseOf(deps, credential)}/console/auth/device/token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: credential.refresh,
      client_id: OAUTH_CLIENT_ID,
    }),
  });
  const payload = await readJson(response);
  if (!response.ok || !isRecord(payload)) throw new Error(`token refresh failed (HTTP ${response.status})`);
  const access = stringOf(payload, "access_token");
  const refresh = stringOf(payload, "refresh_token") ?? credential.refresh;
  const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : undefined;
  if (access === undefined || expiresIn === undefined) throw new Error("token refresh response is missing access_token/expires_in");
  const now = deps.now?.() ?? Date.now();
  return { ...credential, access, refresh, expiresAt: now + Math.round(expiresIn * 1_000) };
}

/** 读工作区；读不到或形状不认识时 `undefined`（登录流按失败处理）。 */
export async function fetchOAuthOrg(deps: OAuthHttpDeps, access: string): Promise<{ id: string; name?: string } | undefined> {
  const response = await deps.fetchImpl(`${authBaseOf(deps)}/console/api/orgs`, {
    headers: { authorization: `Bearer ${access}`, accept: "application/json" },
  });
  if (!response.ok) return undefined;
  const payload = await readJson(response);
  const items = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.orgs)
      ? payload.orgs
      : isRecord(payload) && Array.isArray(payload.data)
        ? payload.data
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
): Promise<{ key: string; headers: Record<string, string>; updated?: string } | undefined> {
  const credential = parseOAuthCredential(raw);
  if (credential === undefined) return undefined;
  if (!needsRefresh(credential, deps.now?.() ?? Date.now())) {
    return { key: credential.access, headers: { "x-opencode-org-id": credential.orgId } };
  }
  if (credential.refresh === "") return undefined;
  try {
    const refreshed = await refreshOAuthCredential(deps, credential);
    return {
      key: refreshed.access,
      headers: { "x-opencode-org-id": refreshed.orgId },
      updated: serializeOAuthCredential(refreshed),
    };
  } catch {
    // 刷新失败：旧 access token 已过期，**不能**继续用；调用方按缺凭据处理。
    return undefined;
  }
}
