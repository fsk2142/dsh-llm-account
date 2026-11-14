import { X as repairLegacyContinueMessages, Y as applyAutoContinue } from "./switching-L7Mzn1Tc.js";
import { lastAssistantStreamChunk } from "@deepseek-ai/dsh-llm";
//#region src/vendors/auto-continue-wiring.ts
/** 一个记录的 `isRecord` 窄化（跨远程边界的形状不可信）。 */
function isRecord(value) {
	return typeof value === "object" && value !== null;
}
/**
* 读设置文档里的「自动继续开关」。
*
* ## 三条优先级（与 commandcode 那一份同义，但那一份还多了一层「原始文档」判定）
*
* 1. **显式 `autoContinue`** 优先：用户在界面上打开/关闭它，那就是最终决定；
* 2. `autoContinue` 缺失时看两个**旧字段**（v1.4.0 之前拆成
*    `autoContinueOnError` / `autoContinueOnTruncate`）—— 任一为 true 就当作开启，
*    否则升级后原本开着的用户会被静默关掉；
* 3. 都没有 → `false`（默认关闭，与 schema 的 `default(false)` 一致）。
*
* 为什么不能只读 `autoContinue`：`z.object` 会**剥掉**未声明字段，所以旧字段必须在
* schema 里显式声明才读得到（三家 schema 都这么做了）。它们**没有 default** ——
* 未提供是 `undefined`，与「用户显式关着」区分得开。
*
* @param document - 设置文档（形状不可信）。
* @returns 是否开启。
*/
/**
* 读设置文档里的「自动继续开关」。
*
* ## 两种调用方式，因为「有没有原始文档」决定了能不能分清「没配过」与「显式关」
*
* 实测（`tests/vendors/auto-continue-switch-semantics.test.ts`）：
* `schemastery` 的 `z.boolean().default(false)` 在解析后**会把字段填成 `false`**，
* 于是 `Object.hasOwn(parsed, "autoContinue")` **恒为 `true`** ——
* 「用户没配过」与「用户显式关着」在**解析后**的文档里长得一模一样。
*
* 所以：
*
* | 传入的文档 | `authoritative` | 判据 | 结果 |
* | --- | --- | --- | --- |
* | 原始文档（未经 schema 解析，如 commandcode 的 `rawDocument`） | `true` | `hasOwn` | 显式 `false` **优先**，旧字段不复活 |
* | 解析后的文档（opendesign / opencode 目前只有这一份） | 缺省 | 只看值 | 任一条 `true` 即开启（**宁开不关**） |
*
* ## 为什么非权威模式下选择「宁开不关」
*
* 解析后 `autoContinue` 恒存在且默认 `false`。若据此否掉旧字段，**升级用户**
*（只写过 `autoContinueOnTruncate: true` 的那批）会发现「以前开着的自动继续突然关了」。
* 那是静默关掉用户的功能 —— 比「显式关掉后可能被旧字段复活」更糟。
*
* 代价如实记：非权威模式下**「显式关掉 + 旧字段残留 true」会被旧字段重新打开**。
* 要彻底解决，另两家也得像 commandcode 一样读一份原始文档 —— 留给下一版。
*
* @param document - 设置文档（**一定要说清是哪一种**）。
* @param options - `authoritative: true` 表示这是未经 schema 解析的原始文档。
* @returns 是否开启。
*/
function autoContinueEnabledOf(document, options = {}) {
	if (options.authoritative === true) {
		if (Object.hasOwn(document, "autoContinue")) return document["autoContinue"] === true;
		return document["autoContinueOnError"] === true || document["autoContinueOnTruncate"] === true;
	}
	return document["autoContinue"] === true || document["autoContinueOnError"] === true || document["autoContinueOnTruncate"] === true;
}
/**
* 接线自动继续。
*
* @param ctx - 插件上下文（只需要 `on` 与 `get`）。
* @param settings - **函数**而不是快照：`loader/volatile-update` 不会重跑 apply，
*   快照会让「运行时改开关/次数/间隔」全部不生效。
* @param vendorLabel - 只用于诊断日志。
* @returns 注销函数（把注册的事件都摘掉）。
*/
function wireAutoContinue(ctx, settings, vendorLabel) {
	const host = ctx;
	const events = host;
	/** 按 session.id 记下最近一轮的 finish（只读当前轮，避免拿上一轮的判断这一轮）。 */
	const finishesBySession = /* @__PURE__ */ new Map();
	/** 只允许**当前执行作用域**选 inbox：从别的 agent 那里拿会发错会话。 */
	const agentOfCurrentRun = () => {
		try {
			const get = host.get;
			const current = (typeof get === "function" ? get.call(host, "agents") : void 0)?.currentInitiator?.();
			if (!isRecord(current) || !isRecord(current.session) || typeof current.session.id !== "string") return;
			if (!isRecord(current.inbox) || typeof current.inbox.append !== "function") return void 0;
			return current;
		} catch {
			return;
		}
	};
	const offPreStep = events.on("agent/pre-step", (payload, next) => {
		const record = isRecord(payload) ? payload : void 0;
		if (record !== void 0) repairLegacyContinueMessages(record["messages"]);
		return typeof next === "function" ? next() : void 0;
	});
	const offSession = events.on("session/event", (session, event) => {
		if (!isRecord(event) || event["type"] !== "assistant/message") return;
		const data = isRecord(event["data"]) ? event["data"] : void 0;
		if (data === void 0) return;
		const finish = Array.isArray(data["stream"]) ? lastAssistantStreamChunk(data["stream"], "finish")?.reason : void 0;
		if (!isRecord(finish) || typeof finish["kind"] !== "string") return;
		if (!isRecord(session) || typeof session["id"] !== "string" || session["id"].length === 0) return;
		const turn = data["turn"];
		if (typeof turn !== "number" || !Number.isSafeInteger(turn)) return;
		const failureRaw = finish["failure"];
		const failure = isRecord(failureRaw) ? failureRaw : void 0;
		const code = failure === void 0 ? void 0 : failure["code"];
		finishesBySession.set(session["id"], {
			turn,
			kind: finish["kind"],
			...typeof code === "string" && code !== "" ? { failureCode: code } : {}
		});
		if (finishesBySession.size > 128) {
			const oldest = finishesBySession.keys().next().value;
			if (oldest !== void 0) finishesBySession.delete(oldest);
		}
	});
	try {
		applyAutoContinue(host, settings, {
			get inbox() {
				return agentOfCurrentRun()?.inbox;
			},
			lastFinishReason: (sessionId, turn) => {
				const finish = finishesBySession.get(sessionId);
				return finish?.turn === turn ? finish.kind : void 0;
			}
		});
	} catch (error) {
		console.error(`[dsh-llm-account] ${vendorLabel}: auto-continue wiring failed:`, error);
		return () => void 0;
	}
	return () => {
		try {
			if (typeof offPreStep === "function") offPreStep();
		} catch {}
		try {
			if (typeof offSession === "function") offSession();
		} catch {}
	};
}
//#endregion
export { wireAutoContinue as n, autoContinueEnabledOf as t };
