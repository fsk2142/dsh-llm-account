//#region src/core/catalog-flight.ts
/** 调用方取消时的错误码（与 `core/transport` 的 `ABORTED` 同一约定）。 */
const ABORTED = "ABORTED";
/**
* 造一个按键隔离的目录读取器。
* @param options - TTL、超时与加载函数。
* @returns 读取端口。
*/
function createCatalogFlight(options) {
	const now = options.now ?? Date.now;
	const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs >= 0 ? options.ttlMs : 0;
	const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 0;
	/** 键 → 缓存条目。**按键入**：不同网关/账号各有各的缓存。 */
	const cache = /* @__PURE__ */ new Map();
	/** 键 → 在途请求。 */
	const flights = /* @__PURE__ */ new Map();
	/** 全局代号：任何一次新加载都推进它，旧一代据此知道自己过期了。 */
	let generationSeq = 0;
	return { async read(key, readOptions = {}) {
		const { signal, fresh = false } = readOptions;
		if (!fresh) {
			const cached = cache.get(key);
			if (cached !== void 0 && now() - cached.at <= ttlMs) return cached.value;
		}
		if (signal?.aborted === true) throw abortedError(signal);
		if (fresh) {
			generationSeq += 1;
			flights.delete(key);
		}
		const existing = flights.get(key);
		const flight = existing ?? startFlight(key);
		if (existing !== void 0) existing.waiters += 1;
		return waitFor(flight, signal);
	} };
	/**
	* 起一次新加载。
	* @param key - 复合键。
	* @returns 在途条目（`waiters` 初始为 1）。
	*/
	function startFlight(key) {
		const controller = new AbortController();
		const flight = {
			key,
			generation: generationSeq,
			controller,
			promise: void 0,
			waiters: 1
		};
		const signals = [controller.signal];
		if (timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
		const requestSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
		flight.promise = options.load(key, requestSignal).then((value) => {
			if (flight.generation === generationSeq) cache.set(key, {
				at: now(),
				value
			});
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
