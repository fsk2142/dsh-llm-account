/**
 * 跨行的「网关访问」注册表：搜索的网关路必须用 **opendesign** 的密钥与基地址，
 * 而搜索 provider 只在 commandcode 一行注册（三行都注册会撞宿主的
 * `WEB_DUPLICATE_PROVIDER`）。
 *
 * ## 为什么需要它（2026-10-20 审计修掉的真 bug）
 *
 * 旧代码里 commandcode 的 `gatewayAccess("opendesign")` 读的是**自己行**的
 * `apiKeyEnv` / `apiBase`：会话在 opendesign + DeepSeek 模型上时，搜索请求拿着
 * **commandcode 的密钥**打 **commandcode 的端点**（实测 400：那个端点只收 Claude 系）。
 * 网关路等于从来没有通过过 —— 而它是默认策略（`gateway-first`）的第一选择，
 * 于是「配了 commandcode 账号的人」搜索永远失败，且不会回退到 API key。
 *
 * ## 形状与纪律（与 `model-catalog-registry` 同源）
 *
 * - 三条 provider 行在同一个进程里跑，各自 `apply` 时登记自己那一份；
 * - 登记用 `provider` 作键，重复登记覆盖（同一行重载时不该出现两份）；
 * - 本模块被多行 import，打包进**共享 chunk**，所以三行的登记互相可见；
 * - 取用是**用时现取**（不是登记时拷一份）：账号/密钥改了立刻反映。
 * @module dsh-llm-account/src/vendors/gateway-access
 */

/** 一家的网关访问：基地址与推理密钥。 */
export interface GatewayAccess {
  /** 推理基地址（厂商的 messages 端点挂在哪）。 */
  baseURL: string;
  /** 推理密钥（Bearer / x-api-key 同一把）。 */
  key: string;
}

/** 取一家网关的访问；不可用时返回 `undefined`（**不抛**）。 */
export type GatewayAccessor = () => Promise<GatewayAccess | undefined>;

/** 已登记的访问器（`provider` → 访问器）。 */
const accessors = new Map<string, GatewayAccessor>();

/**
 * 登记一家的网关访问。
 * @param provider - provider 路由 id（`commandcode` / `dsh-opencode-go` / `opendesign`）。
 * @param access - 访问器；每次调用都现读设置与凭据。
 */
export function registerGatewayAccess(provider: string, access: GatewayAccessor): void {
  accessors.set(provider, access);
}

/**
 * 取一家网关的访问。
 *
 * 三类「不可用」都读作 `undefined`，并且**绝不抛**：没登记这家、这家没配账号、
 * 访问器自己炸了（装配故障）。一家不好不该让搜索整块不可用 —— 还有 API key 那条路。
 * @param provider - provider 路由 id。
 * @returns 网关访问，或 `undefined`。
 */
export async function gatewayAccessOf(provider: string): Promise<GatewayAccess | undefined> {
  const access = accessors.get(provider);
  if (access === undefined) return undefined;
  try {
    return await access();
  } catch {
    return undefined;
  }
}
