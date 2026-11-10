//#region src/core/catalog-flight.ts
/**
* 失败降级窗口的默认值（6 小时）。
*
* ## 为什么默认开，而不是默认关（2026-11-10）
*
* 用户报「开 VPN 时连不上网关，就一个模型都没有、也选不了」。
*
* 机制是：目录请求有 10 秒硬超时，失败**不写缓存**，而且这里原本**没有**任何
* 「拿上一次成功值顶一下」的降级 —— 于是一次网络抖动 = 模型列表整体消失。
* 列表没了，模型自然不可选；用户连「换一个模型试试」这条路都没有。
*
* 这与本模块其它设计目标是同一件事：**读不到 ≠ 不存在**。缺失不等于 0，
* 一次失败也不该等于「这个厂商没有模型」。
*
* 窗口取 6 小时：长到足以熬过 VPN 抖动、DNS 抽风、网关短暂 5xx；短到不至于
* 拿一份隔夜的目录去骗人（厂商上下架模型的节奏是「天」级，不是「分钟」级）。
*/
const DEFAULT_STALE_MS = 216e5;
/** 调用方取消时的错误码（与 `core/transport` 的 `ABORTED` 同一约定）。 */
const ABORTED = "ABORTED";
/**
* 造一个按键隔离的目录读取器。
* @param options - TTL、超时、降级窗口与加载函数。
* @returns 读取端口。
*/
function createCatalogFlight(options) {
	const now = options.now ?? Date.now;
	const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs >= 0 ? options.ttlMs : 0;
	const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 0;
	/** 降级窗口；`0` = 关闭。非有限值回落到默认值，而不是悄悄关掉。 */
	const staleMs = options.staleMs === void 0 ? DEFAULT_STALE_MS : Number.isFinite(options.staleMs) && options.staleMs > 0 ? options.staleMs : 0;
	const isRecoverable = options.isRecoverable ?? defaultIsRecoverable;
	/** 键 → 缓存条目。**按键入**：不同网关/账号各有各的缓存。 */
	const cache = /* @__PURE__ */ new Map();
	/**
	* 键 → **最后一次成功**的值。
	*
	* 与 {@link cache} 刻意分开：`cache` 会因为 TTL 过期而不再被采用，而这里保留
	* 的是「真正从网络读到过的最后一次结果」，专门用于失败降级。
	* 只在**最新一代**成功时写入（与 `cache` 同一道守卫），避免旧请求晚到把它们覆盖。
	*/
	const lastGood = /* @__PURE__ */ new Map();
	/** 键 → 在途请求。 */
	const flights = /* @__PURE__ */ new Map();
	/**
	* 键 → 该键自己的代号（epoch）。
	*
	* ## 为什么**不能**用全局标量（2026-11-10 审查 A01）
	*
	* 原来是一个 `let generationSeq = 0`，任何键执行 `fresh` 都 `+= 1`。于是：
	*
	* 1. A 键的请求还在途中；
	* 2. B 键点了刷新（`fresh`），全局代号 +1；
	* 3. A 键的请求成功返回，却因为 `flight.generation !== generationSeq` 而
	*    **写不进自己的 `cache`，也写不进 `lastGood`**；
	* 4. 下次读 A：缓存没有 → 又发一次请求（白花一次网络）；
	*    若那一次恰好失败 → **连降级值都没有**（A01 里最实际的损失）。
	*
	* 代际的作用本来只是「同一个键的旧请求别覆盖新结果」，跨键毫无关系。
	* 改成按 key 保存之后，刷 B 不再影响 A。
	*/
	const epochs = /* @__PURE__ */ new Map();
	/**
	* 读某个键当前的代号。
	* @param key - 复合键。
	* @returns 该键的代号（从未刷新过则为 0）。
	*/
	const epochOf = (key) => epochs.get(key) ?? 0;
	return { async read(key, readOptions = {}) {
		const { signal, fresh = false } = readOptions;
		if (!fresh) {
			const cached = cache.get(key);
			if (cached !== void 0 && now() - cached.at <= ttlMs) return cached.value;
		}
		if (signal?.aborted === true) throw abortedError(signal);
		if (fresh) {
			epochs.set(key, epochOf(key) + 1);
			flights.delete(key);
		}
		const existing = flights.get(key);
		const flight = existing ?? startFlight(key);
		if (existing !== void 0) existing.waiters += 1;
		try {
			return await waitFor(flight, signal);
		} catch (error) {
			const fallback = fallbackFor(key, error);
			if (fallback !== void 0) return fallback;
			throw error;
		}
	} };
	/**
	* 取降级值。
	* @param key - 复合键。
	* @param error - 本次失败。
	* @returns 可用的旧值；不该降级时为 `undefined`。
	*/
	function fallbackFor(key, error) {
		if (staleMs <= 0) return void 0;
		if (isCallerAbort(error)) return void 0;
		if (!isRecoverable(error)) return void 0;
		const last = lastGood.get(key);
		if (last === void 0) return void 0;
		if (now() - last.at > staleMs) return void 0;
		return last.value;
	}
	/**
	* 起一次新加载。
	* @param key - 复合键。
	* @returns 在途条目（`waiters` 初始为 1）。
	*/
	function startFlight(key) {
		const controller = new AbortController();
		const flight = {
			key,
			generation: epochOf(key),
			controller,
			promise: void 0,
			waiters: 1
		};
		const signals = [controller.signal];
		if (timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
		const requestSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
		flight.promise = options.load(key, requestSignal).then((value) => {
			if (flight.generation === epochOf(key)) {
				const at = now();
				cache.set(key, {
					at,
					value
				});
				lastGood.set(key, {
					at,
					value
				});
			}
			return value;
		});
		flights.set(key, flight);
		flight.promise.catch(() => {}).finally(() => {
			if (flights.get(key) === flight) flights.delete(key);
		});
		return flight;
	}
	/**
	* 等一次加载的结果，把「调用方取消」与「加载失败」分开。
	* @param flight - 在途条目。
	* @param signal - 本调用方的取消信号。
	* @returns 加载结果。
	*/
	async function waitFor(flight, signal) {
		if (signal === void 0) return flight.promise;
		if (signal.aborted) {
			releaseWaiter(flight);
			throw abortedError(signal);
		}
		let onAbort;
		const aborted = new Promise((_resolve, reject) => {
			onAbort = () => {
				releaseWaiter(flight);
				reject(abortedError(signal));
			};
			signal.addEventListener("abort", onAbort, { once: true });
		});
		try {
			return await Promise.race([flight.promise, aborted]);
		} finally {
			if (onAbort !== void 0) signal.removeEventListener("abort", onAbort);
		}
	}
	/**
	* 一个等待者放弃；全部走光才 abort 共享请求（否则一个组件取消会拖死其他人）。
	* @param flight - 在途条目。
	*/
	function releaseWaiter(flight) {
		flight.waiters -= 1;
		if (flight.waiters > 0) return;
		if (flights.get(flight.key) === flight) flights.delete(flight.key);
		if (!flight.controller.signal.aborted) flight.controller.abort();
	}
}
/**
* 这个错误是不是「调用方自己取消的」。
*
* 只认本模块自己产生的 `ABORTED`；内部超时不算 —— 超时是**故障**，正需要降级。
* @param error - 待判定的错误。
* @returns 是调用方取消时为 `true`。
*/
function isCallerAbort(error) {
	return typeof error === "object" && error !== null && error.code === ABORTED;
}
/**
* 默认的「能否降级」判断。
*
* | 情形 | 能否降级 | 理由 |
* | --- | --- | --- |
* | 没有 status（网络断开 / DNS / 超时 / 正文不是 JSON） | **能** | 典型的环境抖动，正是用户要熬过去的那种 |
* | `5xx` | **能** | 网关自己出问题，与我们的配置无关 |
* | `401` / `403` / `404` 等 4xx | **不能** | 密钥错了、地址写错了 —— 拿旧值盖住会让用户永远查不出原因 |
*
* @param error - 加载抛出的错误。
* @returns 允许降级时为 `true`。
*/
function defaultIsRecoverable(error) {
	if (isCallerAbort(error)) return false;
	const status = statusOf(error);
	if (status === void 0) return true;
	return status >= 500;
}
/**
* 从错误对象上读 HTTP 状态码（各家适配器放在 `status` 上）。
* @param error - 待读取的错误。
* @returns 状态码；没有则 `undefined`。
*/
function statusOf(error) {
	if (typeof error !== "object" || error === null) return void 0;
	const status = error.status;
	return typeof status === "number" && Number.isFinite(status) ? status : void 0;
}
/**
* 调用方取消时的错误。
*
* 用 `code: "ABORTED"` 而不是自定义类：上游（适配器的失败分类）已经按这个码
* 区分「用户取消」与「真实故障」，复用同一条判定比新增一套更不容易漏。
* @param signal - 已取消的信号。
* @returns 带 `ABORTED` 码的错误。
*/
function abortedError(signal) {
	const error = /* @__PURE__ */ new Error("the caller aborted the catalog read");
	Object.assign(error, {
		code: ABORTED,
		...signal.reason === void 0 ? {} : { cause: signal.reason }
	});
	return error;
}
//#endregion
//#region src/vendors/gateway-access.ts
/** 已登记的访问器（`provider` → 访问器）。 */
const accessors = /* @__PURE__ */ new Map();
/**
* 登记一家的网关访问。
* @param provider - provider 路由 id（`commandcode` / `dsh-opencode-go` / `opendesign`）。
* @param access - 访问器；每次调用都现读设置与凭据。
*/
function registerGatewayAccess(provider, access) {
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
async function gatewayAccessOf(provider) {
	const access = accessors.get(provider);
	if (access === void 0) return void 0;
	try {
		return await access();
	} catch {
		return;
	}
}
//#endregion
export { registerGatewayAccess as n, createCatalogFlight as r, gatewayAccessOf as t };
