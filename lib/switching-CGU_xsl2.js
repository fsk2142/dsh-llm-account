import { LlmError, createUserMessage, fileHandleText } from "@deepseek-ai/dsh-llm";
import { credentialRef, isCredentialRefName } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
//#region src/core/credentials.ts
/**
* 归一化一个候选密钥：裁剪首尾空白后判定非空。
* 非字符串（例如设置文档里写错类型的值）与空串/纯空白一律视为未配置。
* @param raw - 未经校验的候选值。
* @returns 裁剪后的密钥，或 `undefined` 表示未配置。
*/
function normalizeKey(raw) {
	if (typeof raw !== "string") return void 0;
	const trimmed = raw.trim();
	return trimmed === "" ? void 0 : trimmed;
}
/**
* 按优先级挑选密钥。高优先级的来源为空串或纯空白时继续往下找。
* @param sources - 已收集到的候选来源；调用方负责读取，缺失的来源留空即可。
* @returns 第一把可用密钥及其来源；都不可用时 `key` 与 `source` 同时为 `undefined`。
*/
function pickApiKey(sources) {
	const ordered = [
		{
			source: "literal",
			raw: sources.literal
		},
		{
			source: "stored",
			raw: sources.stored
		},
		{
			source: "environment",
			raw: sources.environment
		},
		{
			source: "auth-file",
			raw: sources.authFile
		}
	];
	for (const { source, raw } of ordered) {
		const key = normalizeKey(raw);
		if (key !== void 0) return {
			key,
			source
		};
	}
	return {
		key: void 0,
		source: void 0
	};
}
//#endregion
//#region src/core/accounts.ts
/** ref 前缀：账号 ref 同时充当凭据槽名，前缀把它与用户手写的引用名区分开。 */
const REF_PREFIX = "DSH_LLM_ACCOUNT";
/**
* 合法凭据引用名（Global Constraints）。槽判定与两个厂商的条目/字段校验共用这一份：
* 「这个值是不是一个 ref」是哨兵词汇的一部分（`invalid` 与「自动轮换」是两种不同的读法），
* 两处各写一份迟早会走偏。
*/
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 哈希后缀的十六进制位数（48 位）：足够隔离标签转义碰撞，同时保持槽名可读。 */
const HASH_SUFFIX_LENGTH = 12;
const FNV_OFFSET_BASIS = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const UINT64_MASK = 18446744073709551615n;
/**
* 把任意文本折进 `[A-Z0-9_]`：先转大写，再把每个非法字符替换成 `_`（不折叠连续下划线）。
* 不做折叠是刻意的：折叠会丢失信息，反而让不同标签更容易撞名。
* @param text - 待转义的文本（厂商 id 或账号标签）。
* @returns 只含大写字母、数字与下划线的文本。
*/
function escapeText(text) {
	return text.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}
/**
* 计算文本的 64 位 FNV-1a 哈希，返回 16 位十六进制。
* 哈希输入是**原始**文本：标签转义后同名时，靠这里区分。
* @param text - 原始文本。
* @returns 16 位小写十六进制字符串。
*/
function hashText(text) {
	let hash = FNV_OFFSET_BASIS;
	for (const char of text) {
		hash = (hash ^ BigInt(char.codePointAt(0) ?? 0)) & UINT64_MASK;
		hash = hash * FNV_PRIME & UINT64_MASK;
	}
	return hash.toString(16).padStart(16, "0");
}
/**
* 由厂商与账号标签推导账号 ref（同时用作凭据槽名）。
*
* 形状为 `DSH_LLM_ACCOUNT_<VENDOR>_<LABEL>_<HASH>`：厂商与标签先转大写，
* 非 `[A-Za-z0-9_]` 的字符替换成 `_`；后缀是原始 `(vendor, label)` 的短哈希，
* 因此「标签不同、转义后同名」也会得到两个不同 ref。结果必满足凭据引用名的
* 合法字符集 `^[A-Za-z_][A-Za-z0-9_]*$`（前缀以字母开头，其余部分只有字母、数字、下划线）。
*
* 标签按原样参与推导（不去空白、不折叠大小写），所以两个仅在空白或大小写上不同的
* 标签仍是两个账号，不会静默共用一个凭据槽。
* @param vendor - 该账号所属的 provider 路由。
* @param label - 用户可见名称。
* @returns 该账号的 ref，可安全用作凭据槽名。
*/
function accountRef(vendor, label) {
	const suffix = hashText(`${vendor}\u0000${label}`).slice(0, HASH_SUFFIX_LENGTH);
	return `${REF_PREFIX}_${escapeText(vendor)}_${escapeText(label)}_${suffix}`;
}
/**
* 按 ref 去重，保留每个 ref **第一次**出现的条目（不合并字段），相对顺序不变。
* 同一个 ref 在顺序里出现多次会让它被多算一轮，因此只留第一个。
* @param views - 账号行的展示视图，可能含重复 ref。
* @returns 去重后的新数组；入参不被修改。
*/
function dedupeByRef(views) {
	const seen = /* @__PURE__ */ new Set();
	const kept = [];
	for (const view of views) {
		if (seen.has(view.ref)) continue;
		seen.add(view.ref);
		kept.push(view);
	}
	return kept;
}
/**
* 把 ref 移到目标位置。`toIndex` 的语义是「移动后的最终下标」，越界夹到两端。
* ref 不在列表里时不做任何改动（返回等值的新数组）。
* @param order - 当前账号顺序。
* @param ref - 要移动的账号 ref。
* @param toIndex - 移动后的最终下标；超出范围时夹到 `[0, order.length - 1]`。
* @returns 新的顺序数组；入参不被修改。
*/
function reorder(order, ref, toIndex) {
	const next = [...order];
	const from = next.indexOf(ref);
	if (from === -1) return next;
	next.splice(from, 1);
	next.splice(Math.min(Math.max(toIndex, 0), next.length), 0, ref);
	return next;
}
/**
* 把「派生顺序」与用户手动排序（`accountOrder`）合并成最终顺序。
*
* 规则（设计 `2026-10-17-switching-models-density-design.md` §5.1）：
* 1. 覆盖值必须是数组；只收非空字符串、去重、**只保留派生顺序里存在的 ref**（不存在的
*    账号不参与轮换）；
* 2. 覆盖里合法的项按覆盖顺序排在前面，派生顺序里没出现的项追加在末尾（新账号不会因为
*    用户排过序就消失）；
* 3. 清洗后为空（字段缺失/坏形状/全部是旧 ref）→ 原样返回派生顺序。
*
* @param derived - 厂商从文档推导出的顺序（顶层默认账号 + `accounts[]`，已去重）。
* @param override - 设置文档里的 `accountOrder` 原始值（形状不可信）。
* @returns 最终轮换顺序；不修改入参。
*/
function orderWithOverride(derived, override) {
	const base = [...new Set(derived)];
	if (!Array.isArray(override)) return base;
	const known = new Set(base);
	const ordered = [];
	const seen = /* @__PURE__ */ new Set();
	for (const item of override) {
		if (typeof item !== "string") continue;
		const ref = item.trim();
		if (ref === "" || !known.has(ref) || seen.has(ref)) continue;
		seen.add(ref);
		ordered.push(ref);
	}
	if (ordered.length === 0) return base;
	for (const ref of base) if (!seen.has(ref)) ordered.push(ref);
	return ordered;
}
/**
* 厂商在**全局顺序**里的投影。
*
* 全局 `accountOrder` 存的是 `${vendor}:${ref}`：两份设置文档都保存同一份完整顺序，
* 每家只投影出自己的账号。旧文档里的裸 ref 仍按本厂商限定处理（零迁移）。
* @param derived - 本厂商的 ref（顶层默认账号 + 账号表，已去重）。
* @param override - 设置文档里的 `accountOrder`（内容可能是全局键或旧裸 ref）。
* @param vendor - 本厂商 provider id。
* @returns 本厂商账号在全局顺序里的排列。
*/
function globalOrderOfVendor(derived, override, vendor) {
	const prefix = `${vendor}:`;
	const normalized = Array.isArray(override) ? override.map((item) => {
		if (typeof item !== "string") return item;
		const ref = item.trim();
		if (ref === "") return item;
		return ref.startsWith(prefix) || ref.includes(":") ? ref : `${prefix}${ref}`;
	}) : override;
	return orderWithOverride(derived.map((ref) => `${prefix}${ref}`), normalized).map((key) => key.slice(prefix.length));
}
/**
* 把一项提到首位，其余项的**相对顺序不变**（旧插件 `moveAccountFirst` 第 6779 行）。
*
* 与 {@link reorder} 的分工：`reorder` 服务于「用户拖动排序」这一写入路径（下标语义、
* 越界夹取），本函数服务于「当前账号是谁就显示在第一位」这一**派生**读取 —— 账号端口
* 的 `list()` 用它让界面顺序与轮换顺序（顶层引用恒在首位）一致，不因此写任何设置。
* ref 不在列表里、或已经是首位时原样返回（调用方据此跳过无谓的写入）。
* @param rows - 当前顺序。
* @param ref - 要提到首位的 ref。
* @returns 新数组；入参不被修改。
*/
function moveFirst(rows, ref) {
	const index = rows.findIndex((row) => row.ref === ref);
	if (index <= 0) return [...rows];
	return [
		rows[index],
		...rows.slice(0, index),
		...rows.slice(index + 1)
	];
}
/**
* 把一组模型分配给一个账号，**不**从其他账号删除同一模型。
* 同一模型可被多个账号使用；该账号没有模型时移除它的规则。
* @param rules - 现有按模型规则。
* @param account - 目标账号 ref。
* @param models - 该账号可用的模型 id。
* @returns 新的规则数组；入参不被修改。
*/
function assignModelsToAccount(rules, account, models) {
	const clean = [...new Set(models.filter((model) => typeof model === "string" && model.trim() !== ""))];
	const others = rules.filter((rule) => rule.account !== account);
	return clean.length === 0 ? others : [...others, {
		models: clean,
		account
	}];
}
/**
* 读固定账号字段：把缺失、空串、两种哨兵与坏值归一成一个决定。
*
* 优先级固定为「缺失/空串/自动哨兵 → 自动」「默认槽哨兵 → 固定到 fallback」「合法 ref →
* 固定到它」「其余 → 自动（并标记 invalid 供诊断）」。
* @param raw - 文档字段的原始值（形状不可信）。
* @param vocabulary - 该厂商的哨兵词汇与默认账号 ref。
* @returns 归一化后的槽判定。
*/
function readAccountSlot(raw, vocabulary) {
	const value = normalizeKey(raw);
	if (value === void 0 || vocabulary.auto !== void 0 && value === vocabulary.auto) return {
		pinned: null,
		ref: vocabulary.fallback,
		auto: true,
		isDefaultSlot: false,
		invalid: false
	};
	if (vocabulary.legacyDefault !== void 0 && value === vocabulary.legacyDefault) return {
		pinned: vocabulary.fallback,
		ref: vocabulary.fallback,
		auto: false,
		isDefaultSlot: true,
		invalid: false
	};
	if (CREDENTIAL_REF_PATTERN.test(value)) return {
		pinned: value,
		ref: value,
		auto: false,
		isDefaultSlot: false,
		invalid: false
	};
	return {
		pinned: null,
		ref: vocabulary.fallback,
		auto: true,
		isDefaultSlot: false,
		invalid: true
	};
}
//#endregion
//#region src/core/switching/auto-continue.ts
/**
* **绝不重试**的失败码 —— 只有用户的意图和「重试必然失败且会烧额度」的少数几类。
*
* 2026-10-29 改：从「白名单」（只重试已知瞬时码）改成「黑名单」
* （除下面这些外全部重试）。需求是「除手动暂停与确定性失败外，异常中断都按配置的次数
* 三次」—— 白名单会漏掉宿主新增的或本插件没预料到的码，那种情况用户只能手动再发。
*
* 黑名单里每一项的理由：
*
* - `ABORTED`：**用户按了停止**。把它当异常去重试等于覆盖用户的意图；
* - `CONTEXT_WINDOW_EXCEEDED`：上下文超长，重试多少次都一样长 —— 只会把一次明确的
*   错误拖成 N 倍延迟；
* - `INVALID_CREDENTIAL`：密钥失效，等 2 秒不会自己恢复（本插件的适配器在抛给宿主
*   之前已经换过账号了，到这里说明全都不可用）；
* - `QUOTA`：额度用尽，同上 —— 适配器已试过换账号与换模型。
*
* **未知码按「重试」处理**（与白名单时代相反）：这是本次改动的核心 —— 宁可多试三次
* 也不让用户手动补救。
*/
const NEVER_RETRY_CODES = /* @__PURE__ */ new Set([
	"ABORTED",
	"CONTEXT_WINDOW_EXCEEDED",
	"INVALID_CREDENTIAL",
	"QUOTA"
]);
/**
* 一个失败码是否值得自动重试。
*
* **用户主动中止永远不算** —— 他按了停止，我们就必须停；把它当成中断去重试，
* 等于把用户的意图覆盖掉。
*
* 其余情况：只要不在 `NEVER_RETRY_CODES` 里就重试（含**未知码**）。
* @param code - 宿主的失败码（形状不可信）。
* @returns 是否值得重试。
*/
function isTransientFailure(code) {
	if (code === void 0) return true;
	return !NEVER_RETRY_CODES.has(code);
}
/**
* 请求失败时该不该重试。
* @param settings - 当前开关与次数。
* @param code - 失败码。
* @param attempts - 本**轮次**内已经自动继续过几次。
* @returns 是否重试。
*/
function shouldRetryFailure(settings, code, attempts) {
	if (!settings.enabled) return false;
	if (attempts >= settings.maxAttempts) return false;
	return isTransientFailure(code);
}
/**
* 回答被截断时该不该续写。
*
* 认**三种**信号：
*
* - `"max-tokens"`：宿主 `dsh-agent-loop` 内部用的就是这个（`finish.kind ===
*   "max-tokens"` → `turnEnds = { kind: "max-tokens" }`）。本插件的三家适配器也把
*   厂商的 `length` / `max_tokens` 映射成 `{ kind: "max-tokens" }`；
* - `"length"`：厂商原始字面量。留着是为了**探针实现变了也不静默失效** ——
*   原来只认 `"length"`，而实际拿到的是 `max-tokens`，于是这条路径从未触发过；
* - `"PROVIDER_STREAM_TRUNCATED"`：**网关提前断流**（2026-11-12 审查 A03 后续）。
*   那一轮我改成报 `finish: error` + 这个码（不再伪装成 `stop`），于是它也成了
*   「回答没写完」的信号 —— 与 `max-tokens` 是同类（都该接着写），区别只在于
*   原因是「网关断了」而不是「打到输出上限」。
*
* `stop`（正常结束）与 `tool-calls`（交给工具）都是**正常**完成，绝不续写。
*
* ## 断流为什么可以续写，`error` 的其他情况却不行
*
* 这个函数只看结束原因，看不到「本轮有没有产生工具调用」。所以**调用方必须先
* 筛掉带工具调用的轮次** —— 工具调用跑了一半断开时重放，会让工具**重复执行**。
* 见 `wireAutoContinue` 与 `applyAutoContinue` 里的那条前置检查。
*
* @param settings - 当前开关与次数。
* @param finishReason - 本轮的结束原因（形状不可信）。
* @param attempts - 本轮已自动继续次数。
* @returns 是否续写。
*/
function shouldContinueOnTruncate(settings, finishReason, attempts) {
	if (!settings.enabled) return false;
	if (attempts >= settings.maxAttempts) return false;
	return finishReason === "max-tokens" || finishReason === "length" || finishReason === "PROVIDER_STREAM_TRUNCATED";
}
//#endregion
//#region src/vendors/auto-continue.ts
/**
* 自动继续的**宿主接线**：把 `core/switching/auto-continue` 的判定接到宿主的两个接缝上。
*
* 宿主签名（读自 `dsh-agent-loop/lib/index.js`，不是照 README 猜的）：
*
* 1. `agent/request-error` 是 **waterfall**：
*    ```js
*    const action = await this.dispatch.waterfall("agent/request-error",
*      { turn, step, provider, failure, retryPolicy, signal },
*      () => Promise.resolve(undefined));
*    if (action?.kind !== "retry") throw new LlmError(...);
*    continue;   // ← 重试
*    ```
*    所以「返回 `{ kind: "retry" }`」就是重试；返回 `undefined` 交给宿主当终态。
*
* 2. `agent/turn-stopping` 是 **serial**，payload `{ turn, signal }`，在本轮即将结束前调用：
*    ```js
*    if (turnEnds && this.inbox.nextStep.length === 0) await dispatch.serial("agent/turn-stopping", ...);
*    if (turnEnds && this.inbox.nextStep.length === 0) break;   // ← 仍然为空才真的结束
*    ```
*    所以「往 `inbox.nextStep` 推一条消息」就能让本轮继续。
*
* **关掉即静默**：开关关着时监听器虽然注册，但事件进来立刻交棒给下游（不重试、不续写），
* 与「不注册」等价；只有 `probe` 那条路在缺少宿主探针时才不注册。
* @module dsh-llm-account/src/vendors/auto-continue
*/
/** The host scopes currentInitiator to the active run; never infer identity from another event. */
function currentSessionId(ctx) {
	try {
		const id = (ctx.get?.("agents"))?.currentInitiator?.()?.session?.id;
		return typeof id === "string" && id.length > 0 ? id : void 0;
	} catch {
		return;
	}
}
/** 续写时发给模型的用户消息（用户可读，也是模型能理解的指令）。 */
const CONTINUE_PROMPT = "继续";
function continuationMessage() {
	return createUserMessage({
		content: [{
			type: "text",
			text: CONTINUE_PROMPT
		}],
		source: { kind: "dsh-llm-account-auto-continue" }
	});
}
/** Repair only the exact unidentified input emitted by earlier plugin versions.
* The host claims persisted inbox input before pre-step and its fallback closes
* over that same mutable array, so replace members without replacing the array.
*/
function repairLegacyContinueMessages(messages) {
	if (!Array.isArray(messages) || Object.isFrozen(messages)) return;
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (typeof message !== "object" || message === null) continue;
		const record = message;
		if (record.role !== "user" || record.content !== "继续") continue;
		if (Object.keys(record).length !== 2 || !Object.hasOwn(record, "role") || !Object.hasOwn(record, "content")) continue;
		messages[index] = continuationMessage();
	}
}
/**
* 等一会儿（不阻塞事件循环），**可被 abort 提前打断**。
*
* 2026-10-30 加信号支持：原来只 `setTimeout`，用户在这段等待里按停止也不会生效 ——
* 定时器照常走完，然后照样返回 `{ kind: "retry" }`，等于否认了用户的取消意图。
*
* 被取消时**不抛错**，而是正常 resolve 并让调用方检查 `signal.aborted` —— 抛
* `AbortError` 会把「用户取消」伪装成一次失败，污染上层的失败分类。
* @param ms - 毫秒。
* @param signal - 可选取消信号。
* @returns 到点或被取消后 resolve 的 Promise。
*/
function delay(ms, signal) {
	if (signal?.aborted === true) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		/** 取消时清掉定时器，立刻放行（**不抛错**）。 */
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
/**
* 注册自动继续的两个事件。
*
* `settings` 是**读取函数**而不是值快照（2026-10-30 修）。
*
* 原来是值快照，而 `loader/volatile-update`（用户改设置）**不会重跑 apply** ——
* 于是「关→开」时监听器从未注册、「开→关」时旧处理器按旧快照照跑、改次数/间隔也不
* 生效，全都要重载宿主。同文件的其他配置（`autoSwitchModel` / `maxTried`）都是
* getter，只有这里传了快照，是遗漏。
*
* 现在两个监听器**总是注册**，每次事件现读设置：
* - 开关关着 → 直接交棒（不重试），与「不注册」等价；
* - 开关开着 → 按当前次数与间隔判断。
* 这样 `enabled` 的语义从「装不装监听器」变成「事件时判不判」，行为可预期、可热改。
* @param ctx - 宿主 context（只用 `on`）。
* @param settings - **读取**当前开关与上限的函数。
* @param probe - 截断路径所需的最小宿主探针（缺省则不启用续写）。
* @returns 注销函数（把注册的事件都摘掉）。
*/
function applyAutoContinue(ctx, settings, probe) {
	const disposers = [];
	const attemptsByTurn = /* @__PURE__ */ new Map();
	const keyOf = (sessionId, turn) => JSON.stringify([sessionId, turn]);
	const attemptsOf = (sessionId, turn) => attemptsByTurn.get(keyOf(sessionId, turn)) ?? 0;
	const bump = (sessionId, turn) => {
		attemptsByTurn.set(keyOf(sessionId, turn), attemptsOf(sessionId, turn) + 1);
		if (attemptsByTurn.size > 1024) {
			const oldest = attemptsByTurn.keys().next().value;
			if (oldest !== void 0) attemptsByTurn.delete(oldest);
		}
	};
	/**
	* `agent/request-error` 是 **waterfall**，签名是 `(payload, next) => decision`。
	*
	* `cordis` 的实现（`EventsService.waterfall`）：
	*
	* ```js
	* const next = () => (cbs.shift() ?? inner)(...args);
	* return next();
	* ```
	*
	* 也就是说：**监听器不调用 `next()`，链路就在这里终止** —— 后面的监听器永远收不到
	* 这次失败。宿主自带的 `dsh-llm-retry` 也挂在这个事件上，它是个中间件
	* （`(payload, next) => recover(payload, next)`），靠 `next()` 交棒。
	*
	* 原来的写法是 `return undefined` 而不调 `next()`：如果我们排在 `llm-retry`
	* **前面**，宿主那条重试链就被我们吞掉了 —— 表现为「fetch failed 没有自动继续」。
	*
	* 现在两条出口都显式接力：不重试 → `next()`；重试 → 返回决策（终止链路，这是
	* waterfall 的正确用法）。
	*/
	{
		const off = ctx.on("agent/request-error", async (payload, next) => {
			/** 调用下游；没有 `next`（旧宿主/假 ctx）时退化成 `undefined`。 */
			const handOff = async () => typeof next === "function" ? await next() : void 0;
			const record = typeof payload === "object" && payload !== null ? payload : {};
			const sessionId = currentSessionId(ctx);
			const turn = record.turn;
			if (sessionId === void 0 || typeof turn !== "number" || !Number.isSafeInteger(turn) || turn < 0) return await handOff();
			const failure = typeof record.failure === "object" && record.failure !== null ? record.failure : {};
			const code = typeof failure.code === "string" ? failure.code : void 0;
			/**
			* 取消信号（2026-10-30 起真正使用）。
			*
			* 宿主把被取消那次请求的信号放在 payload 上；拿不到就当没有。
			* 用户在等待期间按停止 → `delay` 立刻放行 → 下面的 `aborted` 检查拒绝返回
			* `retry`，把决定权交回下游。**这是用户意图优先于「多试一次」的地方。**
			*/
			const signal = record.signal instanceof AbortSignal ? record.signal : void 0;
			const current = settings();
			const attempts = attemptsOf(sessionId, turn);
			if (!shouldRetryFailure(current, code, attempts)) return await handOff();
			bump(sessionId, turn);
			/**
			* **按配置的间隔等待再重试**。
			*
			* 宿主收到 `{ kind: "retry" }` 就立刻 `continue` —— **它自己不做任何等待**
			* （实测 `dsh-agent-loop` 里没有 backoff / setTimeout）。所以网络抖动时重试会
			* 在几百毫秒内连着打好几次（台账实测有 0.1 秒的相邻失败），反而可能加剧拥塞。
			*
			* 缺省 2 秒、**固定间隔**而不是递增退避：均匀间隔对「网络刚恢复」这类场景更稳，
			* 也避免第一次重试来得太急。等待用 `setTimeout` + Promise，不阻塞事件循环。
			*
			* 等待**响应取消**：用户在等待期间按停止时定时器立刻清掉、放行，然后由下面
			* 的 `aborted` 检查拒绝重试。原来这里不理会信号，等于把用户的停止意图拖后
			* 一整段间隔，还可能返回一个与当前信号矛盾的 `retry`。
			*/
			await delay(current.intervalMs, signal);
			if (signal?.aborted === true || !shouldRetryFailure(settings(), code, attempts)) return await handOff();
			return { kind: "retry" };
		});
		if (typeof off === "function") disposers.push(off);
	}
	if (probe !== void 0) {
		const off = ctx.on("agent/turn-stopping", async (payload) => {
			const record = typeof payload === "object" && payload !== null ? payload : {};
			const sessionId = currentSessionId(ctx);
			const turn = record.turn;
			if (sessionId === void 0 || typeof turn !== "number" || !Number.isSafeInteger(turn) || turn < 0) return void 0;
			const inbox = probe.inbox;
			if (inbox === void 0) return void 0;
			const reason = probe.lastFinishReason?.(sessionId, turn);
			if (!shouldContinueOnTruncate(settings(), reason, attemptsOf(sessionId, turn))) return void 0;
			bump(sessionId, turn);
			inbox.append("next-step", continuationMessage());
		});
		if (typeof off === "function") disposers.push(off);
	}
	return () => {
		for (const dispose of disposers) dispose();
		disposers.length = 0;
		attemptsByTurn.clear();
	};
}
//#endregion
//#region src/core/recovery.ts
/**
* 单次 `replay` 的轮数上限。回放期间新追加的意图要在下一轮处理，轮数必须有上限，
* 否则「`apply` 每次都追加一条」就成了死循环。
*/
const MAX_REPLAY_ROUNDS = 4;
/** 复制一条意图，避免日志内部对象与调用方共享引用（字段全是基本类型，浅拷贝即深拷贝）。 */
function cloneIntent(intent) {
	return { ...intent };
}
/**
* 意图日志。用法：提交前 `append`，提交成功后 `settle`，启动时 `replay`。
*
* 每个方法都是一次「读全量 → 改全量 → 写全量」的步骤；`append`、`settle` 与 `replay`
* 里的落盘都排在本实例的内部串行链上（`list` 只读，不排队），所以并发调用不会把彼此的
* 读改写撕开、丢写（见模块头的并发边界）。存储写失败一律向外抛。
* `settle` 对不存在的 id 是无操作，连写都不发（避免无谓落盘，也避免让「清一条早已
* 收尾的意图」因为存储抖动而失败）。
*/
var IntentLog = class {
	#store;
	/**
	* 串行链尾：写路径依次挂在这条链上，保证「读全量 → 改全量 → 写全量」不交叉。
	* 链尾永远是「已吞掉错误」的 promise，所以一次写失败不会卡住后续写入 —— 错误本身
	* 仍然原样抛给各自的调用方（见 `#serialize`）。
	*/
	#chain = Promise.resolve();
	/**
	* @param store - 注入的持久化端口；本类不关心它背后是设置、文件还是数据库。
	*/
	constructor(store) {
		this.#store = store;
	}
	/**
	* 追加一条意图并立即落盘。追加成功后才可以做真正的提交动作。
	* @param intent - 待记录的意图；入参会被复制，调用方后续改动无效。
	*/
	async append(intent) {
		const entry = cloneIntent(intent);
		await this.#serialize(async () => {
			const intents = await this.#read();
			intents.push(entry);
			await this.#store.write(intents);
		});
	}
	/**
	* 读取当前日志（按插入顺序）。
	* @returns 全新的数组与全新的意图对象：调用方怎么改都影响不到日志内部。
	*/
	async list() {
		return this.#read();
	}
	/**
	* 收尾一条意图：提交成功后把它从日志里去掉，之后的 `replay` 不会再碰它。
	* 对不存在的 id 是无操作（不抛错、不落盘）。
	* @param id - 意图标识。
	*/
	async settle(id) {
		await this.#serialize(async () => {
			const intents = await this.#read();
			const kept = intents.filter((intent) => intent.id !== id);
			if (kept.length === intents.length) return;
			await this.#store.write(kept);
		});
	}
	/**
	* 重放未决意图：把日志交给 `apply` 逐条判定，按结果收尾。
	*
	* 单次调用最多 4 轮；每轮取一次快照，只处理**本次调用里还没尝试过**的意图（`unknown`
	* 的意图不会在同一轮里被反复重试），随后把该轮判定为 `applied`/`rejected` 的意图从
	* **当场读到的最新日志**里删掉并落盘 —— 逐轮落盘，不在内存里攒到最后一次性写。
	* `unknown` 的意图原样留下，等下一次 `replay`；回放期间新追加的意图因此不会被清掉，
	* 但会进入下一轮（轮数上限即 4）。
	*
	* `apply` 与存储的错误都不吞：抛错直接冒泡，调用方据此判断本次回放没有完成。
	* @param apply - 对单条意图执行提交动作并给出判定；`applied` 与 `rejected` 都会从
	*   日志移除，`unknown` 保留待下次重放。会收到意图的副本。
	* @returns 本次回放的计数与剩余条数，见 `ReplayReport`。
	*/
	async replay(apply) {
		let applied = 0;
		let rejected = 0;
		let unknown = 0;
		const attempted = /* @__PURE__ */ new Set();
		for (let round = 0; round < MAX_REPLAY_ROUNDS; round += 1) {
			const pending = (await this.#read()).filter((intent) => !attempted.has(intent.id));
			if (pending.length === 0) break;
			const decided = /* @__PURE__ */ new Set();
			for (const intent of pending) {
				attempted.add(intent.id);
				const outcome = await apply(cloneIntent(intent));
				if (outcome === "unknown") {
					unknown += 1;
					continue;
				}
				if (outcome === "applied") applied += 1;
				else rejected += 1;
				decided.add(intent.id);
			}
			if (decided.size > 0) await this.#serialize(async () => {
				const kept = (await this.#read()).filter((intent) => !decided.has(intent.id));
				await this.#store.write(kept);
			});
		}
		return {
			applied,
			rejected,
			unknown,
			remaining: (await this.list()).length
		};
	}
	/**
	* 把一次写路径排到内部串行链上，保证「读全量 → 改全量 → 写全量」不与他人的读改写交叉。
	* 链尾始终记录一个「已吞掉错误」的 promise：一次写失败不会卡住后续写入，而错误本身
	* 仍然原样抛给这次调用的调用方。
	* @param work - 需要串行执行的写路径。
	* @returns `work` 的结果（或它抛出的错误）。
	*/
	async #serialize(work) {
		const run = this.#chain.then(work, work);
		this.#chain = run.then(() => void 0, () => void 0);
		return run;
	}
	/**
	* 读取日志并复制一层，保证内部对象不外泄。
	* @returns 全新的数组与全新的意图对象。
	*/
	async #read() {
		return (await this.#store.read()).map(cloneIntent);
	}
};
/**
* 瞬时失败分类：不写入拒绝表。一次网络抖动不该把好账号踢出轮换；同一请求内由
* `tried` 防止立刻重选同一账号，是否重试交给宿主的重试策略。
*/
const TRANSIENT_KINDS = /* @__PURE__ */ new Set(["server", "network"]);
/**
* 按分类算出拒绝条目的失效时刻。
* @param kind - 失败分类。
* @param resetAt - 厂商给出的重置时刻（epoch 毫秒），可能缺省。
* @param now - 记录时刻（epoch 毫秒）。
* @returns 失效时刻；`undefined` 表示不会自行过期。
*/
function rejectionExpiry(kind, resetAt, now) {
	switch (kind) {
		case "invalid-credential": return;
		case "rate-limit":
		case "quota":
		case "unavailable": return resetAt ?? now + 3e5;
		case "server":
		case "network": return;
	}
}
/**
* 账号轮换与拒绝记忆。
*
* 构造时**复制** `order` 与 `rules`，之后不再读调用方的对象：账号库后续变更
* （`reorder`/`assignModelRule`/`dropAccount` 都返回新对象）应由调用方新建引擎或
* 传入新状态，引擎不会静默跟随。
*/
var RotationEngine = class {
	#order;
	#pinned;
	#rules;
	#now;
	#entries = /* @__PURE__ */ new Map();
	/** 生效账号；`undefined` 表示本引擎实例还没有发过任何请求（不编造）。 */
	#effective;
	/** 切换记录，**最新在前**（`switchNotice()` 的头部即最近一次）。 */
	#notices = [];
	/**
	* @param config - 账号库状态（顺序、固定账号、按模型规则）与可选时钟。
	*/
	constructor(config) {
		this.#order = [...config.order];
		this.#pinned = config.pinned;
		this.#rules = config.rules.map((rule) => ({
			models: [...rule.models],
			account: rule.account
		}));
		this.#now = config.now ?? (() => Date.now());
	}
	/**
	* 选下一个账号：**用户选定的账号 → 规则命中 → 顺序里第一个未被拒绝的**。
	*
	* 任一候选不可用都**继续往下走**，不会因为规则或固定账号不可用就直接放弃。
	* 顺带惰性清理已过期的拒绝条目。
	*
	* 命中时顺带把该 ref 记为**生效账号**（见 `noteSelected`）：选择次序、拒绝表与
	* `fallbackAllowed` 的既有语义一律不动，这里只是把「这次真的是谁去发请求」记下来。
	*
	* ## 优先级（2026-10-22 定稿）
	*
	* **用户手动选定的账号（pinned）永远排第一**，只要它没被拒绝、没试过。
	*
	* 之前的口径是「模型绑定的账号优先于 pinned」—— 只有 pinned 恰好也在该模型的绑定
	* 列表里时才让 pinned 先。那个口径有实际后果：用户报「我选定了 A 账号，但请求走到了
	* B」，因为同一个模型被绑到两个账号时，绑定列表的顺序压过了用户的选择。
	*
	* 需求：「我选择使用其中的一个账号时，然后在会话中使用该网关的模型发送的时候
	* 应该就是使用我选定的那个账号的 API 发送请求」。**人的显式选择比规则表更权威。**
	*
	* 模型绑定因此只承担「这个模型能用哪些账号」的信息作用：pinned 不在绑定列表里时仍
	* 优先（用户明确指定了），从绑定列表挑不到就退回普通顺序。
	* @param request - 目标模型与本请求内已试过的账号。
	* @returns 选中的账号 ref；无可选账号时为 `undefined`（此时不动生效账号）。
	*/
	pick({ model, tried }) {
		const assigned = this.#rules.filter((entry) => entry.models.includes(model)).map((entry) => entry.account);
		const assignedInOrder = this.#order.filter((ref) => assigned.includes(ref));
		const assignedExtra = assigned.filter((ref) => !this.#order.includes(ref));
		/**
		* 候选顺序：**pinned 最前**，然后模型绑定的，最后普通顺序。
		*
		* pinned 为 `null`（自动轮换）时会被下面的过滤跳过，等价于没有它。
		*/
		const candidates = [
			this.#pinned,
			...assignedInOrder,
			...assignedExtra,
			...this.#order
		];
		for (const ref of candidates) {
			if (ref === null || ref === void 0) continue;
			/**
			* **空串也要跳过**（2026-10-22 自查发现）。
			*
			* `pinned` 来自设置文档的顶层 `apiKeyEnv` —— 那个字段可能被手改坏，也可能是
			* 半截写入留下的空串。旧代码只挡 `null` / `undefined`，于是空串被当成合法 ref
			* 返回，一路带到适配器：
			*
			* - `#resolveKey("")` 必然返回 `undefined` → 被判成「没有可用密钥」；
			* - 于是 `markRejected("", invalid-credential)` —— 拒绝表里多一条**永不过期**的
			*   脏条目（该分类的过期时刻是 `undefined`），还会多记一条失败用量。
			*
			* 它不影响请求最终能不能发出去（循环会继续试真正的账号），但一直在污染拒绝表
			* 与台账 —— 属于「不报错但一直错」的那类。
			*/
			if (ref.trim() === "") continue;
			if (tried.has(ref)) continue;
			/**
			* **不再看拒绝表**（2026-10-30 按用户要求改）。
			*
			* 用户诉求：「不要拒绝表，直接更换下一个，下一个不行的话继续下一个，有最大的
			* 测试上限就可以，比如我设置的 5 次，那么失败五次后直接停止」。
			*
			* 也就是说：**同一个请求内**按顺序把候选试一遍，试过的记进 `tried`、直到
			* `MAX_TRIED`；**跨请求不再记忆**上一次谁失败过。
			*
			* 为什么比原来的「拒绝表」好：
			*
			* - 拒绝表会把账号封死一段时间（`RATE_LIMIT_COOLDOWN_MS` = 5 分钟）。只有一个
			*   账号时，那等于「限额一次 → 5 分钟内完全不可用」，而额度可能几十秒后就恢复了。
			*   用户报的「触发限额后没有继续」就是这条链。
			* - 现在每次请求都真的去试，恢复即用；重复打上游的风险由 `MAX_TRIED` 与自动重试
			*   的退避兜住。
			*
			* 拒绝记录本身仍然保留（`markRejected` 照旧写入）：界面用它显示「这个账号为什么
			* 被跳过」的说明，`assembly` 也用它迁移状态。只是**选号时不拿它过滤**。
			*/
			this.noteSelected(ref);
			return ref;
		}
	}
	/**
	* 上报「这个 ref 被选中去发请求了」，把它记成生效账号，并在**上一次生效账号能被
	* 指名**（额度耗尽 / 限流 / 凭据失效）时记一条切换提示。
	*
	* `pick` 命中时会自动调用；调用方用别的方式选号（宿主重放、显式指定）时自己调用。
	* 对同一个 ref 重复上报是恒等变换，不会产生第二条提示。
	* @param ref - 本次要去发请求的账号 ref。
	*/
	noteSelected(ref) {
		const previous = this.#effective;
		const at = this.#now();
		this.#effective = {
			ref,
			at
		};
		if (previous === void 0 || previous.ref === ref) return;
		const reason = this.#namedReason(previous.ref);
		if (reason === void 0) return;
		this.#record({
			fromRef: previous.ref,
			toRef: ref,
			reason,
			at
		});
	}
	/**
	* 上报「这个 ref 成功完成了请求」，把生效账号修正为**最近成功者**
	* （规格 §8.1 第 1 条的后半段）。成功不是一次「切换」，因此不产出切换提示。
	* @param ref - 真正把请求服务完的账号 ref。
	*/
	noteSettled(ref) {
		this.#effective = {
			ref,
			at: this.#now()
		};
	}
	/**
	* 用户手动把生效账号切到 ref：原因固定为 `manual`，时间取当前时刻。
	*
	* 不触碰拒绝表 —— 手动换号是用户的选择，不改变被换下那个账号的额度/凭据状态。
	* @param ref - 用户选定的账号 ref。
	*/
	noteManualSwitch(ref) {
		const previous = this.#effective;
		const at = this.#now();
		this.#effective = {
			ref,
			at
		};
		if (previous === void 0 || previous.ref === ref) return;
		this.#record({
			fromRef: previous.ref,
			toRef: ref,
			reason: "manual",
			at
		});
	}
	/**
	* 切换策略（手动顺序/额度优先）主动换号：原因由调用方给定，时间取当前时刻。
	*
	* 不触碰拒绝表 —— 主动换号不是「这个账号被拒了」；拒绝表只由真实失败写入。
	* @param ref - 目标账号 ref。
	* @param reason - 切换原因（`quota` 或 `balance`）。
	*/
	noteAutoSwitch(ref, reason) {
		const previous = this.#effective;
		const at = this.#now();
		this.#effective = {
			ref,
			at
		};
		if (previous === void 0 || previous.ref === ref) return;
		this.#record({
			fromRef: previous.ref,
			toRef: ref,
			reason,
			at
		});
	}
	/**
	* 当前的生效账号（副本）。
	* @returns 最近一次被选中/成功的 ref 与时刻；还没有请求时为 `undefined`。
	*/
	effectiveAccount() {
		return this.#effective === void 0 ? void 0 : { ...this.#effective };
	}
	/**
	* 最近一次切换提示（副本）。
	* @returns 最近一条切换记录；从未切换过时为 `undefined`。
	*/
	switchNotice() {
		const latest = this.#notices[0];
		return latest === void 0 ? void 0 : { ...latest };
	}
	/**
	* 切换记录，最新在前（副本；Task 3 的 `switches()` 发布它）。
	* @returns 切换记录数组，最多 `MAX_SWITCH_NOTICES` 条。
	*/
	switchNotices() {
		return this.#notices.map((notice) => ({ ...notice }));
	}
	/**
	* 把另一台引擎的**观测状态**（生效账号与切换记录）搬到本引擎上。
	*
	* 引擎在账号库状态（顺序/固定/规则）变化时会被装配层**重建**；重建只搬拒绝记录是
	* 不够的 —— 那样用户一改账号设置，卡片就会突然显示「没有生效账号」，切换提示也归零。
	* 这是搬运而不是观察：不产生新的切换记录，也不改动拒绝表。
	*
	* 本引擎上已有的观测状态会被**覆盖**（调用方按「新引擎继承旧引擎」使用）。
	* @param source - 被替换掉的那台引擎。
	*/
	adoptObservations(source) {
		const effective = source.effectiveAccount();
		this.#effective = effective === void 0 ? void 0 : { ...effective };
		this.#notices = source.switchNotices().slice(0, 50).map((notice) => ({ ...notice }));
	}
	/**
	* 记录一次账号级失败。同一 ref 的新记录覆盖旧记录。
	*
	* `server`/`network` 是瞬时失败：直接返回，**既不入表也不清除**已有条目 ——
	* 一次服务端错误说明不了额度状态。
	*
	* **这张表不再参与选号**（2026-10-30）：`pick()` 只看 `tried`（同一请求内已试过的），
	* 跨请求不记忆失败。理由见 `pick()` 里的注释 —— 单账号场景下「拒绝即冷却 5 分钟」
	* 等于把唯一的选择封死，而额度可能几十秒后就恢复。
	*
	* 记录本身仍然保留，给两个地方用：
	* - 界面显示「这个账号为什么被跳过」；
	* - `assembly` 在引擎重建时迁移状态（`adoptObservations`）。
	*
	* 2026-10-29 曾在这里加过「只有一个账号时不入表」的特判；`pick()` 不看表之后它
	* 失去意义，已随本轮一并删除 —— 入表不再影响能否选中，只影响界面怎么描述。
	* @param ref - 被拒绝的账号 ref。
	* @param value - 失败分类、可选重置时刻与说明。
	*/
	markRejected(ref, value) {
		if (TRANSIENT_KINDS.has(value.kind)) return;
		this.#entries.set(ref, {
			rejection: { ...value },
			expiresAt: rejectionExpiry(value.kind, value.resetAt, this.#now())
		});
	}
	/**
	* 凭据更新后清除该账号的 `invalid-credential` 标记；对其它分类无效果
	* （换 key 不影响额度与冷却），对不存在或已被清除的 ref 是恒等变换。
	* @param ref - 换了密钥的账号 ref。
	*/
	clearCredentialRejection(ref) {
		if (this.#entries.get(ref)?.rejection.kind === "invalid-credential") this.#entries.delete(ref);
	}
	/**
	* 当前仍然生效的拒绝表快照（已过期条目在读取时被清掉）。
	* 返回的是新 Map：调用方改不动引擎内部状态。
	* @returns ref 到拒绝记录的只读映射。
	*/
	rejections() {
		const live = /* @__PURE__ */ new Map();
		for (const ref of [...this.#entries.keys()]) {
			const found = this.#live(ref);
			if (found !== void 0) live.set(ref, found);
		}
		return live;
	}
	/**
	* 请求是否还允许切换账号（设计文档 §6.4.2）。只要已开始输出、已消耗 token 或
	* 调用方已中止，就必须把失败原样抛给调用方，不能偷偷换账号重放。
	* @param context - 本次尝试的进度。
	* @returns 允许切换为 `true`。
	*/
	fallbackAllowed({ emitted, totalTokens, aborted }) {
		return !emitted && !aborted && totalTokens <= 0;
	}
	/**
	* 读取仍然生效的拒绝；已过期则顺手删掉（惰性清理，无定时器）。
	* @param ref - 账号 ref。
	* @returns 生效中的拒绝记录；没有或已过期时为 `undefined`。
	*/
	#live(ref) {
		const entry = this.#entries.get(ref);
		if (entry === void 0) return void 0;
		if (entry.expiresAt !== void 0 && this.#now() >= entry.expiresAt) {
			this.#entries.delete(ref);
			return;
		}
		return entry.rejection;
	}
	/**
	* 把一个 ref 被换下的原因翻译成**能指名**的切换原因。
	* @param ref - 被换下的账号 ref。
	* @returns 四种原因之一；拒绝表里没有它、或分类无法指名（`unavailable`/瞬时失败）时为 `undefined`。
	*/
	#namedReason(ref) {
		const kind = this.#live(ref)?.kind;
		if (kind === "quota" || kind === "rate-limit" || kind === "invalid-credential") return kind;
	}
	/**
	* 记一条切换提示（最新在前）并裁到上限。
	* @param notice - 要记录的切换。
	*/
	#record(notice) {
		this.#notices.unshift(notice);
		if (this.#notices.length > 50) this.#notices.length = 50;
	}
};
//#endregion
//#region src/vendors/assembly.ts
/**
* 一次设置写入的修订号冲突重试上限。冲突是并发写的正常结果（重读即可推进），给上限只是
* 为了不在持续争用下无限循环；与两个账号端口的同一上限。
*/
const MAX_CONFLICT_RETRIES = 8;
/** 意图日志里合法的操作分类（存储形状不可信，读的时候逐条收窄）。 */
const INTENT_KINDS = [
	"add",
	"remove",
	"rename",
	"replace-key",
	"select",
	"move",
	"auto-switch",
	"set-workspace"
];
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* 判定一个值是不是 volatile 引用。
*
* 鸭子类型判定（冻结 + `get`）而不是认 cosmokit 的私有符号：本项目不依赖 cosmokit，而配置
* 里普通解析值不会是冻结对象，所以这个判定不会误伤普通字段。
* @param value - 待判定的配置字段值。
* @returns 是否为 volatile 引用。
*/
function isVolatileRef(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	return Object.isFrozen(value) && typeof Reflect.get(value, "get") === "function";
}
/**
* 把一份已解析的 Config 读成普通值：volatile 字段**每次**经 `.get()` 现取（引用的身份稳定、
* 值会变，这正是「改完立即生效」的机制），非引用字段原样透传。
* @param config - 已解析的 Config（宿主交给 `apply` 的那一份）。
* @returns 每个字段的当前值。
*/
function unwrapVolatileConfig(config) {
	const plain = {};
	for (const [field, value] of Object.entries(config)) plain[field] = isVolatileRef(value) ? value.get() : value;
	return plain;
}
/**
* 宿主是否已经把这份 config 解析过（volatile 引用就是解析产物）。
*
* 程序化构造的配置（例如装配测试，或将来 1b 的远程页）是普通值，必须自己过一遍 `Config`；
* 把已经解析好的配置再解析一次会把 volatile 引用当成普通值，反而丢掉活引用。
* @param value - `apply` 收到的原始 config。
* @returns 是否已经是解析产物。
*/
function isParsedConfig(value) {
	return isRecord$3(value) && Object.values(value).some((field) => isVolatileRef(field));
}
/**
* 把一个 Config 字段标成 volatile。
*
* `.volatile()` 返回的是**标好记号的副本**（schemastery 的链式方法都返回新节点），所以必须
* 用返回值。类型上做一次断言：记号改变的是「解析成什么」（活引用），不是字段对插件暴露的
* 类型 —— 入口一律按 `Record<string, unknown>` 读配置，不依赖这个类型。
* @param schema - 字段节点。
* @returns 标好 volatile 的同一字段。
*/
function markVolatile(schema) {
	return schema.volatile();
}
/**
* 把一份 Config 字段表里的字段逐个标成 volatile，`skip` 里的组合期秘密字段除外。
*
* 宿主设置表单只投影 volatile 节点，且 `settings.mutate` 拒绝写非 volatile 路径；所以
* **账号文档用到的每个字段都必须在 `skip` 之外**，否则账号端口会读不到、写不动。
* @param fields - 字段表。
* @param skip - 不标 volatile 的字段名（例如只在组合文件里出现的 `apiKey` 字面量）。
* @returns 标好的字段表。
*/
function markVolatileFields(fields, skip = []) {
	const marked = {};
	for (const [field, schema] of Object.entries(fields)) marked[field] = skip.includes(field) ? schema : markVolatile(schema);
	return marked;
}
/** 账号库状态的比较键：顺序、固定账号与规则任一变化都要重建引擎。 */
function stateKey(state) {
	return JSON.stringify([
		state.order,
		state.pinned,
		state.rules
	]);
}
/**
* 造一个轮换引擎读取口。
*
* 为什么重建而不是「让引擎跟随」：引擎构造时复制状态（Task 5 的文档化决定），跟随会让
* 「顺序 = 账号列表」这条装配要求失效。搬迁拒绝记录时冷却窗口会从搬迁时刻重算（引擎不暴露
* 绝对失效时刻），只在用户改账号的瞬间发生一次，代价可接受。
* @param state - 现读账号库状态（顺序 = 账号列表，固定 = 当前账号，规则 = 按模型绑定）。
* @returns 读取口。
*/
function createRotationAccess(state) {
	let engine = new RotationEngine(state());
	let key = stateKey(state());
	const current = () => {
		const next = state();
		const nextKey = stateKey(next);
		if (nextKey === key) return engine;
		const replacement = new RotationEngine(next);
		for (const [ref, rejection] of engine.rejections()) replacement.markRejected(ref, rejection);
		replacement.adoptObservations(engine);
		engine = replacement;
		key = nextKey;
		return engine;
	};
	return {
		current,
		clearCredentialRejection(ref) {
			current().clearCredentialRejection(ref);
		}
	};
}
/**
* 关掉宿主为**这一行**自动生成的设置表单（`configure({ auto: false })`）。
*
* 为什么必须做：本包自带统一设置页（`settings.section`，id `llm-account`）。宿主默认会按
* schemastery 配置自动生成一份表单，不关掉就会和我们的页面**并排出现**。旧 Command Code 插件
* 用的正是这一条（`@mars-sea/dsh-commandcode-provider/lib/index.js:10982`：
* `settingsCtx.settings.configure({ auto: false }, ctx.fiber)`）。
*
* 两个接缝（2026-10-24 更正：原本标着「未验证」，现已由真机确认可用）：
* `ctx.fiber` **没有**出现在 cordis 4.0.4 的 `Context` 类型里（运行时存在：
* `lib/index.js:1684`），所以只有一个窄化的结构读取；`configure` 的第二个参数就是
* owner fiber。
*
* 幂等：宿主对「这一行已经登记过策略」会抛错，而那种情况下的目标状态（自动表单已关）本来
* 就已经达成 —— 所以不把它变成整行的失败，只在日志里留一行。
* @param ctx - 该 profile 行的插件上下文。
* @param namespace - 该行的设置命名空间（只用于日志文案）。
*/
function disableSettingsAutoForm(ctx, namespace) {
	const service = ctx.get("settings");
	if (!isRecord$3(service) || typeof service.configure !== "function") {
		ctx.logger.warn(`dsh-llm-account: the settings service has no configure(); the generated settings form for "${namespace}" cannot be disabled and may appear beside the unified page`);
		return;
	}
	const configure = service.configure;
	const fiber = ctx.fiber;
	ctx.effect(() => {
		try {
			const dispose = configure.call(service, { auto: false }, fiber);
			return typeof dispose === "function" ? dispose : () => void 0;
		} catch (error) {
			ctx.logger.warn(`dsh-llm-account: could not disable the generated settings form for "${namespace}" (${error instanceof Error ? error.message : String(error)}); if a form still appears beside the unified page, this is why`);
			return () => void 0;
		}
	}, "dsh-llm-account: settings auto-form policy");
}
/** 宿主设置服务的形状判定（只认本装配层用到的两个方法）。 */
function isSettingsForms(value) {
	return isRecord$3(value) && typeof value.describe === "function" && typeof value.mutate === "function";
}
/** 读宿主设置服务；服务缺席时抛错（调用方都处在「必须读写配置」的路径上）。 */
function requireSettingsForms(ctx, namespace) {
	const service = ctx.get("settings");
	if (!isSettingsForms(service)) throw new Error(`dsh-llm-account: the settings service is unavailable, so the "${namespace}" document cannot be read or written`);
	return service;
}
/**
* 按候选名单找设置行。
*
* 现代宿主（0.2.x）的 `settings.describe()` 按 **profile 行 id** 建索引，而 `core` 里的设置
* 命名空间是固定的（`llm-commandcode` / `llm-opencode-go`）。opencode 这两个名字**不相同**
* （行 id 是 `opencode-go`），所以这里必须按候选名单解析：先找行 id，再回落到命名空间
* （旧插件的 `accountSettingsRow` 就是同一顺序）。
* @param forms - 宿主设置服务。
* @param rowIds - 候选行名，按优先级排列。
* @returns 命中的行。
*/
function requireSettingsRow(forms, rowIds) {
	const rows = forms.describe();
	for (const id of rowIds) {
		const row = rows.find((candidate) => candidate.ns === id);
		if (row !== void 0) return row;
	}
	throw new Error(`dsh-llm-account: no profile row provides this settings document (tried ${rowIds.join(", ")})`);
}
/**
* 造一个绑定到单一设置命名空间的 `SettingsPort`。
*
* 端口契约要求 `mutate` 返回**提交后**的快照，而宿主 `settings.mutate` 只返回 `void`，所以
* 提交后重新描述一次。写路径一律用**命中的行名**（不是 `core` 的命名空间），否则 opcode
* 的写会落到一个不存在的行上。
* @param ctx - 插件上下文（每次读都重新取设置服务）。
* @param namespace - `core` 侧的固定命名空间；调用方传别的名字一律报错（接线错误要吵出来）。
* @param rowIds - 候选行名，按优先级排列。
* @returns 设置端口。
*/
function createSettingsPort(ctx, namespace, rowIds) {
	const require = (requested) => {
		if (requested !== namespace) throw new Error(`dsh-llm-account: unexpected settings namespace "${requested}" (expected "${namespace}")`);
	};
	const snapshotOf = (row) => ({
		revision: row.revision,
		value: isRecord$3(row.value) ? row.value : {}
	});
	return {
		async describe(requested) {
			require(requested);
			return snapshotOf(requireSettingsRow(requireSettingsForms(ctx, namespace), rowIds));
		},
		async mutate(requested, ops, revision) {
			require(requested);
			const forms = requireSettingsForms(ctx, namespace);
			await forms.mutate(requireSettingsRow(forms, rowIds).ns, ops, revision);
			return snapshotOf(requireSettingsRow(forms, rowIds));
		}
	};
}
/** 宿主凭据服务的形状判定（只认本装配层用到的四个方法）。 */
function isCredentialProvider(value) {
	return isRecord$3(value) && typeof value.resolve === "function" && typeof value.describe === "function" && typeof value.set === "function" && typeof value.unset === "function";
}
/** 读宿主凭据服务；服务缺席返回 `undefined`（读取路径按「未配置」处理，写入路径报错）。 */
function credentialsProviderOf(ctx) {
	const service = ctx.get("credentials");
	return isCredentialProvider(service) ? service : void 0;
}
/**
* 造一个凭据端口：把 `core` 的 `CredentialPort`（按字符串 ref 进出）接到宿主凭据服务上。
*
* 引用名先过 `isCredentialRefName`：文档里的非法引用名（例如旧插件的 `account-2` 内联槽）
* 在宿主 `credentialRef()` 里会抛 `TypeError`，读路径必须把它读成「未配置」而不是把请求打成
* 裸异常；写路径传非法名是调用方的 bug，照旧抛。
* @param ctx - 插件上下文（每次调用都重新取凭据服务）。
* @returns 凭据端口。
*/
function createCredentialsPort(ctx) {
	return {
		async resolve(ref) {
			const provider = credentialsProviderOf(ctx);
			if (provider === void 0 || !isCredentialRefName(ref)) return void 0;
			return normalizeKey((await provider.resolve(credentialRef(ref)))?.value);
		},
		async set(ref, value) {
			const provider = credentialsProviderOf(ctx);
			if (provider === void 0) throw new Error("dsh-llm-account: the credentials service is unavailable in this profile, so the key cannot be stored");
			await provider.set(credentialRef(ref), value);
		},
		async unset(ref) {
			const provider = credentialsProviderOf(ctx);
			if (provider === void 0 || !isCredentialRefName(ref)) return;
			await provider.unset(credentialRef(ref));
		},
		async describe(refs) {
			const provider = credentialsProviderOf(ctx);
			const entries = await Promise.all(refs.map(async (ref) => {
				if (provider === void 0 || !isCredentialRefName(ref)) return [ref, { configured: false }];
				const info = await provider.describe(credentialRef(ref));
				return [ref, {
					configured: info.configured === true,
					writable: info.writable === true
				}];
			}));
			return Object.fromEntries(entries);
		}
	};
}
/** 读一条意图记录的合法分类。 */
function readIntentKind(value) {
	return typeof value === "string" ? INTENT_KINDS.find((kind) => kind === value) : void 0;
}
/**
* 逐字段收窄一条意图记录。
*
* 存储形状不可信（设置文档可能被手改）：`id`/`kind`/`createdAt` 三个身份字段齐备才认，
* 其余字段按类型收进，认不出的条目整条丢弃 —— 一次手改不该让插件起不来，也不该让一条
* 形状不明的记录进回放。
* @param value - 文档里的一个数组元素。
* @returns 合法意图，或 `undefined`。
*/
function readIntent(value) {
	if (!isRecord$3(value)) return void 0;
	const id = normalizeKey(value.id);
	const kind = readIntentKind(value.kind);
	const createdAt = value.createdAt;
	if (id === void 0 || kind === void 0 || typeof createdAt !== "number" || !Number.isFinite(createdAt)) return;
	const ref = normalizeKey(value.ref);
	const label = normalizeKey(value.label);
	const toIndex = typeof value.toIndex === "number" && Number.isFinite(value.toIndex) ? value.toIndex : void 0;
	const flag = typeof value.value === "boolean" ? value.value : void 0;
	return {
		id,
		kind,
		createdAt,
		...ref === void 0 ? {} : { ref },
		...label === void 0 ? {} : { label },
		...toIndex === void 0 ? {} : { toIndex },
		...flag === void 0 ? {} : { value: flag }
	};
}
/** 修订号冲突（`SettingsPort.mutate` 的约定错误形状）。 */
function isSettingsConflict(error) {
	return isRecord$3(error) && error.code === "SETTINGS_CONFLICT";
}
/**
* 把全局切换设置写进一份设置文档（修订冲突时重读重试）。
* @param settings - 设置端口。
* @param ns - 目标命名空间。
* @param input - 策略/间隔/回合末/自动切换。
*/
async function writeSwitchSettings(settings, ns, input) {
	for (let attempt = 0;; attempt += 1) {
		const snapshot = await settings.describe(ns);
		try {
			await settings.mutate(ns, [
				{
					op: "set",
					path: ["switchStrategy"],
					value: input.strategy
				},
				{
					op: "set",
					path: ["switchIntervalMinutes"],
					value: input.intervalMinutes
				},
				{
					op: "set",
					path: ["switchAtTurnEnd"],
					value: input.atTurnEnd
				},
				{
					op: "set",
					path: ["autoSwitch"],
					value: input.autoSwitch
				}
			], snapshot.revision);
			return;
		} catch (error) {
			if (attempt >= MAX_CONFLICT_RETRIES || !isSettingsConflict(error)) throw error;
		}
	}
}
/**
* 把模型→账号分配规则写进设置文档（修订冲突时重读重试）。
* @param settings - 设置端口。
* @param ns - 目标命名空间。
* @param rules - 完整规则数组（同一模型可属于多个账号）。
*/
async function writeModelRules(settings, ns, rules) {
	for (let attempt = 0;; attempt += 1) {
		const snapshot = await settings.describe(ns);
		const nextRules = typeof rules === "function" ? rules(snapshot.value) : rules;
		try {
			await settings.mutate(ns, [
				{
					op: "set",
					path: ["modelAccountRules"],
					value: nextRules.map((rule) => ({
						...rule,
						models: [...rule.models]
					}))
				},
				{
					op: "set",
					path: ["visibleModels"],
					value: [...new Set(nextRules.flatMap((rule) => rule.models))]
				},
				{
					op: "set",
					path: ["modelVisibility"],
					value: Object.fromEntries([...new Set(nextRules.flatMap((rule) => rule.models))].map((model) => [model, true]))
				}
			], snapshot.revision);
			return;
		} catch (error) {
			if (attempt >= MAX_CONFLICT_RETRIES || !isSettingsConflict(error)) throw error;
		}
	}
}
/**
* 把意图日志落到设置文档的一个隐藏字段上（一次读全量、一次写全量）。
*
* 写失败一律向外抛（静默失败会让崩溃恢复丢掉已提交的操作）；修订号冲突时重读并用新修订号
* 重放这次落盘 —— op 是「整体覆盖这一个字段」的路径写，不碰文档里的其它字段。
* @param settings - 设置端口（记载账号文档的那个命名空间）。
* @param namespace - 设置命名空间。
* @param field - 存放意图的字段名（入口自己的隐藏字段）。
* @param warn - 丢弃形状不明的条目时的诊断出口。
* @returns 意图存储端口。
*/
function createSettingsIntentStore(settings, namespace, field, warn) {
	return {
		async read() {
			const raw = (await settings.describe(namespace)).value[field];
			if (!Array.isArray(raw)) return [];
			const intents = [];
			for (const item of raw) {
				const intent = readIntent(item);
				if (intent === void 0) {
					warn?.(`dsh-llm-account: dropped a malformed "${field}" entry from namespace "${namespace}"`);
					continue;
				}
				intents.push(intent);
			}
			return intents;
		},
		async write(intents) {
			const value = intents.map((intent) => ({ ...intent }));
			for (let attempt = 0;; attempt += 1) {
				const snapshot = await settings.describe(namespace);
				try {
					await settings.mutate(namespace, [{
						op: "set",
						path: [field],
						value
					}], snapshot.revision);
					return;
				} catch (error) {
					if (attempt >= MAX_CONFLICT_RETRIES || !isSettingsConflict(error)) throw error;
				}
			}
		}
	};
}
const intentSlots = /* @__PURE__ */ new Map();
/**
* 取（必要时构造）某个设置命名空间的意图日志。
* @param namespace - 设置命名空间。
* @param store - 本次装配的存储端口；该命名空间已有实例时把它换成这个端口。
* @returns 该命名空间唯一的意图日志。
*/
function intentLogFor(namespace, store) {
	const existing = intentSlots.get(namespace);
	if (existing !== void 0) {
		existing.store = store;
		return existing.log;
	}
	const slot = {
		store,
		log: new IntentLog({
			read: () => slot.store.read(),
			write: (intents) => slot.store.write(intents)
		})
	};
	intentSlots.set(namespace, slot);
	return slot.log;
}
/**
* 读启动环境里的一次取值（宿主 `launchEnvironmentOf`：启动器快照，缺席时回落到进程环境）。
* 空串与纯空白读作未配置（凭据来源的同一纪律）。
* @param ctx - 插件上下文。
* @param name - 变量名。
* @returns 该变量的值，或 `undefined`。
*/
function environmentValue(ctx, name) {
	return normalizeKey(launchEnvironmentOf(ctx).get(name)?.value);
}
//#endregion
//#region src/core/switching/gateway-health.ts
/**
* **网关健康状态的短期记忆**（2026-11-12 审查 A07）。
*
* ## 被钉住的问题
*
* 三家适配器的 `#fallbackModel` 都写着：
*
* ```ts
* { sameGatewayOnly: failureKind === "network" }
* ```
*
* 那个取舍的理由是「`fetch failed` / DNS / 代理不通意味着**这台机器出不去**，
* 换一家走的是同一条路由、必然同样失败」。
*
* 但它把两件不同的事混成了一件：
*
* | 真实情况 | 旧行为 | 应该 |
* | --- | --- | --- |
* | 整台机器断网 | 同网关内换，白试 | 不跨网关（旧行为正确） |
* | **只有 A 家域名挂了 / 被 VPN 分流拦住** | 同网关内换，A 家本来就不可达 | **跨到 B 家救援** |
*
* 后者正是用户实际遇到的场景（「开 VPN 时某些网关连不上」）。
*
* ## 修法：按网关记「谁刚刚网络失败过」
*
* 不再用「一个 network 错误码推断全网不可达」，改成**按目标网关判断可达性**：
*
* 1. 某家发生网络层失败时，把它记进这张表；
* 2. 换模型时，把**最近网络失败过的网关**从候选里排除；
* 3. 于是「整网断」的时候，第二家也很快被记进去，不会无限试；
*    「只有 A 家挂」的时候，B 家仍可选 —— 这正是要救援的情形。
*
* 窗口取 {@link NETWORK_DOWN_WINDOW_MS}：短到「网络恢复了就立刻重新可用」，
* 长到足以覆盖一次失败请求的重试节奏。
*
* @module dsh-llm-account/src/core/switching/gateway-health
*/
/**
* 一个网关「网络失败」的记录保留多久（毫秒）。
*
* 60 秒：与目录缓存同档。太短会让「刚失败又立刻重试」反复撞墙；
* 太长则 VPN 恢复后仍被当成不可用。
*/
const NETWORK_DOWN_WINDOW_MS = 6e4;
/** provider → 最近一次网络层失败的时刻。 */
const networkDownAt = /* @__PURE__ */ new Map();
/**
* 记一次网络层失败。
* @param provider - 网关 id。
* @param at - 失败时刻（毫秒）。
*/
function noteNetworkFailure(provider, at = Date.now()) {
	if (typeof provider !== "string" || provider === "") return;
	networkDownAt.set(provider, at);
}
/**
* 最近网络失败过的网关清单。
* @param now - 现在（毫秒）。
* @param windowMs - 保留窗口（缺省 {@link NETWORK_DOWN_WINDOW_MS}）。
* @returns 应被排除的网关 id。
*/
function recentlyNetworkDown(now = Date.now(), windowMs = NETWORK_DOWN_WINDOW_MS) {
	const down = [];
	for (const [provider, at] of networkDownAt) if (now - at <= windowMs) down.push(provider);
	return down;
}
//#endregion
//#region src/core/switching/model-fallback.ts
/**
* **限额换模型**的纯判定。
*
* ## 需求演化（记下来，免得再绕回去）
*
* 1. 最初：「遇到账号限额的时候自动切换到同等类型的模型还有思考强度，但是排除官方的 API」；
* 2. 中间加过「自动切换模型白名单」（手填 / 勾选）；
* 3. 现在（2026-10-19 晚）：「不要那个了，太复杂了，就直接从每个账号可选模型中随机切换吧」，
*    并给出明确优先级。
*
* ## 四级优先（需求的落地）
*
* 1. **同网关 + 同名模型**（最安全：还是同一家发请求、模型等级不变）；
* 2. **跨网关 + 同名模型**（换一家发，模型等级不变）；
* 3. **同网关 + 不同名模型**（换等级但不出这家；「参数能力什么的接近」按上下文窗口与
*    推理档位接近度排）；
* 4. **跨网关 + 不同名模型**（最后手段）。
*
* 同一优先级里有多个候选时**随机**选一个（需求「随机切换」，避免总压在同一个上）。
*
* 排除 DeepSeek 官方直连（用户最初就要求的），以及**自己**（同一个网关+同一个 id）。
*
* 纯函数：不读网络、不读设置、不留状态，可完整单测（随机源可注入）。
* @module dsh-llm-account/src/core/model-fallback
*/
/**
* 官方直连的 provider id 前缀（要排除的目标）。
*
* 本包托管的三个网关（commandcode / dsh-opencode-go / opendesign）都**不是**这里的前缀，
* 所以「排除官方」= 只在这些网关之间互切。
*
* **2026-11-08 起这不再是唯一的闸门**：只有黑名单意味着「任何没被点名的 provider 都能
* 被切过去」（例如同装的 `pi-ai` / `anthropic` 等插件，或将来新装的一家）。需求明确要求
* 「只准在 opendesign / commandcode / opencode 三个网关之间切换」，所以真正的判据改成了
* 白名单 {@link SWITCHABLE_PROVIDERS}；这个黑名单保留作为**纵深防御**（万一白名单被
* 误放宽，官方直连仍然进不来）。
*/
const OFFICIAL_PROVIDER_PREFIXES = ["deepseek", "deepseek-account"];
/**
* **允许被自动切换过去的 provider**（白名单，2026-11-08 加）。
*
* 需求：「自动切换不要切换到 deepseek 的 API 上边去，只准在 opendesign / commandcode /
* opencode 三个网关之间切换」。
*
* 为什么必须用白名单而不是黑名单：黑名单只能挡住**已经知道名字**的那几家。这台机器上同时
* 装着 `pi-ai`、`anthropic` 等别的 LLM 插件，任何一家只要进了候选清单，黑名单就漏了 ——
* 而用户要的是「绝对不出这三个」。白名单是**闭集合**，新厂商默认进不来。
*
* 别名说明：opencode 这一行在宿主的行 id 是 `opencode-go`，而它自己登记的 provider 是
* `dsh-opencode-go`（插件前缀），历史上还用过裸 `opencode`。三种写法都算同一家。
*/
const SWITCHABLE_PROVIDERS = [
	"commandcode",
	"opendesign",
	"dsh-opencode-go",
	"opencode",
	"opencode-go"
];
/**
* 这个 provider 是否允许被自动切换（换模型 / 跨网关委托）过去。
*
* 判据是**白名单**（见 {@link SWITCHABLE_PROVIDERS}），不是「不是官方」。两者的区别在
* 一台装了多家 LLM 插件的机器上是实打实的：黑名单会把请求切给 `pi-ai`，白名单不会。
* @param provider - provider 路由 id。
* @returns 是否允许。
*/
function isSwitchableProvider(provider) {
	const id = provider.trim().toLowerCase();
	if (id === "") return false;
	return SWITCHABLE_PROVIDERS.includes(id);
}
/**
* 判定一个 provider id 是不是**官方直连**（要排除）。
*
* 为什么不只比 `=== "deepseek"`：官方那套插件的路由名不止一个
* （`deepseek` / `deepseek-account`），将来还可能有 `deepseek-official` 之类的变体。
* 前缀匹配既挡住官方，也不会误伤 `dsh-opencode-go`。
* @param provider - provider 路由 id。
* @returns 是否官方直连。
*/
function isOfficialProvider(provider) {
	const id = provider.trim().toLowerCase();
	if (id === "") return false;
	for (const prefix of OFFICIAL_PROVIDER_PREFIXES) if (id === prefix || id.startsWith(`${prefix}-`)) return true;
	return false;
}
/**
* 模型 id 的归一化键：用于判定「同名」。
*
* 去掉厂商前缀（`deepseek/`）、转小写、统一分隔符：`deepseek-v4.1-flash` 与
* `deepseek/deepseek-v4.1-flash` 归一到同一个键。
* @param model - 模型 id。
* @returns 归一化键；空输入返回空串。
*/
function modelKeyOf(model) {
	const trimmed = model.trim().toLowerCase();
	if (trimmed === "") return "";
	return trimmed.slice(trimmed.lastIndexOf("/") + 1).replace(/[-_.]/gu, "");
}
/**
* 一个候选属于第几级。
*
* @param current - 刚失败的 (网关, 模型)。
* @param candidate - 待判定的候选。
* @returns 级别：1 同网关同名 / 2 跨网关同名 / 3 同网关异名 / 4 跨网关异名。
*/
function fallbackTierOf(current, candidate) {
	const sameGateway = candidate.provider === current.provider;
	const sameModel = modelKeyOf(candidate.model) === modelKeyOf(current.model);
	if (sameGateway) return sameModel ? 1 : 3;
	return sameModel ? 2 : 4;
}
/**
* 「参数能力接近度」：与当前模型差多少（越小越接近）。
*
* 只在第 3/4 级（异名模型）时用得上 —— 同名时等级本来就一样。
* 判据按重要性排：
* 1. 上下文窗口的相对差（相差一个数量级就明显不是同级模型）；
* 2. 推理档位数量之差（反映深度档位丰富度）。
*
* 未知值（缺省）给一个很大的惩罚分：宁可选一个已知相近的，也不要把未知当成恰好合适。
* @param current - 当前模型。
* @param candidate - 候选。
* @returns 距离分（非负；越小越接近）。
*/
function capabilityDistance(current, candidate) {
	const UNKNOWN = 1e9;
	const windowScore = (() => {
		const from = current.contextWindow;
		const to = candidate.contextWindow;
		if (from === void 0 || to === void 0 || from <= 0 || to <= 0) return UNKNOWN;
		return Math.abs(Math.log2(to / from));
	})();
	const effortScore = (() => {
		const from = current.effortCount;
		const to = candidate.effortCount;
		if (from === void 0 || to === void 0) return UNKNOWN / 100;
		return Math.abs(to - from);
	})();
	return windowScore * 100 + effortScore;
}
/**
* 本轮请求里**是否带了图片**。
*
* ## 为什么单独抽出来（2026-11-12 审查 A06）
*
* 三家的 `#fallbackModel` 都要回答这个问题，才能把 `requiresImages` 传给
* `pickFallbackModel`。逻辑分散三处必然漏一家 —— 这与仓库既有的
* 「同一逻辑分散多处，迟早漏一家」是同一条纪律。
*
* 判据只看 **user 消息里的 `type: "image"` 内容块**：宿主的 `ContentBlock` 用这个
* 判别式表达图片（`openAiUserContent` 里就是 `block.type === "image"`）。
* 形状不可信（跨远程边界），所以每一项都当 `unknown` 收窄。
* @param messages - 请求消息列表。
* @returns 有图片时为 `true`。
*/
function hasImageInput(messages) {
	if (!Array.isArray(messages)) return false;
	for (const message of messages) {
		if (typeof message !== "object" || message === null) continue;
		const content = message.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) if (typeof block === "object" && block !== null && block.type === "image") return true;
	}
	return false;
}
/**
* 从候选里按**四级优先**选一个替代模型。
*
* 同一级里有多个候选时**随机**取一个（需求「随机切换」）。为什么不是取第一个：
* 候选来自固定顺序的目录，总取第一个会让所有账号的失败都压到同一个模型上。
*
* @param current - 刚失败的 (网关, 模型)。
* @param candidates - 可选模型（**只该包含用户允许的那些**，由调用方过滤）。
* @param options - `random` 随机源（测试注入，缺省 `Math.random`）；
*   `excludeOfficial` 默认 `true`；
*   `sameGatewayOnly` 默认 `false`（见下）。
* @returns 替代目标；没有任何合格候选时为 `undefined`（停手）。
*/
function pickFallbackModel(current, candidates, options = {}) {
	const excludeOfficial = options.excludeOfficial !== false;
	const random = options.random ?? Math.random;
	/** 本轮是否带图片（`true` 才启用模态闸门）。 */
	const requiresImages = options.requiresImages === true;
	/** 刚刚网络失败过的网关（这些不参与跨网关救援，见选项注释）。 */
	const excludeProviders = new Set(options.excludeProviders ?? []);
	/**
	* **只在同一网关内换**（2026-10-28 加）。
	*
	* 用于「网络层断裂」这一类失败：`fetch failed` / DNS / 代理不通意味着**这台机器
	* 出不去**，换到另一家网关走的是同一个网卡、同一条路由 —— 必然同样失败，只是白烧
	* 一次请求 + 多等一轮。那种情况下「换厂商」毫无意义，只该在同一网关内换模型
	* （同名模型可能落在不同上游）。
	*
	* 额度不足、鉴权失败、上游 5xx 这些**服务侧**的失败不设这个限制：换一家真的可能
	* 绕过（那家没坏）。
	*/
	const sameGatewayOnly = options.sameGatewayOnly === true;
	const usable = candidates.filter((candidate) => {
		if (typeof candidate.model !== "string" || candidate.model.trim() === "") return false;
		if (typeof candidate.provider !== "string" || candidate.provider.trim() === "") return false;
		if (!isSwitchableProvider(candidate.provider)) return false;
		if (excludeOfficial && isOfficialProvider(candidate.provider)) return false;
		if (sameGatewayOnly && candidate.provider !== current.provider) return false;
		if (excludeProviders.has(candidate.provider)) return false;
		if (candidate.provider === current.provider && candidate.model === current.model) return false;
		if (requiresImages) {
			const declared = candidate.inputModalities;
			if (Array.isArray(declared) && !declared.some((modality) => modality === "image")) return false;
		}
		return true;
	});
	if (usable.length === 0) return void 0;
	const tiers = /* @__PURE__ */ new Map();
	for (const candidate of usable) {
		const tier = fallbackTierOf(current, candidate);
		const bucket = tiers.get(tier);
		if (bucket === void 0) tiers.set(tier, [candidate]);
		else bucket.push(candidate);
	}
	const bestTier = [
		1,
		2,
		3,
		4
	].find((tier) => (tiers.get(tier)?.length ?? 0) > 0);
	if (bestTier === void 0) return void 0;
	const pool = tiers.get(bestTier);
	if (pool.length === 1) return pool[0];
	const narrowed = bestTier === 3 || bestTier === 4 ? (() => {
		const scored = pool.map((candidate) => ({
			candidate,
			distance: capabilityDistance(current, candidate)
		}));
		const min = Math.min(...scored.map((item) => item.distance));
		return scored.filter((item) => item.distance === min).map((item) => item.candidate);
	})() : pool;
	return narrowed[Math.min(narrowed.length - 1, Math.max(0, Math.floor(random() * narrowed.length)))];
}
//#endregion
//#region src/core/model-names.ts
/**
* 模型 id → **官方展示名**（纯函数），外加同一份目录内的**去重**。
*
* ## 为什么所有厂商都用它，而不是厂商给的 `name`
*
* 2026-10-20 报障「模型名称又不一致了」的根因：同一个模型在三家网关的写法不同 ——
* Command Code 的目录自带 `name: "DeepSeek V4.1 Flash (CC)"`（还带网关自己的 `(CC)` 标记）、
* Open Code 的名字来自 models.dev（`DeepSeek V4.1 Flash`）、Open Design 只回 id。以前只有
* Open Design 走名称规则，另两家照搬厂商 name，于是宿主的模型选择器里同一个模型三种写法。
*
* 规则只有一条：**展示名一律由 id 派生**，与是哪个网关无关；厂商的 `name` 只用来判断这一行
* 是否有效（与旧插件同一道门槛），不再进界面。
*
* ## 规则（确定性、可测）
*
* 1. 已知品牌词按官方写法（`gpt` → `GPT`、`deepseek` → `DeepSeek`、`mimo` → `MiMo`…）；
* 2. 相邻两段纯数字用点连起来（`4-5` → `4.5`，`2-5` → `2.5`）——版本号的通用写法；
* 3. 结尾的日期/快照后缀（`-20250929`、`-2025-09-29`、`-0902`）去掉：它区分的是快照，不是
*    模型名（真要区分时由 {@link assignUniqueNames} 把它加回括号里）；
* 4. 斜杠前缀（`anthropic/claude-…`）取最后一段 —— 公司另有分组标签，名字里不重复；
* 5. 各段之间用**连字符**连接（官方名就是带中心线的：`Claude-Sonnet-4.5`、`GPT-5.1-Codex`）；
* 6. **大小写不参与语义**：`meituan/LongCat-2.0` 与 `longcat-2.0` 必须同名（2026-10-20 实测
*    两家网关写出 `LongCat` / `Longcat` 两种，同一模型看起来是两个）。
*
* 只用于**展示**：请求里永远用原始 id（`model.id`），两者绝不互换。
* @module dsh-llm-account/src/core/model-names
*/
/** 品牌/产品词的官方写法（小写键）。 */
const BRAND_WORDS = {
	gpt: "GPT",
	o: "o",
	claude: "Claude",
	anthropic: "Anthropic",
	openai: "OpenAI",
	gemini: "Gemini",
	google: "Google",
	deepseek: "DeepSeek",
	qwen: "Qwen",
	glm: "GLM",
	zai: "Zai",
	kimi: "Kimi",
	moonshot: "Moonshot",
	longcat: "LongCat",
	mimo: "MiMo",
	hy: "Hy",
	grok: "Grok",
	xai: "xAI",
	llama: "Llama",
	meta: "Meta",
	mistral: "Mistral",
	minimax: "MiniMax",
	step: "Step",
	stepfun: "StepFun",
	hunyuan: "Hunyuan",
	ernie: "ERNIE",
	doubao: "Doubao",
	seed: "Seed",
	nemotron: "Nemotron",
	nvidia: "NVIDIA",
	sonnet: "Sonnet",
	opus: "Opus",
	haiku: "Haiku",
	fable: "Fable",
	luna: "Luna",
	sol: "Sol",
	terra: "Terra",
	astra: "Astra",
	pro: "Pro",
	max: "Max",
	mini: "Mini",
	flash: "Flash",
	lite: "Lite",
	codex: "Codex",
	preview: "Preview",
	turbo: "Turbo",
	vision: "Vision",
	omni: "Omni",
	chat: "Chat",
	reasoner: "Reasoner",
	instruct: "Instruct",
	fast: "Fast",
	thinking: "Thinking",
	exp: "Exp",
	contributor: "Contributor"
};
/** 品牌词的常见连写（id 里没有分隔符时也能认出来）。 */
const BRAND_PREFIXES = [
	[/^gpt(?=\d)/i, "GPT-"],
	[/^glm(?=\d)/i, "GLM-"],
	[/^qwen(?=\d)/i, "Qwen"],
	[/^deepseek(?=v?\d)/i, "DeepSeek "],
	[/^gemini(?=\d)/i, "Gemini-"],
	[/^claude(?=\d)/i, "Claude"],
	[/^kimi(?=[a-z]?\d)/i, "Kimi"],
	[/^grok(?=\d)/i, "Grok-"]
];
/** 结尾的日期/快照后缀：`-20250929`、`-2025-09-29`、`-0918`（撞名时还会借它区分）。 */
const SNAPSHOT_SUFFIX = /(?:[-_@](?:20\d{6}|20\d{2}[-_]\d{2}[-_]\d{2}|\d{4}))+$/;
/**
* 结尾的机器可读限定（`inclusionai/ling-3.1-flash:free` 的 `:free`）。
*
* 它是**价格标记**，不是模型名的一部分 —— 印成 `Ling-3.1-Flash:free` 是界面在泄漏内部
* 语法。去掉它不影响「哪个模型」：同一份目录里真出现 `x` 与 `x:free` 两个 id 时，
* {@link assignUniqueNames} 会把 `free` 加回括号里区分。
*/
const QUALIFIER_SUFFIX = /:[a-z][a-z0-9_.-]*$/i;
/** 一段是不是纯数字（版本号的一半）。 */
function isNumeric(token) {
	return /^\d+$/.test(token);
}
/**
* 把一串 id 片段转成官方展示名。
* @param id - 模型 id（可带公司前缀与快照后缀）。
* @returns 展示名；空输入原样返回空串。
*/
function officialModelName(id) {
	const trimmed = id.trim();
	if (trimmed === "") return "";
	const segments = trimmed.split("/");
	let base = segments[segments.length - 1] ?? trimmed;
	base = base.replace(SNAPSHOT_SUFFIX, "");
	base = base.replace(QUALIFIER_SUFFIX, "");
	if (base === "") return trimmed;
	base = base.toLowerCase();
	for (const [pattern, replacement] of BRAND_PREFIXES) if (pattern.test(base)) {
		base = base.replace(pattern, replacement);
		break;
	}
	const tokens = base.split(/[-_\s]+/).filter((token) => token !== "");
	const words = [];
	for (const token of tokens) {
		if (isNumeric(token) && words.length > 0 && /^\d+$/.test(words[words.length - 1] ?? "")) {
			words[words.length - 1] = `${words[words.length - 1]}.${token}`;
			continue;
		}
		const brand = BRAND_WORDS[token];
		if (brand !== void 0) {
			words.push(brand);
			continue;
		}
		if (/^\d+(?:\.\d+)*$/.test(token)) {
			words.push(token);
			continue;
		}
		words.push(token.charAt(0).toUpperCase() + token.slice(1));
	}
	return words.join("-");
}
/**
* 一个 id 与它的展示名之间「被规则吃掉的差异」。撞名时用它区分两行。
*
* 两种来源都算：日期快照（`-0902`）与价格限定（`:free`）。`step-5-preview` 与
* `step-5-preview-free` 归一后同名，靠 `free` 才能区分。
* @param id - 模型 id。
* @returns 差异标记；没有就是空串。
*/
function markerOf(id) {
	const tail = tailOf(id);
	const snapshot = (tail.match(SNAPSHOT_SUFFIX)?.[0] ?? "").replace(/^[-_@]+/, "").replace(/[-_]+/g, "");
	if (snapshot !== "") return snapshot;
	return (tail.match(QUALIFIER_SUFFIX)?.[0] ?? "").replace(/^:/, "");
}
/** id 去掉公司前缀后的最后一段（撞名时的最终退路）。 */
function tailOf(id) {
	const segments = id.trim().split("/");
	return segments[segments.length - 1] ?? id.trim();
}
/**
* 给一份目录定展示名：先按 {@link officialModelName} 归一，**再消掉撞名**。
*
* 为什么必须去重：归一后可能撞名。线上实测 `Qwen/Qwen3.8-Max` 与 `Qwen/Qwen3.8-Max-0902`
* 都会变成 `Qwen3.8-Max` —— 界面上就是两个一模一样、但选哪一个都不知道的行。规则：
*
* 1. 不撞名的一个字符都不改（绝大多数行走这一条）；
* 2. 撞名的先借**被规则吃掉的差异**区分：日期快照 `Qwen3.8-Max (0902)`、价格限定
*    `Step-5-Preview (free)`；
* 3. 还撞就退回 id 的最后一段；
* 4. 仍撞才加序号。
*
* **撞名时短名归「没带快照后缀」的那个 id**：`Qwen3.8-Max` 必须叫 `Qwen3.8-Max`，让位的
* 该是 `Qwen3.8-Max-0902`。按目录顺序先到先得会反过来 —— 目录里带日期的变体常排在前面，
* 结果同一模型在别家（目录里只有短名）叫 `Qwen3.8-Max`、这家叫 `Qwen3.8-Max (2)`，
* 名字又对不上了。排序只影响撞名的那一组，不撞名的顺序一字不动。
*
* 展示名之间**大小写不敏感**地唯一：宿主的模型选择器按名字展示，用户也按名字认。
* @param ids - 目录里的模型 id，**保持目录顺序**。
* @returns 与入参等长、一一对应的展示名。
*/
function assignUniqueNames(ids) {
	const out = ids.map((id) => officialModelName(id));
	const groups = /* @__PURE__ */ new Map();
	out.forEach((name, index) => {
		const key = name.toLowerCase();
		const bucket = groups.get(key);
		if (bucket === void 0) groups.set(key, [index]);
		else bucket.push(index);
	});
	for (const [, indexes] of groups) {
		if (indexes.length < 2) continue;
		const ordered = [...indexes].sort((left, right) => {
			return (tailOf(ids[left] ?? "").match(SNAPSHOT_SUFFIX) === null ? 0 : 1) - (tailOf(ids[right] ?? "").match(SNAPSHOT_SUFFIX) === null ? 0 : 1) || left - right;
		});
		const used = /* @__PURE__ */ new Set([(out[ordered[0]] ?? "").toLowerCase()]);
		let counter = 1;
		for (const index of ordered.slice(1)) {
			const base = out[index] ?? "";
			const tail = tailOf(ids[index] ?? "");
			let candidate = base;
			const marker = markerOf(ids[index] ?? "");
			if (marker !== "") candidate = `${base} (${marker})`;
			if (used.has(candidate.toLowerCase()) && tail !== base && !base.toLowerCase().includes(tail.toLowerCase())) candidate = `${base} (${tail})`;
			while (used.has(candidate.toLowerCase())) {
				counter += 1;
				candidate = `${base} (${counter})`;
			}
			out[index] = candidate;
			used.add(candidate.toLowerCase());
		}
	}
	return out;
}
//#endregion
//#region src/vendors/model-catalog-registry.ts
/**
* **跨厂商模型清单**的宿主侧注册表：限额换模型时用来找「同名模型」。
*
* 为什么需要它：每个 adapter 只认识自己那一家（`registerAdapter` 给的是单个 provider），
* 而「换到别家的同名模型」必须知道另外两家有哪些模型。三条 provider 行在同一个进程里跑，
* 各自 `apply` 时把自己的目录读口登记进来，谁要换模型就查这份合并清单。
*
* 纪律：
* - 纯登记，不做网络：读口由各行的适配器提供（`catalogModels`），本模块只负责合并且
*   带一次短 TTL 缓存（换模型是**失败路径**上的事，不该每次失败都打三次目录端点）；
* - 登记用 `provider` 作键，重复登记覆盖（同一行重载时不该出现两份）；
* - 任何读口失败都只是「这家这次没有候选」，不影响别家。
* @module dsh-llm-account/src/vendors/model-catalog-registry
*/
/** 合并清单的缓存新鲜期（毫秒）：一分钟。失败路径上的目录查询不该每次都打三个端点。 */
const CACHE_TTL_MS = 6e4;
/** 已登记的读口（provider → source）。 */
const sources = /* @__PURE__ */ new Map();
/** Store each gateway separately so a fresh list from one cannot mask another. */
const cache = /* @__PURE__ */ new Map();
let generation = 0;
/** Capture before reading a picker catalog so it cannot publish across a settings change. */
function catalogCandidateRevision() {
	return generation;
}
function registerCatalogSource(source) {
	if (!isSwitchableProvider(source.provider)) return;
	sources.set(source.provider, source);
	invalidateCatalogCandidates();
}
function fresh(provider, now) {
	const entry = cache.get(provider);
	return entry !== void 0 && now - entry.at < CACHE_TTL_MS ? entry : void 0;
}
function allowsModel(provider, model) {
	const source = sources.get(provider);
	return source?.available?.() !== false && source?.allowsModel?.(model) !== false;
}
function store(provider, rows, now) {
	const value = rows.flatMap((row) => {
		if (typeof row.id !== "string" || row.id.trim() === "" || !allowsModel(provider, row.id)) return [];
		return [{
			provider,
			model: row.id,
			...row.contextWindow === void 0 ? {} : { contextWindow: row.contextWindow },
			...row.effortCount === void 0 ? {} : { effortCount: row.effortCount },
			...row.inputModalities === void 0 ? {} : { inputModalities: row.inputModalities }
		}];
	});
	cache.set(provider, {
		at: now,
		value
	});
}
/** Read any registered gateway whose cached list is missing or expired. */
async function modelCandidates(now = Date.now()) {
	const started = generation;
	await Promise.all([...sources.values()].map(async (source) => {
		if (fresh(source.provider, now) !== void 0) return;
		try {
			if (source.available?.() === false) return;
			const rows = await source.models();
			if (started === generation) store(source.provider, rows, now);
		} catch {
			if (started === generation && fresh(source.provider, now) === void 0) store(source.provider, [], now);
		}
	}));
	return cachedModelCandidates(now) ?? [];
}
/** Return only fresh cached candidates without contacting any gateway. */
function cachedModelCandidates(now = Date.now()) {
	const values = [];
	let found = false;
	for (const provider of cache.keys()) {
		const entry = fresh(provider, now);
		if (entry === void 0) continue;
		found = true;
		for (const candidate of entry.value) if (allowsModel(provider, candidate.model)) values.push(candidate);
	}
	return found ? values : void 0;
}
/** Reuse the visible models read by a gateway's normal model picker. */
function noteCatalogModels(provider, models, now = Date.now(), revision = generation) {
	if (revision !== generation || !isSwitchableProvider(provider)) return;
	const source = sources.get(provider);
	if (source?.available?.() === false) {
		store(provider, [], now);
		return;
	}
	if (models.some((row) => source?.allowsModel?.(row.id) === false)) return;
	store(provider, models, now);
}
/** Settings changed. Drop cached rows and prevent old in-flight reads from restoring them. */
function invalidateCatalogCandidates() {
	generation += 1;
	cache.clear();
}
/**
* 把一次请求**委托给另一家**（跨厂商换模型的执行层）。
*
* 为什么需要这一层：宿主的 `GenerateOptions.provider` 由路由决定，adapter 不能改它 ——
* 一个 commandcode 的 adapter 无法「以 opendesign 的身份」发请求。所以换到别家同名模型时，
* 必须由**目标那一家的 adapter** 自己去发。这里就是那个转接点：查注册表拿到目标家的
* `stream`，把 `options` 的 `provider` 改成目标家再调过去。
*
* 安全约束：
* - 目标家必须**已登记且提供了 `stream`**（否则返回 `undefined`，调用方按「换不了」处理）；
* - 目标家必须**不是官方直连**（`isOfficialProvider` 由调用方在挑候选时已排除，这里再挡一次
*   作为纵深防御）；
* - 只换 `provider` / `model` 两个字段，其余（消息、工具、signal）**原样透传** —— 请求语义
*   不该因为换了家而变。
* @param target - 目标 (provider, model)。
* @param options - 原始请求（形状由调用方保证；本层只做字段替换）。
* @returns 目标家的 chunk 流；不能委托时为 `undefined`。
*/
function delegateStream(target, options) {
	/**
	* **白名单闸门**（2026-11-08，需求「只准在三个网关之间切换」）。
	*
	* 放在 `sources.get` **之前**：即使有别的插件把自己的 `stream` 登记进来，
	* 也不该从我们这条路径被当成切换目标。判据与 `pickFallbackModel` 是同一个函数，
	* 两处不会分叉。
	*/
	if (!isSwitchableProvider(target.provider)) return void 0;
	const source = sources.get(target.provider);
	if (source === void 0 || source.stream === void 0) return void 0;
	/**
	* **执行前复核一次可用性**（2026-11-04 外部审查 U08）。
	*
	* 光在 {@link modelCandidates} 里过滤还不够：候选清单有 60 秒缓存，
	* 用户在这段时间里关掉厂商，缓存里的旧候选仍然会把请求转过去。
	* 这一行保证「禁用之后立刻不会再被调用」。
	*/
	if (!allowsModel(target.provider, target.model)) return void 0;
	if (isOfficialProvider(target.provider)) return void 0;
	return source.stream({
		...options,
		provider: target.provider,
		model: target.model
	});
}
//#endregion
//#region src/core/usage/port.ts
/** 什么都不记的端口（测试与「统计被关掉」时用）。 */
const NOOP_USAGE_PORT = { record: () => void 0 };
//#endregion
//#region src/core/catalog.ts
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* 把来源不可信的原始值收敛成合法形状。
*
* 只接受布尔值：`modelVisibility` 中非布尔的键值对被丢弃，一个合法项都不剩时整个字段省略；
* `visibleModels` 中非字符串的元素被丢弃（字段本身仍是数组时保留，空数组表示全部可见）。
* 非对象输入（`null` / 字符串 / 数字 / 数组）返回空可见性，即不做任何限制。
*
* **空串与纯空白一律丢弃**（白名单与显隐键两处）：`[""]` 会被当成「非空白名单」，
* 让所有模型从选择器里消失 —— 旧插件里的 `storedAllowlist`（行号不记：每次构建都会重新编号）
* 过滤 `m !== ""`、`readVisibility` 过滤 `id !== ""`，客户端 `normalizeModels`
* 同样丢弃；三处对同一份字段的读法必须一致。
* @param raw - 设置文档中的原始值。
* @returns 收敛后的可见性设置；不修改入参。
*/
function normalizeVisibility(raw) {
	if (!isRecord$2(raw)) return {};
	const result = {};
	const list = raw.visibleModels;
	if (Array.isArray(list)) result.visibleModels = list.filter((item) => typeof item === "string" && item.trim() !== "");
	const map = raw.modelVisibility;
	if (isRecord$2(map)) {
		const allowed = {};
		for (const [id, value] of Object.entries(map)) if (typeof value === "boolean" && id.trim() !== "") allowed[id] = value;
		if (Object.keys(allowed).length > 0) result.modelVisibility = allowed;
	}
	return result;
}
/**
* 判定单个模型 id 是否可见。三条规则按优先级顺序短路，顺序即语义。
*
* 与 {@link isModelVisible} 是同一份实现的两个入口：设置页只有 id（目录里的模型再加上
* 手工项），没有完整条目；两处各写一份规则迟早会分叉。
* @param id - 模型 id。
* @param visibility - 可见性设置（应已归一化）。
* @returns 该 id 是否应出现在模型选择器里。
*/
function isModelIdVisible(id, visibility) {
	const override = visibility.modelVisibility?.[id];
	if (override !== void 0) return override;
	const allow = visibility.visibleModels;
	if (allow !== void 0 && allow.length > 0) return allow.includes(id);
	return false;
}
/**
* 判定单个模型条目是否可见。
* @param entry - 目录条目；按 `entry.id` 匹配。
* @param visibility - 可见性设置（应已归一化）。
* @returns 该条目是否应出现在目录里。
*/
function isModelVisible(entry, visibility) {
	return isModelIdVisible(entry.id, visibility);
}
/**
* 过滤目录，保持输入顺序。
* @param entries - 待过滤的目录条目。
* @param visibility - 可见性设置（应已归一化）。
* @returns 新的条目数组；不修改 `entries`。
*/
function selectVisible(entries, visibility) {
	return entries.filter((entry) => isModelVisible(entry, visibility));
}
//#endregion
//#region src/core/failures.ts
/**
* 构造一次拒绝。`resetAt` 只在厂商确实给出重置时刻时传入 —— 缺省时**不写**该字段，
* 让「未知重置时刻」与「已知重置时刻」在数据上可区分（轮换引擎据此选择冷却策略）。
* @param kind - 失败分类。
* @param message - 面向用户的说明。
* @param resetAt - 重置时刻（epoch 毫秒）；缺省表示厂商未给出。
* @returns 新的拒绝记录。
*/
function rejection(kind, message, resetAt) {
	return resetAt === void 0 ? {
		kind,
		message
	} : {
		kind,
		message,
		resetAt
	};
}
/**
* **宿主会自动重试**的失败分类（与 `switching/auto-continue.ts` 的
* `NEVER_RETRY_CODES` 互补）。
*
* 那边的黑名单是 `ABORTED` / `CONTEXT_WINDOW_EXCEEDED` / `INVALID_CREDENTIAL` /
* `QUOTA`；落到分类上就是「除 `quota` 与 `invalid-credential` 之外都重试」。
*/
const RETRYABLE_KINDS = /* @__PURE__ */ new Set([
	"server",
	"network",
	"rate-limit",
	"unavailable"
]);
/**
* 账号试完时，该把**哪一条**失败抛给宿主。
*
* ## 为什么不能直接抛最后一条
*
* 2026-11-06 的真实事故：一个请求内按规则顺序连试 3 个账号 ——
* 第 1 个只是瞬时 5xx，第 2、3 个都是 402 `insufficient_balance`。用尽时抛的是
* **最后一条**（配额），于是：
*
* - 用户看到「本轮运行失败，当前请求的额度已用尽」，以为账号没钱了；
* - `QUOTA` 在 `NEVER_RETRY_CODES` 里 —— 宿主的自动继续**不会**重试，这一轮直接死掉；
* - 用户手动发「继续」立刻成功，因为跨请求 `tried` 会重置、第 1 个账号本来就没问题。
*
* 也就是说：**抛哪一条决定了宿主会不会救这一轮**。链条里明明有可自愈的瞬时失败，
* 却抛出不可重试的终态，等于替用户判了死刑。
*
* ## 规则
*
* 1. 链条里有可重试的分类（`server` / `network` / `rate-limit` / `unavailable`）→
*    抛**最后一条**这样的失败（最新鲜的信号；宿主的重试等 2 秒就够）；
* 2. 全都是终态（`quota` / `invalid-credential`）→ 抛最后一条（此时换谁都一样，
*    原来那个信息量最大）。
*
* 注意本函数**只**决定「抛哪一条」，不改任何账号状态、不改变重试次数 ——
* 拒绝表与轮换顺序完全照旧。
* @param failures - 本请求内按尝试顺序记录的失败。
* @returns 该抛出的那一条；`failures` 为空时为 `undefined`。
*/
function pickExhaustedFailure(failures) {
	if (failures.length === 0) return void 0;
	for (let index = failures.length - 1; index >= 0; index -= 1) {
		const candidate = failures[index];
		if (candidate !== void 0 && RETRYABLE_KINDS.has(candidate.rejection.kind)) return candidate;
	}
	return failures[failures.length - 1];
}
//#endregion
//#region src/core/attempt-ledger.ts
/**
* 一个请求内的账号尝试记账。
*
* 用法（与抽取前的循环一一对应）：
*
* ```ts
* const ledger = new AttemptLedger(() => this.#maxTried());
* for (;;) {
*   const ref = rotation.pick({ model, tried: ledger.tried });
*   if (ref === undefined) ledger.throwExhausted(() => new LlmError(..., "MISSING_CREDENTIAL"));
*   ledger.beginAttempt(ref);
*   ...
*   ledger.note({ rejection, thrown });          // 记一次失败
*   if (ledger.reachedMax()) ledger.throwExhausted(() => ...);
* }
* ```
*/
var AttemptLedger = class {
	maxTried;
	/** 本请求内已经试过的账号（按 ref 去重）。 */
	tried = /* @__PURE__ */ new Set();
	/** 本请求内**按尝试顺序**记录的全部失败。 */
	failures = [];
	/** 最近一次失败（换模型回退要读它的分类）。 */
	last;
	/**
	* @param maxTried - 本请求最多试几个账号（现读设置，热更新即时生效）。
	*/
	constructor(maxTried) {
		this.maxTried = maxTried;
	}
	/**
	* 占位一个账号：记入 `tried`（同一请求内不再重复选它）。
	*
	* **必须在真正发请求之前调用** —— 抽取前的三家代码都是 `tried.add(ref)` 紧接
	* 取凭据，顺序反了会让「没有可用密钥」的账号被反复选中。
	* @param ref - 账号 ref。
	*/
	beginAttempt(ref) {
		this.tried.add(ref);
	}
	/**
	* 记一次失败（同时更新 `last` 与失败链）。
	* @param failure - 分类结果与要抛的错误。
	*/
	note(failure) {
		this.last = failure;
		this.failures.push(failure);
	}
	/** 是否已经用满本请求的尝试次数。 */
	reachedMax() {
		return this.tried.size >= this.maxTried();
	}
	/**
	* 抛给宿主：**优先抛可重试的那一条**，而不是最后碰巧失败的那一条。
	*
	* 选择规则见 `failures.ts` 的 {@link pickExhaustedFailure}（60 行注释，含事故来由）：
	* 链条里有可自愈的瞬时失败时抛它，宿主会在几秒后自动重试并把这一轮救回来；
	* 抛一条永不重试的终态等于替用户判死刑。
	* @param noAccount - 一条失败都没有时的兜底错误（通常是「没有可用账号」）。
	* @returns 永不返回（总是抛出）。
	*/
	throwExhausted(noAccount) {
		const picked = pickExhaustedFailure(this.failures) ?? this.last;
		if (picked === void 0) throw noAccount();
		throw picked.thrown;
	}
};
//#endregion
//#region src/core/attempt-loop.ts
/** 一份干净的用量计数。 */
function emptyCounts() {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0
	};
}
/**
* 一个 usage 块计入的 token 总数（缺 `totalTokens` 时按分项相加）。
*
* 与抽取前三家各自的实现一致：厂商可能把 `totalTokens` 省掉，那时用三项之和。
* @param usage - 宿主的用量块。
* @returns 计入 `totalTokens` 的数量。
*/
function usageTotal(usage) {
	const explicit = usage.totalTokens;
	if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
	return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}
/**
* 跑完一次请求：账号轮换、失败分类、有条件的换号与换模型。
* @param host - 厂商提供的那一组钩子。
* @param initialOptions - 宿主的完整请求。
* @returns 与线上同序的 chunk 流。
*/
async function* runAttemptLoop(host, initialOptions) {
	await host.beforeRequest?.({
		...initialOptions.sessionId === void 0 ? {} : { sessionId: String(initialOptions.sessionId) },
		...initialOptions.purpose === void 0 ? {} : { purpose: initialOptions.purpose }
	});
	const config = host.resolveConfig();
	const ledger = new AttemptLedger(() => host.maxTried());
	/**
	* 本次请求是否**已经换过模型**（只换一次：替代也限额就停手，不再套娃）。
	*
	* 从 `options` 里读初值（2026-11-01 修 R01）：跨网关委托时 `delegateStream` 会把
	* options 透传给目标家的 adapter，如果每家都用自己实例上的 `false` 重新开始，
	* 就会出现 **A→B→A** 的无限往返 —— 每家都觉得自己"还没换过"。
	*/
	let swappedOnce = initialOptions.swappedOnce === true;
	let options = initialOptions;
	/** 本轮第一个被选中的账号（opencode 的提位判定用；其余两家不读）。 */
	let firstPick;
	for (;;) {
		if (options.signal?.aborted === true) throw host.abortError(options.signal);
		const ref = host.rotation.pick({
			model: options.model,
			tried: ledger.tried
		});
		if (ref === void 0) {
			/**
			* 换模型的机会：所有账号都被**拒绝**了（继续换账号已无意义，换同名模型往往还能服务）。
			*
			* 只在「确实有账号被拒绝」时才尝试 —— `ledger.last === undefined` 意味着一条凭据
			* 都没解析到（`MISSING_CREDENTIAL`），那种情况换模型毫无意义，而且查候选要读各家
			* 目录（会发额外请求）。先抛确定性的失败，别为一次注定失败的请求去打网络。
			*/
			if (!swappedOnce && ledger.last !== void 0 && ledger.last.rejection.kind !== "invalid-credential") {
				const swapped = await host.fallbackModel?.(options, ledger.last.rejection.kind);
				if (swapped !== void 0 && (swapped.provider !== options.provider || swapped.model !== options.model)) {
					swappedOnce = true;
					if (swapped.provider !== options.provider) {
						const delegated = host.delegate?.(swapped, {
							...options,
							swappedOnce: true
						});
						if (delegated !== void 0) {
							yield* delegated;
							return;
						}
					} else {
						options = {
							...options,
							model: swapped.model
						};
						ledger.tried.clear();
						host.onModelSwitched?.();
						continue;
					}
				}
			}
			if (ledger.last !== void 0) ledger.throwExhausted(() => host.noAccount(options.model));
			throw host.noAccount(options.model);
		}
		ledger.beginAttempt(ref);
		if (firstPick === void 0) firstPick = ref;
		let credential;
		const attemptContext = host.beginAttempt?.();
		try {
			credential = await host.resolveCredential(ref, options.signal);
		} catch (error) {
			if (options.signal?.aborted === true) throw host.abortError(options.signal);
			const classified = host.classifyCredentialError?.(error);
			if (classified === void 0) throw error;
			ledger.note(classified);
			if (ledger.reachedMax()) ledger.throwExhausted(() => host.noAccount(options.model));
			continue;
		}
		if (credential === void 0) {
			ledger.note(host.missingCredential(ref));
			if (ledger.reachedMax()) ledger.throwExhausted(() => host.noAccount(options.model));
			continue;
		}
		const counts = emptyCounts();
		let emitted = false;
		let totalTokens = 0;
		/** usage 块延后发送（opencode）：避免「先报用量、随后整轮失败」。 */
		let pendingUsage;
		const pump = {
			text: "",
			sawToolCall: false,
			lastBlockIndex: -1
		};
		const iterator = host.attempt(config, options, credential, attemptContext)[Symbol.asyncIterator]();
		let failure;
		let exhausted = false;
		try {
			for (;;) {
				let step;
				try {
					step = await iterator.next();
				} catch (error) {
					failure = error;
					break;
				}
				if (step.done === true) {
					exhausted = true;
					break;
				}
				let chunk = step.value;
				if (chunk.type === "text-delta") pump.text += chunk.text;
				if (chunk.type === "tool-call-delta" || chunk.type === "block-start" && chunk.blockType === "tool-call") pump.sawToolCall = true;
				if (chunk.type === "block-start" || chunk.type === "block-end" || chunk.type === "tool-call-delta") {
					if (chunk.index > pump.lastBlockIndex) pump.lastBlockIndex = chunk.index;
				}
				if (chunk.type === "block-end" && chunk.block.type === "tool-call") pump.sawToolCall = true;
				if (chunk.type === "usage") {
					totalTokens += usageTotal(chunk.usage);
					counts.inputTokens += chunk.usage.inputTokens ?? 0;
					counts.outputTokens += chunk.usage.outputTokens ?? 0;
					counts.cacheReadTokens += chunk.usage.cacheReadTokens ?? 0;
					counts.cacheWriteTokens += chunk.usage.cacheWriteTokens ?? 0;
					if (host.deferUsage === true) {
						pendingUsage = chunk;
						continue;
					}
				}
				const rewritten = host.onChunk?.(pump, chunk);
				if (rewritten !== void 0) {
					if (pendingUsage !== void 0) {
						yield pendingUsage;
						pendingUsage = void 0;
					}
					for (const replacement of rewritten) {
						emitted = true;
						yield replacement;
					}
					continue;
				}
				if (pendingUsage !== void 0) {
					yield pendingUsage;
					pendingUsage = void 0;
				}
				if (!(chunk.type === "usage" && host.usageCountsAsEmitted === false)) emitted = true;
				yield chunk;
			}
		} finally {
			if (!exhausted) {
				const closing = iterator.return?.(void 0);
				if (closing !== void 0) closing.catch(() => {});
			}
		}
		if (exhausted) {
			if (pendingUsage !== void 0) yield pendingUsage;
			host.noteSettled(ref);
			host.recordUsage(ref, options.model, "success", counts);
			if (firstPick !== void 0 && ref !== firstPick) host.promoteServed?.(ref);
			return;
		}
		if (options.signal?.aborted === true || host.isAbort(failure)) {
			host.recordUsage(ref, options.model, "failure", counts, "aborted");
			throw failure;
		}
		const classified = await host.classify(failure, attemptContext);
		if (classified === void 0) {
			host.recordUsage(ref, options.model, "failure", counts, "request");
			throw host.wrapRequestLevelError?.(failure) ?? failure;
		}
		host.rotation.markRejected(ref, classified.rejection);
		ledger.note(classified);
		host.recordUsage(ref, options.model, "failure", counts, classified.rejection.kind);
		if (!host.rotation.fallbackAllowed({
			emitted,
			totalTokens,
			aborted: false
		})) throw classified.thrown;
		if (ledger.reachedMax()) ledger.throwExhausted(() => host.noAccount(options.model));
	}
}
//#endregion
//#region src/core/transport.ts
/**
* 请求内核：给任意 chunk 流套上两个时间预算 —— 整请求 deadline 与流空闲看门狗。
*
* 厂商无关、只负责时序与错误码：不认识任何厂商概念，也不碰 `stop` 参数（拒绝不支持的
* `stop` 序列是宿主契约、由适配器负责）。
*
* **预算从「开始消费」算起**：异步生成器在被第一次 `next()` 之前不执行任何代码，因此
* 调用 `runStream()` 本身不启动原始流、不上膛定时器 —— 「拿到流却从不消费」不会泄漏
* handle；代价是 deadline 也从第一次索取开始计，而不是从 `runStream()` 调用时刻。
*
* **唤醒只靠真实定时器**：注入的 `now` 只用于判定整请求 deadline 的边界（定时器回调
* 还没轮到、chunk 却已越过 deadline 的情形），不替代定时器。
*
* **关闭原始流是尽力而为**：超时/中止时只发一次 `return()` 请求、**不等它完成**。实测
* 卡在永不落地的 `await` 上的异步生成器不会处理 `return()`（`await iterator.return()`
* 永久挂起），而那正是看门狗要救的场景 —— 等它等于让看门狗失效。
* @module dsh-llm-account/src/core/transport
*/
/** 整请求超出 deadline 时抛出的错误码（宿主按这个字符串路由重试，不按错误类型）。 */
const LLM_REQUEST_TIMEOUT = "LLM_REQUEST_TIMEOUT";
/** 流在空闲预算内没有任何 chunk 时抛出的错误码。 */
const LLM_STREAM_IDLE_TIMEOUT = "LLM_STREAM_IDLE_TIMEOUT";
/**
* 调用方中止时抛出的错误码。宿主 `LlmRuntime` 用同一个字符串判定「这次请求是被取消的」，
* 所以这里不另起名字；它不是本模块的公开常量（调用方只需认识 `LlmError.code`）。
*/
const ABORTED = "ABORTED";
/**
* Node 会把大于该值的延迟夹到 1ms（等于立刻触发）。上膛前先夹住上界，于是「一个足够大的
* 数」自然地表示「不限制」，不必再引入哨兵值。
*/
const MAX_TIMER_DELAY_MS = 2147483647;
/**
* 把预算毫秒夹到 Node 真正能调度的范围。
* @param ms - 预算毫秒。
* @returns 上膛用的延迟；非正数或 NaN 交给 `setTimeout` 按 0 处理（立即触发，快速失败），
*   因为配置校验属于设置层，不在这里重复。
*/
function armDelay(ms) {
	return Math.min(ms, MAX_TIMER_DELAY_MS);
}
/**
* 把打断原因翻译成宿主认识的 `LlmError`。
* @param kind - 打断原因。
* @param budget - 当前预算，用于说明文案。
* @param signal - 调用方信号，仅 `abort` 分支用来保留原始中止原因。
* @returns 带稳定 `code` 的错误。
*/
function interruptionError(kind, budget, signal) {
	switch (kind) {
		case "abort": return signal?.reason === void 0 ? new LlmError("the caller aborted the request", ABORTED) : new LlmError("the caller aborted the request", ABORTED, { cause: signal.reason });
		case "request": return new LlmError(`the request did not finish within ${budget.requestTimeoutMs}ms`, LLM_REQUEST_TIMEOUT);
		case "idle": return new LlmError(`the provider stream produced no chunk for ${budget.streamIdleTimeoutMs}ms`, LLM_STREAM_IDLE_TIMEOUT);
	}
}
/**
* 尽力关闭原始流：只发关闭请求，不等它完成（见模块头注释）。关闭失败或迟迟不落地都不
* 改写已经确定的错误，也不产生未处理的拒绝。
* @param iterator - 原始流的迭代器。
*/
function closeQuietly(iterator) {
	try {
		const closing = iterator.return?.();
		if (closing !== void 0) closing.catch(() => {});
	} catch {}
}
/**
* 用整请求 deadline 与流空闲看门狗包住一个 chunk 流，并按原顺序透传。
*
* 两个预算同时成立、互不抑制：各自有独立定时器，谁先到就报谁的码；**同一时刻都该到点时
* 整请求 deadline 赢**（它先上膛）。已经越过 deadline 的 chunk 不再下发。
* @param source - 上游 chunk 流（例如 `TransportPort.stream()` 的结果）。
* @param budget - 两个时间预算。
* @param opts - 调用方取消信号与时钟注入点。
* @returns 与 `source` 同序的 chunk 流；预算耗尽或调用方中止时抛 `LlmError`。
*/
async function* runStream(source, budget, opts = {}) {
	const now = opts.now ?? Date.now;
	const signal = opts.signal;
	/**
	* **打断时同时取消底层网络**（2026-11-01 修 R03 第三版）。
	*
	* 报告的复现：正文停住 → 空闲/整请求超时 → 上层报超时，但 `reader.cancel` 仍是 0、
	* 底层 body 还开着。原因是 `closeQuietly(iterator)` 依赖「迭代器能被 return 掉」，
	* 而一个真正卡在 `read()` 上的 Web Stream reader 不会响应。
	*
	* 现在打断路径上主动调 `abortNetwork()` —— 那是 `fetch` 的 controller，
	* abort 会让 reader 的 read 立刻 reject，socket 随之释放。
	*/
	const stopNetwork = () => {
		try {
			opts.abortNetwork?.();
		} catch {}
	};
	if (signal?.aborted === true) throw interruptionError("abort", budget, signal);
	const deadlineAt = now() + budget.requestTimeoutMs;
	let interrupt = () => {};
	const interrupted = new Promise((resolve) => {
		interrupt = resolve;
	});
	const onAbort = () => interrupt({ kind: "abort" });
	const iterator = source[Symbol.asyncIterator]();
	let idleTimer;
	let exhausted = false;
	signal?.addEventListener("abort", onAbort);
	const deadlineTimer = setTimeout(() => interrupt({ kind: "request" }), armDelay(budget.requestTimeoutMs));
	try {
		while (true) {
			idleTimer = setTimeout(() => interrupt({ kind: "idle" }), armDelay(budget.streamIdleTimeoutMs));
			const outcome = await Promise.race([iterator.next().then((result) => ({
				kind: "chunk",
				result
			})), interrupted]);
			clearTimeout(idleTimer);
			idleTimer = void 0;
			if (outcome.kind !== "chunk") throw interruptionError(outcome.kind, budget, signal);
			if (outcome.result.done === true) {
				exhausted = true;
				return;
			}
			if (now() >= deadlineAt) throw interruptionError("request", budget, signal);
			yield outcome.result.value;
		}
	} finally {
		clearTimeout(idleTimer);
		clearTimeout(deadlineTimer);
		signal?.removeEventListener("abort", onAbort);
		/**
		* 没有正常消费完（超时/取消/下游提前结束）→ **两层都停**：
		* 先试着礼貌关闭迭代器，再直接 abort 底层网络。
		*/
		if (!exhausted) {
			closeQuietly(iterator);
			stopNetwork();
		}
	}
}
/**
* 一次**外部请求**的整请求预算（跨阶段共享）。
*
* ## 为什么不是每次调用都传 `requestTimeoutMs`（2026-11-01 修 R02 第二版）
*
* 上一版给「fetch / 读错误正文 / 协议重发 / runStream」**每一段**都套一个
* `withRequestDeadline(budget)`。而每个都从**当下**开始算完整预算，于是：
*
* ```
* 用户配 90ms：
*   等响应头 60ms（< 90 ✓）→ 读错误正文 60ms（< 90 ✓）→ 合计 120ms > 90ms
*   → 但每一段都"没超时"，整请求实际跑了 120ms
* ```
*
* 实测确认：整请求 90ms 的设置下，把两段各设 60ms，请求仍然跑满 120ms 才结束。
*
* 正确语义是**一个 deadline，所有阶段共用剩余时间**。这个类就是那个共享状态：
* 构造时记下截止时刻，每次 `remainingMs()` 返回剩余，各阶段用它当预算。
*/
var RequestDeadline = class {
	/** 截止时刻（epoch 毫秒）。 */
	deadlineAt;
	/**
	* **整条请求共享的网络取消入口**（2026-11-01 修 R03 第三版）。
	*
	* 它必须跨阶段存活：`fetch` 拿到响应头之后，`withRequestDeadline` 的调用结束、
	* 它自己的 timer 被清掉 —— 若只靠那里，后面的「读错误正文」与「流式读 chunk」
	* 就没有任何 controller 可 abort 了（报告实测 `reader.cancel = 0`、body 仍开着）。
	*
	* 这个 controller 活到 `abort()` 被调用为止；流式阶段用
	* {@link networkAbort} 把它接进 `runStream`。
	*/
	networkController = new AbortController();
	/**
	* @param budgetMs - 整请求预算（毫秒）。
	* @param now - 时钟注入点；缺省 `Date.now`。
	*/
	constructor(budgetMs, now = Date.now) {
		this.deadlineAt = now() + Math.max(1, budgetMs);
	}
	/**
	* 还剩多少毫秒。
	*
	* 已过期时返回一个**极小正数**（不返回 0 或负数）：调用方把它当预算传给
	* `withRequestDeadline` / `runStream`，而那些实现按「正数」校验。返回 0 会让它们
	* 退化成「不限制」。
	* @returns 剩余毫秒（至少 1）。
	*/
	remainingMs() {
		return Math.max(1, this.deadlineAt - Date.now());
	}
	/**
	* 取消整条请求的网络（任何阶段都可调用，重复调用无害）。
	* @param reason - 取消原因（会作为 abort reason 传给底层）。
	*/
	abort(reason) {
		if (this.networkController.signal.aborted) return;
		this.networkController.abort(reason);
	}
	/**
	* 交给 `runStream` 的「取消底层网络」入口。
	* @returns 一个无参函数，调用即 abort。
	*/
	networkAbort() {
		return () => this.abort(new LlmError("the request was cancelled", ABORTED));
	}
	/**
	* 用**共享 deadline 的剩余预算**包住一次异步操作。超时/取消都会 abort 共享网络。
	* @param operation - 要执行的操作（收到可透传给 `fetch` 的 signal）。
	* @param streamIdleTimeoutMs - 流空闲预算（只透传，本方法不用）。
	* @param opts - 调用方取消信号与时钟注入点。
	* @returns 操作结果。
	*/
	run(operation, streamIdleTimeoutMs, opts = {}) {
		return withRequestDeadline(operation, {
			requestTimeoutMs: this.remainingMs(),
			streamIdleTimeoutMs
		}, {
			...opts,
			/**
			* **把共享 controller 接进来**：这个阶段超时时 abort 的是
			* `this.networkController`，而不是一个用完就丢的临时 controller ——
			* 后面的流式阶段才能继续用它（见 `networkAbort`）。
			*/
			networkSignal: this.networkController.signal,
			onTimeout: (reason) => this.abort(reason)
		});
	}
	/**
	* 把剩余预算交给 `runStream`（流式阶段同样不该重置）。
	* @param streamIdleTimeoutMs - 流空闲预算。
	* @returns `runStream` 需要的预算对象。
	*/
	streamBudget(streamIdleTimeoutMs) {
		return {
			requestTimeoutMs: this.remainingMs(),
			streamIdleTimeoutMs
		};
	}
};
/**
* 用**整请求 deadline** 包住一次可能长时间挂起的异步操作（`fetch`、读错误正文）。
*
* ## 为什么需要（2026-11-01 修 R02）
*
* `runStream` 的 deadline 只覆盖**已经开始产出 chunk 之后**。而一次真实请求里：
*
* ```
* const response = await this.#post(...);              // fetch 等响应头，没有超时
* if (!response.ok) await readErrorBody(response);     // 读错误正文，没有超时
* yield* runStream(decodeStream(response.body), ...);  // 超时只包住这里
* ```
*
* 网关接受连接但**永不返回响应头**时（典型的半开连接、被上游挂起），用户配的
* `requestTimeoutMs` 完全不起作用 —— 请求会一直挂着，直到宿主自己放弃。
*
* ## 语义
*
* - 超时抛 `LLM_REQUEST_TIMEOUT` —— 与 `runStream` 的整请求超时**同一个码**，
*   宿主与界面看到的是同一类失败；
* - **不取消底层操作**：这条路径上 `fetch` 不接受我们的 signal，超时只停止等待。
*   与 `quotaWithTimeout` 同一取舍；底层 promise 挂了 `.catch` 兜住，不会变成
*   unhandled rejection；
* - `signal` 中止仍然优先（用户按停止立即生效）。
* @param operation - 要执行的异步操作（会收到可透传给 `fetch` 的 signal）。
* @param budget - 时间预算（只用 `requestTimeoutMs`）。
* @param opts - 调用方取消信号与时钟注入点。
* @returns 操作结果。
*/
async function withRequestDeadline(operation, budget, opts = {}) {
	const callerSignal = opts.signal;
	if (callerSignal?.aborted === true) throw callerSignal.reason === void 0 ? new LlmError("the caller aborted the request", ABORTED) : new LlmError("the caller aborted the request", ABORTED, { cause: callerSignal.reason });
	let interrupt = () => {};
	const interrupted = new Promise((resolve) => {
		interrupt = resolve;
	});
	const onAbort = () => interrupt({ kind: "abort" });
	callerSignal?.addEventListener("abort", onAbort);
	/**
	* **超时也要真的取消底层请求**（2026-11-01 修 R03 第三版）。
	*
	* ## 上一版的问题
	*
	* 上一版把 `opts.signal` 原样传给 `operation` —— 那是**调用方**的信号，
	* 只在用户按停止时 abort。于是超时的语义是「我不等了」：
	*
	* ```
	* 30 秒到 → 界面报 LLM_REQUEST_TIMEOUT
	*        → 但 fetch 手里的 signal 从未 abort
	*        → 底层请求继续跑到自然结束（TCP 层可能要 2 分钟以上）
	* ```
	*
	* 更糟的是超时码**不在** `NEVER_RETRY_CODES` 里 —— 自动重试会再发一次，
	* 3 次重试就是 **3 条僵死连接同时在途**（实测复审确认 `signal.aborted` 仍为
	* false、`reader.cancel` 未被调用）。
	*
	* ## 现在的做法
	*
	* 建一个**自己的** controller，超时时 abort 它；再与调用方的信号合并成一个
	* `AbortSignal.any([...])` 传给底层。于是：
	*
	* - 超时 → 底层 `fetch` 收到 abort → socket 立即释放；
	* - 用户按停止 → 同样 abort（且理由优先，见下面的 `interrupt` 竞态）；
	* - 正常完成 → `finally` 里不 abort（那会把已完成的响应也标脏）。
	*
	* `AbortSignal.any` 需要 Node ≥20.3；本包 engines 要求 `>=22.19.0`，可用。
	*
	* ## 第三版补充：可以接一个**外部**的共享信号
	*
	* `opts.networkSignal` 有值时（`RequestDeadline.run` 会传），它与上面的临时
	* controller **合并** —— 于是超时既打断本次等待，也 abort 那个跨阶段存活的
	* controller，后续流式阶段才会看到取消。
	*/
	const timeoutController = new AbortController();
	/** 参与合并的所有信号：调用方、本次超时、（可选）外部共享。 */
	const parts = [];
	if (callerSignal !== void 0) parts.push(callerSignal);
	parts.push(timeoutController.signal);
	if (opts.networkSignal !== void 0) parts.push(opts.networkSignal);
	/** 底层看到的信号：其中任一发生就 abort。 */
	const signal = parts.length === 1 ? parts[0] : AbortSignal.any(parts);
	const timer = setTimeout(() => {
		const reason = new LlmError(`the request did not finish within ${budget.requestTimeoutMs}ms`, LLM_REQUEST_TIMEOUT);
		timeoutController.abort(reason);
		try {
			opts.onTimeout?.(reason);
		} catch {}
		interrupt({ kind: "request" });
	}, armDelay(budget.requestTimeoutMs));
	/**
	* 底层操作；超时后它**会**被 signal 取消，但取消是异步的（fetch 需要一拍）。
	* 仍然挂 `catch` 兜住 —— 否则 abort 导致的 rejection 可能变成 unhandled。
	*/
	const running = operation(signal).then((value) => ({
		kind: "ok",
		value
	}));
	try {
		const outcome = await Promise.race([running, interrupted]);
		if (outcome.kind === "ok") return outcome.value;
		throw interruptionError(outcome.kind, budget, callerSignal);
	} finally {
		clearTimeout(timer);
		callerSignal?.removeEventListener("abort", onAbort);
		running.catch(() => {});
	}
}
//#endregion
//#region src/core/image-projection.ts
/**
* 图片投影：把宿主的 `ImageBlock` 变成**各协议能发包的形状**（2026-11-04 外部审查 U07）。
*
* ## 为什么要有这个模块
*
* 审查确认：
*
* > 目录宣称image能力，混图出站只剩文字，纯图可变为空消息；流仍正常完成，
* > 用户无法知道模型没收到图。
*
* 根因是两处叠加：opencode / commandcode 的协议层只调 `textOf(content)` 取文本，
* 而它们的 adapter 连取字节的 `resolveImage` 依赖都没有 —— 只有 Open Design 接了。
* 于是「勾选了识图模型、发了图、模型什么也没看到」，且**没有任何报错**。
*
* 把「取字节」与「投影成协议形状」放进 core，三家共用同一份，避免再次各写一半。
*
* ## 取不到字节时的行为
*
* **降级成文字占位，绝不静默丢弃**：用户至少能从模型反应／请求正文里看出「这里本该有图」。
* 这与宿主 `textOnlyImageText` 的意图一致。
*
* @module dsh-llm-account/src/core/image-projection
*/
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Preserve the host's file handle contract; never invent a filesystem path or PDF text. */
function fileBlockText(block) {
	const ref = block.attachment;
	if (!isRecord$1(ref) || typeof ref.attachmentId !== "string" || ref.attachmentId.trim() === "" || typeof ref.name !== "string" || ref.name.trim() === "" || typeof ref.bytes !== "number" || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) throw new LlmError("Cannot project a file block with an invalid attachment reference", "UNSUPPORTED_CONTENT");
	return fileHandleText(block.attachment, void 0);
}
/**
* Assistant 历史图片的占位文本（2026-11-05 外部审查 F10）。
*
* ## 为什么不再拼 attachmentId
*
* 占位的作用是**告诉模型「这里原本有一张图，但这次没有内联」**。上一版把宿主的
* `attachmentId` 也拼了进去 —— 模型无法凭这个 id 读到附件（它只是本地持久化标识），
* 所以那段字符纯属无用输入：每张历史图都白吃一段 prompt。
*
* 同时它还是**内部标识的最小化问题**：附件 id 属于宿主内部命名空间，没有必要
* 出现在发往上游的正文里。
*
* 需要区分多张图时用**请求内序号**（见 {@link assistantImageText} 的 `index`），
* 那既够用又不暴露内部 id。
* @param block - assistant 消息里的图片块。
* @param index - 本次请求内第几张 assistant 历史图（从 1 开始；缺省不带序号）。
* @returns 占位文本。
*/
function assistantImageText(block, index) {
	return `[历史 assistant 图片${index === void 0 ? "" : ` #${index}`}：${block.offloaded === true ? "已卸载，" : ""}原图未内联，本次仅保留占位，不能据此推断图片内容]`;
}
/** Reject unsupported image roles before attachment I/O instead of silently dropping data. */
function assertProjectableContent(messages) {
	for (const message of messages) for (const block of message.content) {
		if (block.type === "file") fileBlockText(block);
		if (block.type === "image" && message.role !== void 0 && message.role !== "user" && message.role !== "tool" && message.role !== "assistant") throw new LlmError(`Image blocks in ${message.role} messages are not supported by this route`, "UNSUPPORTED_CONTENT");
	}
}
/**
* 单张图片的字节上限（与宿主 `readImageRequest` 的内联额度同量级）。
*
* 注意：这是**单张**上限，挡不住「20 张各 5 MiB」—— 总预算见
* {@link IMAGE_REQUEST_BUDGET_BYTES} 与 {@link collectImageBytes}。
*/
const SINGLE_IMAGE_MAX_BYTES = 5242880;
var BudgetedImages = class extends Map {
	/** Input message index → content indexes omitted by the budget. */
	omitted = /* @__PURE__ */ new Map();
};
/**
* Read attachments serially, sharing decoded bytes for repeated references.
* Allocate the count and byte budgets per outbound occurrence, newest first.
*/
async function collectImageBytes(messages, resolve, signal, budget = {}) {
	const images = new BudgetedImages();
	const skipped = /* @__PURE__ */ new Set();
	if (resolve === void 0) return {
		images,
		skipped
	};
	const maxBytes = budget.maxBytes ?? 25165824;
	const maxCount = budget.maxCount ?? 24;
	const unavailable = /* @__PURE__ */ new Map();
	let usedCount = 0;
	let usedBytes = 0;
	const omit = (id, messageIndex, contentIndex) => {
		skipped.add(id);
		let positions = images.omitted.get(messageIndex);
		if (positions === void 0) {
			positions = /* @__PURE__ */ new Set();
			images.omitted.set(messageIndex, positions);
		}
		positions.add(contentIndex);
	};
	for (const { id, ref, messageIndex, contentIndex } of [...imageOccurrencesOf(messages)].reverse()) {
		if (signal?.aborted === true) {
			if (images.has(id)) omit(id, messageIndex, contentIndex);
			continue;
		}
		if (unavailable.get(id) === "missing") continue;
		if (usedCount >= maxCount || usedBytes >= maxBytes || unavailable.get(id) === "budget") {
			omit(id, messageIndex, contentIndex);
			continue;
		}
		let bytes = images.get(id);
		if (bytes === void 0) try {
			bytes = await resolve(ref, signal);
		} catch {}
		if (bytes === void 0) {
			unavailable.set(id, "missing");
			skipped.add(id);
			continue;
		}
		const size = bytes.data.byteLength;
		if (usedBytes + size > maxBytes) {
			unavailable.set(id, "budget");
			omit(id, messageIndex, contentIndex);
			continue;
		}
		usedCount += 1;
		usedBytes += size;
		images.set(id, bytes);
	}
	return {
		images,
		skipped
	};
}
/** Replace only the over-budget occurrences before serializing a request. */
function projectImageBudget(messages, images) {
	if (!(images instanceof BudgetedImages) || images.omitted.size === 0) return messages;
	return messages.map((message, messageIndex) => {
		const omitted = images.omitted.get(messageIndex);
		if (omitted === void 0) return message;
		return {
			...message,
			content: message.content.map((block, contentIndex) => {
				if (block.type !== "image" || !omitted.has(contentIndex)) return block;
				return {
					type: "text",
					text: `[图片超出本次请求预算：${block.attachment?.attachmentId ?? "未知附件"}，原图未内联]`
				};
			})
		};
	});
}
/**
* 从插件上下文取一张图的字节。
*
* 走宿主的 `attachments.readImageRequest(ref, target, signal)`：
* 它负责解码、缩放、并按 `maxBytes` 决定是否内联。
*
* **必须传完整的 `ImageRefLike`**（2026-10-20 真机报障）：宿主会用
* `mediaType` / `bytes` / `width` / `height` 做引用校验，只给 `attachmentId`
* 会被拒绝，表现就是「图片未能发送」。
* @param ctx - 插件上下文（用来 `get("attachments")`）。
* @param ref - 宿主给的持久化图片引用。
* @param signal - 请求取消信号。
* @returns 编码后的字节与 MIME；拿不到时 `undefined`（由调用方降级成占位文本）。
*/
async function readImageBytes(ctx, ref, signal) {
	try {
		const get = ctx.get;
		const attachments = typeof get === "function" ? get.call(ctx, "attachments") : void 0;
		if (!isRecord$1(attachments)) return void 0;
		const read = attachments.readImageRequest;
		if (typeof read !== "function") return void 0;
		const target = {
			width: 4096,
			height: 4096,
			maxBytes: SINGLE_IMAGE_MAX_BYTES
		};
		const result = await read.call(attachments, ref, target, signal);
		if (!isRecord$1(result)) return void 0;
		const data = result.data;
		const mediaType = result.mediaType;
		if (!(data instanceof Uint8Array) || typeof mediaType !== "string" || mediaType === "") return;
		return {
			attachmentId: ref.attachmentId,
			data,
			mediaType
		};
	} catch {
		return;
	}
}
function* imageOccurrencesOf(messages) {
	assertProjectableContent(messages);
	for (const [messageIndex, message] of messages.entries()) {
		if (message.role === "assistant") continue;
		for (const [contentIndex, block] of message.content.entries()) {
			if (block.type !== "image" || block.offloaded === true) continue;
			const ref = block.attachment;
			if (ref != null && typeof ref.attachmentId === "string" && ref.attachmentId !== "") yield {
				id: ref.attachmentId,
				ref,
				messageIndex,
				contentIndex
			};
		}
	}
}
/**
* 取不到字节时的文字占位。
*
* **不能静默丢弃**：审查的原话是「流仍正常完成，用户无法知道模型没收到图」。
* 有了这一行，模型至少知道「这里本该有一张图」，用户也能从回答里察觉异常。
* @param attachmentId - 附件 id（可能为空）。
* @returns 占位文本。
*/
function missingImagePlaceholder(attachmentId) {
	return `[图片未能发送：${attachmentId ?? "未知附件"}]`;
}
/** 把编码后的字节拼成 data URL（OpenAI / Anthropic 都认的通用形状）。 */
function dataUrlOf(image) {
	return `data:${image.mediaType};base64,${Buffer.from(image.data).toString("base64")}`;
}
/**
* 把 base64 单独算出来（Anthropic 的 `source.base64` 只要数据部分，不要 `data:` 前缀）。
* @param image - 图片字节。
* @returns base64 字符串。
*/
function base64Of(image) {
	return Buffer.from(image.data).toString("base64");
}
//#endregion
//#region src/client/usage-contract.ts
/** 贡献所属的 npm 包（描述符 id 的前缀）。 */
const USAGE_PACKAGE = "dsh-llm-account";
/** 宿主侧 cordis 服务键；两个 profile 行共享同一个实例。 */
const USAGE_SERVICE_KEY = "llmAccountUsage";
/** 线上命名空间：端点 = `<namespace>/<method>`，客户端侧服务名 = `remote.<namespace>`。 */
const USAGE_NAMESPACE = "llm-account";
/** 本包托管的三条厂商路由（客户端只做参数校验，不认识厂商语义）。 */
const VENDOR_IDS = [
	"commandcode",
	"dsh-opencode-go",
	"opendesign"
];
/** 边界校验失败：说出是哪个端点、哪个字段。 */
function boundaryError(endpoint, detail) {
	return /* @__PURE__ */ new Error(`${USAGE_PACKAGE}: ${endpoint} boundary violation: ${detail}`);
}
/**
* 把一个边界值写进错误消息。
*
* **不能直接用 `JSON.stringify`**：它对 BigInt 抛 `TypeError`、对循环引用也抛 ——
* 于是「报一个边界错误」这件事自己先崩了，调用方拿到的是一个跟边界毫无关系的
* TypeError（主机与客户端同进程，线上值不一定是 JSON 能序列化的东西）。
* @param value - 待描述的边界值。
* @returns 一段安全的文本；序列化不了就退到类型名。
*/
function describeValue(value) {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return Object.prototype.toString.call(value);
	}
}
/** 判定「普通对象」。 */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* 校验线上厂商 id。
* @param value - 边界值。
* @returns 合法的厂商 id。
*/
function parseVendorId(value) {
	if (typeof value === "string" && VENDOR_IDS.includes(value)) return value;
	throw boundaryError(`${USAGE_NAMESPACE}/vendor`, `expected a known vendor id, got ${describeValue(value)}`);
}
/**
* 校验状态结果：结构 + **逐项洗 `quota`**。
*
* 为什么不能只查顶层（2026-10-20 复审发现）：页面用 `quota?.windows?.length` 判「有没有
* 额度数据」—— 字符串也有 `length`，所以 `windows: "oops"` 会通过那个假值检查，紧接着
* `.map` 抛错。虽然三处卡片都有 `RenderBoundary` 兜底（不会白屏），但那块面板会降级成
* 「面板失败 + 重试」—— 一个坏字段换掉整个面板。
*
* 与 `parseCatalogModels` 同一条纪律：**边界上逐项清洗**，让下游可以信任形状。
* `windows` / `failures` 不是数组时直接归空数组（而不是丢掉整行）：账号本身还有
* `label` / `configured` 这些有用信息。
* @param endpoint - 调用方端点名（错误消息要指名是哪条调用）。
* @param value - 边界值。
*/
function parseVendorUsageStatus(endpoint, value) {
	if (!isRecord(value) || !Array.isArray(value.accounts)) throw boundaryError(endpoint, "expected an object with an accounts array");
	const accounts = value.accounts.map((account) => {
		if (!isRecord(account)) return account;
		const quota = account.quota;
		if (!isRecord(quota)) return quota === null || quota === void 0 ? account : {
			...account,
			quota: void 0
		};
		const windows = (Array.isArray(quota.windows) ? quota.windows : []).map(cleanQuotaWindow).filter(isDefined);
		const failures = Array.isArray(quota.failures) ? quota.failures : [];
		return {
			...account,
			quota: {
				...quota,
				windows,
				failures
			}
		};
	});
	return {
		...value,
		accounts
	};
}
/** 类型守卫：过滤掉 `undefined`。 */
function isDefined(value) {
	return value !== void 0;
}
/**
* 洗一个额度窗口：只保留**形状正确**的字段。
*
* 数字字段必须是有限数字（`NaN` / 字符串 / `null` 一律归缺失 —— 缺失 ≠ 0，界面上
* 「没有这个数」与「这个数是零」是两回事）；`unit` 只认已知单位；`key` 必须是非空字符串。
* 认不出 `key` 的整条丢掉：没有键就没有标签可显示，留着只会渲染出一个空行。
* @param raw - 线上来的一个窗口元素。
* @returns 干净的窗口，或 `undefined`（连 key 都没有）。
*/
function cleanQuotaWindow(raw) {
	if (!isRecord(raw)) return void 0;
	const key = raw.key;
	if (typeof key !== "string" || key.trim() === "") return void 0;
	const window = { key };
	const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
	const used = number(raw.used);
	if (used !== void 0) window.used = used;
	const cap = number(raw.cap);
	if (cap !== void 0) window.cap = cap;
	const percent = number(raw.percent);
	if (percent !== void 0) window.percent = percent;
	const resetAt = number(raw.resetAt);
	if (resetAt !== void 0) window.resetAt = resetAt;
	if (raw.unit === "usd") window.unit = "usd";
	if (raw.exceeded === true) window.exceeded = true;
	if (raw.unlimited === true) window.unlimited = true;
	if (raw.resetEstimated === true) window.resetEstimated = true;
	if (raw.usedSource === "local" || raw.usedSource === "vendor") window.usedSource = raw.usedSource;
	return window;
}
/** 校验账号行数组。 */
function parseAccountViews(endpoint, value) {
	if (!Array.isArray(value)) throw boundaryError(endpoint, "expected an array of account views");
	return value;
}
/** 校验切换记录数组。 */
function parseSwitchRecords(endpoint, value) {
	if (!Array.isArray(value)) throw boundaryError(endpoint, "expected an array of switch records");
	return value;
}
/** 校验一次登录尝试的状态。 */
function parseLoginStatus(endpoint, value) {
	if (!isRecord(value) || typeof value.state !== "string") throw boundaryError(endpoint, "expected a login status object with a state field");
	return value;
}
/**
* 校验模型目录结果。
*
* 只查结构、逐项清洗：目录与失败原因都来自宿主，但页面不该因为一个坏行就整块崩掉；
* 读不出内容的行直接丢弃，失败项只保留字符串。
*/
function parseCatalogModels(endpoint, value) {
	if (!isRecord(value) || !Array.isArray(value.models)) throw boundaryError(endpoint, "expected a models result with a models array");
	return {
		models: value.models.filter((item) => isRecord(item)).filter((item) => typeof item.id === "string").map((item) => ({
			id: item.id,
			...typeof item.name === "string" ? { name: item.name } : {},
			...typeof item.company === "string" ? { company: item.company } : {},
			...item.free === true ? { free: true } : {}
		})),
		failures: Array.isArray(value.failures) ? value.failures.filter((item) => typeof item === "string") : []
	};
}
/** 校验一条账号行。 */
function parseAccountView(endpoint, value) {
	if (!isRecord(value) || typeof value.ref !== "string") throw boundaryError(endpoint, "expected an account view with a ref");
	return value;
}
/** 无返回值的调用（宿主方法返回 `void`）：接受任何值并归一到 `undefined`。 */
function parseVoid() {}
/**
* 校验「磁盘已安装版本」：必须是非空字符串。
*
* 拒绝空串：空版本号会让漂移检测永远判为「不一致」，于是每次加载都弹刷新提示 ——
* 那比不提示更糟。宁可在这里失败（客户端据此视为「读不到」，不弹）。
* @param endpoint - 调用点（错误信息里点名）。
* @param value - 宿主返回值。
* @returns 版本字符串。
*/
function parseInstalledVersion(endpoint, value) {
	const text = typeof value === "string" ? value.trim() : "";
	if (text === "") throw new Error(`${endpoint}: expected a non-empty version string`);
	return text;
}
/**
* 校验导出结果：必须是一段**非空**的 CSV 文本。
*
* 为什么拒绝空串：真实导出**永远至少有表头**（`ledgerCsvOf` 对空台账也返回表头），所以
* 空串只可能来自坏掉的宿主。接受它会让用户下载到一个 0 字节文件，还以为导出成功了 ——
* 那是这条路径上最糟的失败形态（静默地给出一个看起来成功的结果）。
* @param endpoint - 调用点（错误信息里点名）。
* @param value - 线上值。
* @returns CSV 文本。
*/
function parseUsageCsv(endpoint, value) {
	if (typeof value !== "string") throw boundaryError(endpoint, `expected the CSV text, got ${describeValue(value)}`);
	if (value === "") throw boundaryError(endpoint, "expected a CSV header, got an empty string");
	return value;
}
/**
* 校验「凭据状态」的结果。
*
* 只收 `{ ref, configured }` 两项：这是**布尔摘要**，绝不搬运密钥本身
* （那会把它传进浏览器内存，而界面上从来不需要它）。
* 形状不合格的行丢掉；一条都不剩时返回空数组（界面据此显示「未添加」）。
* @param endpoint - 调用点。
* @param value - 线上值。
* @returns 逐条状态。
*/
function parseCredentialStatus(endpoint, value) {
	if (!Array.isArray(value)) throw boundaryError(endpoint, `expected an array of credential statuses, got ${describeValue(value)}`);
	const out = [];
	for (const row of value) {
		if (!isRecord(row)) continue;
		const ref = row.ref;
		const configured = row.configured;
		if (typeof ref !== "string" || ref === "") continue;
		if (typeof configured !== "boolean") continue;
		out.push({
			ref,
			configured
		});
	}
	return out;
}
/**
* 校验用量报表。
*
* **必须逐层校验**，不能只看顶层：渲染时会直接解引用 `account.period.kind` /
* `bucket.*` / `total.bucket`，任何一层缺失都会在渲染期抛 TypeError —— React 因此
* 丢弃整棵子树，表现就是「刷新用量统计时整块内容消失」（2026-10-19 报障）。
*
* 策略：不认识的行**丢弃**而不是整体报错 —— 少一行明细好过整页消失。
*/
function parseUsageReport(endpoint, value) {
	if (!isRecord(value) || !isRecord(value.total) || !Array.isArray(value.accounts)) throw boundaryError(endpoint, "expected a usage report with accounts and total");
	const total = value.total;
	if (!isRecord(total.bucket)) throw boundaryError(endpoint, "expected total.bucket to be an object");
	const accounts = value.accounts.filter(isAccountUsageRow);
	const byVendor = Array.isArray(total.byVendor) ? total.byVendor.filter(isVendorBucketRow) : [];
	const lastUsed = lastUsedOf(value.lastUsed);
	const failuresByKind = failuresByKindOf(value.failuresByKind);
	const failuresByAccount = failuresByAccountOf(value.failuresByAccount);
	return {
		accounts,
		total: {
			window: isUsageWindow(total.window) ? total.window : "today",
			bucket: total.bucket,
			byVendor,
			...typeof total.lastAt === "number" && Number.isFinite(total.lastAt) ? { lastAt: total.lastAt } : {}
		},
		...lastUsed === void 0 ? {} : { lastUsed },
		...failuresByKind === void 0 ? {} : { failuresByKind },
		...failuresByAccount === void 0 ? {} : { failuresByAccount }
	};
}
/**
* 校验并搬运「按账号的失败明细」。
*
* 逐行核对：`account` 非空、`rows` 是数组且其中每一行形状合格。坏行**丢弃**（一行坏掉不该
* 让整块消失）；`rows` 全坏时整个账号条目丢弃。一条都没有时返回 `undefined`。
* @param value - 线上值（形状不可信）。
* @returns 按账号的明细；没有合格条目时为 `undefined`。
*/
function failuresByAccountOf(value) {
	if (!Array.isArray(value)) return void 0;
	const out = [];
	for (const entry of value) {
		if (!isRecord(entry)) continue;
		const vendor = entry.vendor;
		const account = entry.account;
		if (typeof vendor !== "string" || vendor === "") continue;
		if (typeof account !== "string") continue;
		const rows = failuresByKindOf(entry.rows);
		if (rows === void 0) continue;
		out.push({
			vendor,
			account,
			rows
		});
	}
	return out.length === 0 ? void 0 : out;
}
/**
* 校验并搬运失败明细。
*
* 逐行核对四个字段：形状不合格的行**丢弃**（一行坏掉不该让整块消失）。一行都不剩时返回
* `undefined` —— 界面上「没有失败」与「明细读不到」因此长得一样，这正是我们要的：
* 不给用户一条「失败 0 次」的行。
* @param value - 线上值（形状不可信）。
* @returns 明细行；没有合格行时为 `undefined`。
*/
function failuresByKindOf(value) {
	if (!Array.isArray(value)) return void 0;
	const rows = value.filter((row) => {
		if (!isRecord(row)) return false;
		return typeof row.kind === "string" && row.kind !== "" && typeof row.count === "number" && Number.isFinite(row.count) && typeof row.lastAt === "number" && Number.isFinite(row.lastAt) && typeof row.lastAccount === "string";
	});
	return rows.length === 0 ? void 0 : rows;
}
/** 合法的窗口值。 */
function isUsageWindow(value) {
	return value === "today" || value === "7d" || value === "30d" || value === "all";
}
/**
* 校验并搬运「最近一次请求的账号」。
*
* 四个字段（vendor / account / at 必须有效，model 可空）都核对过才收下 —— 缺一块的读数
* 拿去渲染只会让侧边栏挑不到账号，静默退回清单第一个（看起来像「不跟随」）。
* @param value - 线上值（形状不可信）。
* @returns 校验后的读数；不合格时为 `undefined`（当作「没有」，不猜）。
*/
function lastUsedOf(value) {
	if (!isRecord(value)) return void 0;
	const { vendor, account, at } = value;
	if (typeof vendor !== "string" || vendor === "") return void 0;
	if (typeof account !== "string" || account === "") return void 0;
	if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return void 0;
	return {
		vendor,
		account,
		model: typeof value.model === "string" ? value.model : "",
		at
	};
}
/**
* 一行账号用量是否**可渲染**：`period` 与 `bucket` 必须在。
*
* 只查渲染会直接解引用的字段；数字缺失由渲染层兜底（显示破折号），但对象整体缺失
* 必须在边界挡掉 —— 那正是「渲染期 TypeError → 整块消失」的来源。
*/
function isAccountUsageRow(value) {
	if (!isRecord(value)) return false;
	const period = value.period;
	if (!isRecord(period) || typeof period.kind !== "string" || typeof period.key !== "string") return false;
	if (typeof period.start !== "number" || typeof period.fromResetAt !== "boolean") return false;
	return isRecord(value.bucket);
}
/** 一家厂商的桶是否可渲染（`byVendor` 的每一行）。 */
function isVendorBucketRow(value) {
	return isRecord(value) && typeof value.vendor === "string" && isRecord(value.bucket);
}
/** 校验「添加账户」的输入。 */ function parseAddAccountInput(value) {
	if (!isRecord(value) || typeof value.label !== "string") throw boundaryError(`${USAGE_NAMESPACE}/addAccount`, "expected { label }");
	const key = value.key;
	return typeof key === "string" ? {
		label: value.label,
		key
	} : { label: value.label };
}
/** 校验一个必填字符串。 */
function parseString(endpoint, value) {
	if (typeof value !== "string") throw boundaryError(endpoint, `expected a string, got ${describeValue(value)}`);
	return value;
}
/** 校验一个数字（账号下标）。 */
function parseNumber(endpoint, value) {
	if (typeof value !== "number" || !Number.isFinite(value)) throw boundaryError(endpoint, `expected a finite number, got ${describeValue(value)}`);
	return value;
}
/** 校验一个布尔值。 */
function parseBoolean(endpoint, value) {
	if (typeof value !== "boolean") throw boundaryError(endpoint, `expected a boolean, got ${describeValue(value)}`);
	return value;
}
/** 校验「立即切换」的结果。 */
function parseSwitchNowResult(endpoint, value) {
	if (!isRecord(value) || typeof value.switched !== "boolean") throw boundaryError(endpoint, "expected { switched: boolean }");
	return {
		switched: value.switched,
		...typeof value.target === "string" ? { target: value.target } : {},
		...typeof value.reason === "string" ? { reason: value.reason } : {}
	};
}
/** 校验一个字符串数组。 */
function parseStringArray(endpoint, value) {
	if (!Array.isArray(value)) throw boundaryError(endpoint, "expected an array of strings");
	return value.filter((item) => typeof item === "string");
}
/** 校验全局切换设置。 */
function parseSwitchSettings(endpoint, value) {
	if (!isRecord(value)) throw boundaryError(endpoint, "expected a switch settings object");
	return {
		strategy: value.strategy === "best-quota" ? "best-quota" : value.strategy === "scheduled" ? "scheduled" : "order",
		intervalMinutes: typeof value.intervalMinutes === "number" && Number.isFinite(value.intervalMinutes) ? Math.min(43200, Math.max(0, Math.floor(value.intervalMinutes))) : 60,
		atTurnEnd: value.atTurnEnd !== false,
		autoSwitch: value.autoSwitch !== false
	};
}
/** 校验一个可空的字符串（`null` 表示「回到自动轮换」）。 */
function parseNullableString(endpoint, value) {
	if (value === null || value === void 0) return null;
	return parseString(endpoint, value);
}
/** 造一个强类型结果编解码（与旧插件 `makeStrictCodec` 同形）。 */
function strictCodec(typeSymbol, parse) {
	return {
		mode: "strict",
		typeSymbol: `${USAGE_PACKAGE}#${typeSymbol}`,
		create: () => ({ parse })
	};
}
/**
* 三个只读方法共用的参数：厂商 id。
*
* `parseVendorId` 只收一个值（它自己的语义），而描述符契约要双参 —— 所以这里**适配**，
* 不能直接把单参函数挂上去。挂错了的后果是运行时才暴露的：`parameterOf` 会把端点名
* （`"llm-account/status#vendor"`）当成 vendor 值去比对白名单，于是**每一次**带 vendor 的
* 调用都在网关边界上被拒（真机报错：`wire field "vendor" failed boundary validation`），
* 状态 / 账号 / 开关 / 增删改全线失效，而页面只会显示「账号数据暂不可用」。
*/
const VENDOR_PARAM = {
	name: "vendor",
	typeSymbol: "VendorId",
	parse: (_endpoint, value) => parseVendorId(value)
};
/** 账号 ref 参数。 */
const REF_PARAM = {
	name: "ref",
	typeSymbol: "AccountRef",
	parse: parseString
};
/** 模型 id 数组参数。 */
const MODELS_PARAM = {
	name: "models",
	typeSymbol: "AccountModels",
	parse: parseStringArray
};
/** 凭据引用名数组参数（查询它们是否真的配置了）。 */
const REFS_PARAM = {
	name: "refs",
	typeSymbol: "CredentialRefs",
	parse: parseStringArray
};
/** 密钥本身（只在这一条上行，绝不回读）。 */
const SECRET_PARAM = {
	name: "secret",
	typeSymbol: "CredentialSecret",
	parse: (endpoint, value) => {
		if (typeof value !== "string" || value.trim() === "") throw boundaryError(endpoint, "expected a non-empty secret");
		return value;
	}
};
/**
* 用量窗口参数（`today` / `7d` / `30d` / `all`）。
*
* 取值一旦不认识就退回 `today`：宁可少显示，也不要因为一个拼错的窗口让整块报表报错。
*/
const WINDOW_PARAM = {
	name: "window",
	typeSymbol: "UsageWindow",
	optional: true,
	parse: (_endpoint, value) => {
		if (typeof value !== "string") return "today";
		return value === "today" || value === "7d" || value === "30d" || value === "all" ? value : "today";
	}
};
/**
* 造一个参数描述符。
*
* 护栏：`parse` 的形参数必须 ≥ 2。这是唯一能机械拦住上面那类 arity 错误的检查 ——
* 类型系统放行，形状测试也放行，只有把真值喂进 `codec.create().parse()` 才会炸。
* @param spec - 参数规格。
* @param method - 所属方法名（拼端点用）。
*/
function parameterOf(spec, method) {
	if (spec.parse.length < 2) throw new Error(`${USAGE_PACKAGE}: parameter "${spec.name}" of ${USAGE_NAMESPACE}/${method} needs a (endpoint, value) parser, got one with ${spec.parse.length} argument(s)`);
	const parameterEndpoint = `${USAGE_NAMESPACE}/${method}#${spec.name}`;
	return {
		name: spec.name,
		wire: spec.name,
		source: "json",
		...spec.optional === true ? { acceptsUndefined: true } : {},
		codec: {
			mode: "strict",
			typeSymbol: `${USAGE_PACKAGE}#${spec.typeSymbol}`,
			create: () => ({ parse: (value) => spec.parse(parameterEndpoint, value) })
		}
	};
}
/** 造一个强类型调用描述符（端点 = `<namespace>/<method>`）。 */
function makeDescriptor(method, typeSymbol, parse, parameters) {
	const endpoint = `${USAGE_NAMESPACE}/${method}`;
	return {
		id: `${USAGE_PACKAGE}#${endpoint}`,
		service: USAGE_SERVICE_KEY,
		namespace: USAGE_NAMESPACE,
		method,
		invocation: { kind: "direct" },
		parameters: parameters.map((spec) => parameterOf(spec, method)),
		result: strictCodec(typeSymbol, (value) => parse(endpoint, value))
	};
}
/**
* 全部远程方法的描述符（每次调用返回新数组，避免调用方改到共享常量）。
* @returns 描述符列表。
*/
function usageDescriptors() {
	return [
		makeDescriptor("status", "VendorUsageStatus", parseVendorUsageStatus, [VENDOR_PARAM]),
		makeDescriptor("accounts", "AccountViewList", parseAccountViews, [VENDOR_PARAM]),
		makeDescriptor("switches", "SwitchRecordList", parseSwitchRecords, [VENDOR_PARAM]),
		makeDescriptor("installedVersion", "InstalledVersion", parseInstalledVersion, []),
		makeDescriptor("models", "CatalogModels", parseCatalogModels, [VENDOR_PARAM]),
		makeDescriptor("addAccount", "AccountView", parseAccountView, [VENDOR_PARAM, {
			name: "input",
			typeSymbol: "AddAccountInput",
			parse: (_endpoint, value) => parseAddAccountInput(value)
		}]),
		makeDescriptor("renameAccount", "Void", parseVoid, [
			VENDOR_PARAM,
			REF_PARAM,
			{
				name: "label",
				typeSymbol: "AccountLabel",
				parse: parseString
			}
		]),
		makeDescriptor("restoreAccountName", "Void", parseVoid, [VENDOR_PARAM, REF_PARAM]),
		makeDescriptor("replaceKey", "Void", parseVoid, [
			VENDOR_PARAM,
			REF_PARAM,
			{
				name: "key",
				typeSymbol: "ApiKey",
				parse: parseString
			}
		]),
		makeDescriptor("removeAccount", "Void", parseVoid, [VENDOR_PARAM, REF_PARAM]),
		makeDescriptor("selectAccount", "Void", parseVoid, [VENDOR_PARAM, {
			name: "ref",
			typeSymbol: "NullableAccountRef",
			parse: parseNullableString,
			optional: true
		}]),
		makeDescriptor("moveAccount", "Void", parseVoid, [
			VENDOR_PARAM,
			REF_PARAM,
			{
				name: "toIndex",
				typeSymbol: "AccountIndex",
				parse: parseNumber
			}
		]),
		makeDescriptor("setAutoSwitch", "Void", parseVoid, [VENDOR_PARAM, {
			name: "value",
			typeSymbol: "AutoSwitch",
			parse: parseBoolean
		}]),
		makeDescriptor("switchNow", "SwitchNowResult", parseSwitchNowResult, [VENDOR_PARAM]),
		makeDescriptor("setAccountOrder", "Void", parseVoid, [{
			name: "order",
			typeSymbol: "AccountOrder",
			parse: parseStringArray
		}]),
		makeDescriptor("setSwitchSettings", "Void", parseVoid, [{
			name: "settings",
			typeSymbol: "SwitchSettingsWrite",
			parse: parseSwitchSettings
		}]),
		makeDescriptor("setAccountModels", "Void", parseVoid, [
			VENDOR_PARAM,
			REF_PARAM,
			MODELS_PARAM
		]),
		makeDescriptor("loginBegin", "LoginStatus", parseLoginStatus, [VENDOR_PARAM]),
		makeDescriptor("loginStatus", "LoginStatus", parseLoginStatus, [VENDOR_PARAM]),
		makeDescriptor("loginCancel", "Void", parseVoid, [VENDOR_PARAM]),
		makeDescriptor("usageReport", "UsageReport", parseUsageReport, [WINDOW_PARAM]),
		makeDescriptor("usageClear", "Void", parseVoid, []),
		makeDescriptor("usageExportCsv", "UsageCsv", parseUsageCsv, [{
			name: "limit",
			typeSymbol: "ExportLimit",
			parse: parseNumber,
			optional: true
		}]),
		makeDescriptor("credentialStatus", "CredentialStatusList", parseCredentialStatus, [REFS_PARAM]),
		makeDescriptor("setCredential", "Void", parseVoid, [REF_PARAM, SECRET_PARAM])
	];
}
//#endregion
//#region src/core/last-used.ts
/**
* 从台账记录里找出**最近一次**（按时刻）属于**已登记账号**的请求。
*
* 为什么要过滤 `known`：台账里可能留着已经被删掉的账号（ref 不再存在），或者匿名的失败记录
* （`account` 为空串）。拿它去侧边栏显示会得到一个对不上的名字。
*
* @param records - 台账记录（任意顺序）。
* @param known - 判断一个 (vendor, account) 是否仍然存在；缺省表示全收。
* @returns 最近一次读数；没有可用记录时 `undefined`。
*/
function lastUsedAccountOf(records, known) {
	let best;
	for (const record of records) {
		if (typeof record.account !== "string" || record.account === "") continue;
		if (typeof record.vendor !== "string" || record.vendor === "") continue;
		if (!Number.isFinite(record.at) || record.at <= 0) continue;
		if (known !== void 0 && !known(record.vendor, record.account)) continue;
		if (best === void 0 || record.at > best.at) best = record;
	}
	if (best === void 0) return void 0;
	return {
		vendor: best.vendor,
		account: best.account,
		model: typeof best.model === "string" ? best.model : "",
		at: best.at
	};
}
//#endregion
//#region src/core/usage/export.ts
/** CSV 的列顺序（固定：Excel 打开时列不跳）。 */
const LEDGER_CSV_COLUMNS = [
	"at",
	"vendor",
	"account",
	"model",
	"outcome",
	"failureKind",
	"inputTokens",
	"outputTokens",
	"cacheReadTokens",
	"cacheWriteTokens"
];
/**
* Excel / LibreOffice 会当作**公式起始符**的字符（2026-10-22 按 bug 审查补）。
*
* `=` 普通公式、`+` 与 `-` 参与算术、`@` 是某些版本的控制符。以它们开头的单元格被
* 打开时会被求值，`=HYPERLINK(...)` 这类可以外带数据。
*
* 现实评估（审计报告原文）：导出的 `account` 列受 `CREDENTIAL_REF_PATTERN`
* （`^[A-Za-z_][A-Za-z0-9_]*$`）约束，不可能以这些字符开头；其余列是时间、厂商 id、
* 内部枚举与 token 数。唯一不可控来源是厂商 API 返回的 `model` id —— 也就是说
* **当前利用条件基本不成立**。
*
* 仍然加这层防护的理由：这是四行代码，而「不可控来源」一旦将来变多（比如加上用户
* 可编辑的备注列），漏掉它的代价是被打开表格的人替我们执行公式。
*/
const FORMULA_PREFIXES = [
	"=",
	"+",
	"-",
	"@"
];
/**
* 一个字段是否会被表格软件当成公式。
* @param text - 原始文本。
* @returns 是否以公式起始符开头。
*/
function looksLikeFormula(text) {
	return text !== "" && FORMULA_PREFIXES.includes(text[0]);
}
/**
* 把一个字段转成 CSV 安全的文本。
*
* 只含数字/字母/常见符号时不加引号（导出的文件更干净），出现分隔符、引号或以公式字符
* 开头时才整体包裹。
* @param value - 原始值。
* @returns 可安全放进一行 CSV 的文本。
*/
function cell(value) {
	if (value === void 0 || value === null) return "";
	const text = String(value);
	if (!/[",\r\n]/.test(text) && text.trim() !== "" && !looksLikeFormula(text)) return text;
	return `"${text.replace(/"/g, "\"\"")}"`;
}
/**
* 一个时刻 → ISO 8601；不可信的值原样写成数字而不是抛错。
*
* `new Date(NaN).toISOString()` 抛 `RangeError` —— 台账解析本来会过滤掉坏 `at`，但导出是
* **用户按一下就期待拿到文件**的操作：一行坏数据不该让整次导出失败。坏值写成原始数字，
* 既留下线索又不拖垮整个文件。
* @param at - 记录时刻（形状不可信）。
* @returns 可安全写进 CSV 的文本。
*/
function timestampOf(at) {
	if (typeof at !== "number" || !Number.isFinite(at)) return cell(at);
	const date = new Date(at);
	return Number.isNaN(date.getTime()) ? cell(at) : cell(date.toISOString());
}
/** 一条记录 → 一行 CSV。 */
function rowOf(record) {
	return LEDGER_CSV_COLUMNS.map((column) => {
		if (column === "at") return timestampOf(record.at);
		return cell(record[column]);
	}).join(",");
}
/**
* 把记录导成 CSV 文本（含表头）。
*
* 没有记录时**仍然给表头**：空文件与「导出了但这一段时间没有请求」在用户眼里应该能区分开。
* 行之间用 `\n`（RFC 4180 允许 CRLF，但 `\n` 对 git diff 与 Excel 都更宽容）。
* @param records - 要导出的记录（顺序即导出行序，通常按时间升序）。
* @returns CSV 文本。
*/
function ledgerCsvOf(records) {
	const header = LEDGER_CSV_COLUMNS.join(",");
	if (records.length === 0) return header;
	return [header, ...records.map(rowOf)].join("\n");
}
/**
* 只留最近 `limit` 条（导出不该把 120 天一次性塞给用户）。
*
* `limit` 非正数或非有限值时原样返回：导出是用户显式操作，「参数不合法」不该变成空文件。
* @param records - 全部记录（按时间升序）。
* @param limit - 最多保留多少条（取**尾部**，即最近的）。
* @returns 裁剪后的记录。
*/
function exportTailOf(records, limit) {
	if (!Number.isFinite(limit) || limit <= 0) return [...records];
	if (records.length <= limit) return [...records];
	return records.slice(records.length - limit);
}
//#endregion
//#region src/core/usage/failures.ts
/** 没有分类名时的归类键（不是空串：界面要能对它取词）。 */
const UNKNOWN_FAILURE_KIND = "unknown";
/** 一条失败的分类键：缺了就归 `unknown`。 */
function kindOf(record) {
	const kind = record.failureKind;
	return typeof kind === "string" && kind.trim() !== "" ? kind.trim() : UNKNOWN_FAILURE_KIND;
}
/**
* 按分类计数，并带上**最近一次**失败的线索。
* @param records - 台账记录。
* @returns 汇总行；没有失败时为空数组。
*/
function failureBreakdownOf(records) {
	const rows = /* @__PURE__ */ new Map();
	for (const record of records) {
		if (record.outcome !== "failure") continue;
		const kind = kindOf(record);
		const existing = rows.get(kind);
		if (existing === void 0) {
			rows.set(kind, {
				kind,
				count: 1,
				lastAt: record.at,
				lastAccount: record.account
			});
			continue;
		}
		existing.count += 1;
		if (record.at >= existing.lastAt) {
			existing.lastAt = record.at;
			existing.lastAccount = record.account;
		}
	}
	return [...rows.values()].sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
}
/**
* 失败明细的分组键：`vendor\u0000account`。
*
* 为什么必须带厂商：凭据引用名（ref）是**用户可写**的（`apiKeyEnv` 接受任意名字），两家都填
* `DSH_WORK_KEY` 时只按 account 分组会让 A 家的失败显示在 B 家账号下面（2026-10-20 审计）。
* `\u0000` 是不可能出现在 ref 里的分隔符，与台账其它地方同一写法。
* @param record - 台账记录。
* @returns 分组键。
*/
function accountKeyOf(record) {
	return `${record.vendor}\u0000${record.account}`;
}
/**
* 按 **(vendor, account)** 分组统计失败明细。
*
* 键是 `vendor\u0000account`（见 {@link accountKeyOf}）。`account` 为空串时照常出一行
* —— 那是「该厂商但还没选中账号」的失败（选账号之前就失败），丢掉它会让分账号之和与
* 全局 `failuresByKind` 对不上。
* @param records - 台账记录（成功的会被忽略）。
* @returns 分组键 → 明细行（次数降序 → 分类名升序）；没有失败时不返回该键。
*/
function failureBreakdownPerAccount(records) {
	const byAccount = /* @__PURE__ */ new Map();
	for (const record of records) {
		if (record.outcome !== "failure") continue;
		const key = accountKeyOf(record);
		const bucket = byAccount.get(key);
		if (bucket === void 0) byAccount.set(key, [record]);
		else bucket.push(record);
	}
	const out = /* @__PURE__ */ new Map();
	for (const [key, items] of byAccount) out.set(key, failureBreakdownOf(items));
	return out;
}
//#endregion
//#region src/core/usage/billing-period.ts
/** 一小时的毫秒数。 */
const HOUR = 36e5;
/** 各粒度的大致长度（**只用于由 `resetAt` 反推起点**，不用于判定自然边界）。 */
const APPROX_LENGTH = {
	"five-hour": 5 * HOUR,
	day: 24 * HOUR,
	week: 168 * HOUR,
	month: 720 * HOUR
};
/**
* 由额度窗口的 key 推断周期粒度。
* @param windowKey - `QuotaWindow.key`（`fiveHour` / `5h` / `weekly` / `monthlyCredits` …）。
* @returns 粒度；认不出时按月（额度里最粗的那档）。
*/
function periodKindOf(windowKey) {
	const key = windowKey.toLowerCase();
	if (key.includes("5h") || key.includes("fivehour") || key.includes("five-hour") || key.includes("rolling")) return "five-hour";
	if (key.includes("week")) return "week";
	if (key.includes("day") || key.includes("daily")) return "day";
	return "month";
}
/**
* 把时刻截断到自然周期的起点（本地时区，与用户看到的日期一致）。
* @param kind - 粒度。
* @param at - 时刻。
* @returns 起点。
*/
function naturalStart(kind, at) {
	const date = new Date(at);
	if (kind === "five-hour") {
		const bucket = Math.floor(date.getHours() / 5) * 5;
		date.setHours(bucket, 0, 0, 0);
		return date.getTime();
	}
	if (kind === "day") {
		date.setHours(0, 0, 0, 0);
		return date.getTime();
	}
	if (kind === "week") {
		const day = (date.getDay() + 6) % 7;
		date.setHours(0, 0, 0, 0);
		return date.getTime() - day * 24 * HOUR;
	}
	return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}
/** 由起点推终点（自然周期的下一个起点）。 */
function naturalEnd(kind, start) {
	const date = new Date(start);
	if (kind === "five-hour") return start + 5 * HOUR;
	if (kind === "day") return start + 24 * HOUR;
	if (kind === "week") return start + 168 * HOUR;
	return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
}
/** 周期 key：稳定、可排序、可读（本地时区）。 */
function periodKeyOf(kind, start) {
	const date = new Date(start);
	const pad = (value) => String(value).padStart(2, "0");
	const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	if (kind === "five-hour") return `${day}T${pad(date.getHours())}`;
	if (kind === "day") return day;
	if (kind === "week") return `W${day}`;
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}
/**
* 判定某个时刻属于哪个周期。
*
* @param kind - 该账号这一档额度的粒度。
* @param at - 请求发生的时刻。
* @param resetAt - 该额度窗口的重置时间（epoch 毫秒）；未知或缺省时按自然周期。
* @returns 该时刻所在的周期。
*/
function periodAt(kind, at, resetAt) {
	if (resetAt !== void 0 && Number.isFinite(resetAt) && resetAt > 0) {
		const start = resetAt - APPROX_LENGTH[kind];
		if (at >= start && at < resetAt) return {
			kind,
			key: periodKeyOf(kind, start),
			start,
			end: resetAt,
			fromResetAt: true
		};
	}
	const start = naturalStart(kind, at);
	const end = naturalEnd(kind, start);
	const ongoing = at < end;
	return {
		kind,
		key: periodKeyOf(kind, start),
		start,
		end: ongoing ? void 0 : end,
		fromResetAt: false
	};
}
/**
* 把一个时刻按**日历月**前移/后移（月末夹取：1/31 的前一月是 12/31，不会溢出到 3 月）。
* @param at - 基准时刻。
* @param months - 偏移月数（可负）。
* @returns 平移后的时刻。
*/
function addMonths(at, months) {
	const day = new Date(at).getDate();
	const target = new Date(at);
	target.setDate(1);
	target.setMonth(target.getMonth() + months);
	const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
	target.setDate(Math.min(day, lastDay));
	return target.getTime();
}
/**
* **套餐周期**：锚在订阅本期的边界（`periodEnd`，可选 `periodStart`）。
*
* 为什么单独一种：需求 明确要求「按照套餐的有效期进行统计」。订阅是**按月续费**
* 的，它的边界只由厂商给的日期决定 —— 既不是自然月（9 月 20 日订阅，周期就是 20 日到 20 日），
* 也不是额度里最细的那一档（5 小时窗口只说明「最近五小时用了多少」）。
*
* `periodStart` 缺失时由 `periodEnd` 往前推一个日历月（厂商通常只公布终点）。两种情况下
* 起点都属于「按周期推断」，而终点是权威的 —— 界面因此显示成「按厂商重置时间」。
* @param periodEnd - 套餐本期结束时刻（epoch 毫秒）。
* @param at - 要归属的时刻。
* @param periodStart - 套餐本期开始时刻（可选；厂商公布时比推算更准）。
* @returns 该时刻所在的套餐周期；`periodEnd` 不可用时为 `undefined`。
*/
function planPeriodAt(periodEnd, at, periodStart) {
	if (!Number.isFinite(periodEnd) || periodEnd <= 0 || !Number.isFinite(at)) return void 0;
	if (at >= periodEnd) {
		const anchor = periodStart !== void 0 && Number.isFinite(periodStart) && periodStart > 0 && periodStart < periodEnd ? periodStart : addMonths(periodEnd, -1);
		const length = periodEnd - anchor;
		if (length > 0) {
			const start = anchor + Math.min(24, Math.max(1, Math.ceil((at - periodEnd) / length))) * length;
			if (start <= at) return {
				kind: "month",
				key: periodKeyOf("month", start),
				start,
				end: start + length,
				fromResetAt: true
			};
		}
	}
	if (periodStart !== void 0 && Number.isFinite(periodStart) && periodStart > 0 && periodStart < periodEnd) {
		const inside = at >= periodStart && at < periodEnd;
		const length = periodEnd - periodStart;
		if (!inside && at < periodStart) {
			const steps = Math.ceil((periodStart - at) / length);
			if (steps <= 24) {
				const start = periodStart - steps * length;
				return {
					kind: "month",
					key: periodKeyOf("month", start),
					start,
					end: start + length,
					fromResetAt: true
				};
			}
		}
		return {
			kind: "month",
			key: periodKeyOf("month", periodStart),
			start: periodStart,
			end: periodEnd,
			fromResetAt: true
		};
	}
	let end = periodEnd;
	for (let guard = 0; guard < 24; guard += 1) {
		const start = addMonths(end, -1);
		if (at >= start && at < end) return {
			kind: "month",
			key: periodKeyOf("month", start),
			start,
			end,
			fromResetAt: true
		};
		if (at < start) {
			end = start;
			continue;
		}
		return {
			kind: "month",
			key: periodKeyOf("month", start),
			start,
			end,
			fromResetAt: true
		};
	}
}
//#endregion
//#region src/core/usage/pricing.ts
/**
* DeepSeek 官方牌价（2026-10-19 取自 api-docs.deepseek.com/quick_start/pricing）。
*
* 文档区分**峰谷两档**：高峰为 UTC 周一至周五 01:00–04:00 与 06:00–10:00（不含中国
* 法定节假日），其余（含周末与节假日）为低谷；低谷是高峰的一半。
* 这里用**高峰价**折算 —— 折算价值是「最多要花多少」的上界，比用低谷价更诚实的口径；
* 需要精确到时段的话，后续可以按请求时间判定峰谷。
*
* 注意：官方把 `deepseek-flash` 作为模型名（历史名 `deepseek-v4-flash` 仍被接受，
* 按 Flash 计费），Pro 名为 `deepseek-v4-pro`。
*/
const DEEPSEEK_OFFICIAL_PRICES = {
	"deepseek-flash": {
		input: .3,
		cacheRead: .006,
		cacheWrite: .3,
		output: 1.2
	},
	"deepseek-v4-flash": {
		input: .3,
		cacheRead: .006,
		cacheWrite: .3,
		output: 1.2
	},
	"deepseek-v4.1-flash": {
		input: .3,
		cacheRead: .006,
		cacheWrite: .3,
		output: 1.2
	},
	"deepseek-v4-pro": {
		input: 1.32,
		cacheRead: .044,
		cacheWrite: 1.32,
		output: 3.96
	}
};
/**
* 厂商真实价（能确证的才写）。
*
* - **Command Code**：订阅 + credit 制，官方定价页只给「每月多少 credit」与「约多少次
*   请求」，**不公布逐模型 token 单价** → 这里留空。额度接口本身就按美元记账
*   （`quota.ts` 的窗口 `used/cap` 是美元），所以「本周期花了多少钱」可以从额度差直接读，
*   不需要我们从 token 反推。
* - **OpenCode Go**：订阅制（免费档 + 付费档），同样不公布逐 token 价 → 留空。
* - **Open Design**：`vela billing preflight` 直接给美元消耗（`usedCredits`），
*   也不需要 token×单价。
*
* 因此**本表当前是空的**，界面会显示「厂商价未公开」。这不是缺陷：把订阅制的费用
* 硬摊成 token 单价只会给出假数字。等厂商公布逐模型价时，往这里加即可。
*/
const VENDOR_PRICES = {};
/** 规范化模型名用于查表（小写、去空白；保留 `/` 与 `.`）。 */
function normalizeModelId(model) {
	return model.trim().toLowerCase();
}
/**
* 在一个价格表里查模型价。
*
* 依次尝试：完整 id → 最后一段（`deepseek/deepseek-v4.1-flash` → `deepseek-v4.1-flash`）
* → 去掉 `-`/`.` 的简化形式。厂商在不同接口里对同一模型的写法并不一致，写死一种匹配
* 会让「明明有价却显示未知」。
* @param table - 价格表。
* @param model - 模型 id。
* @returns 价格，或 `undefined`。
*/
function lookupPrice(table, model) {
	if (table === void 0) return void 0;
	const id = normalizeModelId(model);
	if (id === "") return void 0;
	const direct = table[id];
	if (direct !== void 0) return direct;
	const tail = id.slice(id.lastIndexOf("/") + 1);
	if (tail !== id && table[tail] !== void 0) return table[tail];
	const loose = (value) => value.replace(/[-.]/gu, "");
	const wanted = loose(tail);
	for (const [key, price] of Object.entries(table)) if (loose(key) === wanted) return price;
}
/** 取 DeepSeek 官方价。 */
function officialPriceOf(model) {
	return lookupPrice(DEEPSEEK_OFFICIAL_PRICES, model);
}
/** 取某个厂商的真实价。 */
function vendorPriceOf(vendor) {
	const table = VENDOR_PRICES[vendor];
	return (model) => lookupPrice(table, model);
}
//#endregion
//#region src/core/usage/stats.ts
/**
* 把一份 `TokenUsage` 归一成 {@link TokenCounts}，缺字段按 0（**只在这里**允许补 0：
* 统计口径需要可加的基准，而「这个字段厂商没报」与「这次用了 0 个」在聚合里等价）。
* @param usage - 宿主或 adapter 给的用量（可能缺字段）。
* @returns 四个计数。
*/
function countsOf(usage) {
	const pick = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
	return {
		inputTokens: pick(usage?.inputTokens),
		outputTokens: pick(usage?.outputTokens),
		cacheReadTokens: pick(usage?.cacheReadTokens),
		cacheWriteTokens: pick(usage?.cacheWriteTokens)
	};
}
/**
* 按价格表算一次成本（美元）。
* @param counts - token 计数。
* @param price - 每百万 token 的单价；`undefined` 表示没有该模型的价格。
* @returns 美元金额；没有价格时为 `undefined`（**绝不返回 0 冒充「免费」**）。
*/
function costOf(counts, price) {
	if (price === void 0) return void 0;
	return (counts.inputTokens * price.input + counts.cacheReadTokens * price.cacheRead + counts.cacheWriteTokens * price.cacheWrite + counts.outputTokens * price.output) / 1e6;
}
/** 把若干计数累加进一个累加器（就地修改，纯计算）。 */
function addInto(target, counts) {
	target.inputTokens += counts.inputTokens;
	target.outputTokens += counts.outputTokens;
	target.cacheReadTokens += counts.cacheReadTokens;
	target.cacheWriteTokens += counts.cacheWriteTokens;
}
/**
* 聚合一批记录。
*
* @param records - 已按需要裁好的记录（窗口过滤由调用方做）。
* @param period - 周期标识，写进结果。
* @param since - 周期起点（epoch 毫秒）。
* @param priceOf - 取某个模型的厂商价；没有则返回 `undefined`。
* @param officialPriceOf - 取某个模型的 DeepSeek 官方价；没有则返回 `undefined`。
* @returns 聚合结果；`records` 为空时各项计数为 0、比率与成本为 `undefined`。
*/
function aggregateUsage(records, period, since, priceOf, officialPriceOf) {
	const totals = countsOf();
	let requests = 0;
	let ok = 0;
	let vendorCost;
	let officialCost;
	/** 有多少条记录**没有**对应价格（决定上面的金额是不是部分和）。 */
	let vendorMissing = 0;
	let officialMissing = 0;
	for (const record of records) {
		const counts = countsOf(record);
		addInto(totals, counts);
		requests += 1;
		if (record.outcome === "success") ok += 1;
		const vendor = costOf(counts, priceOf(record.model));
		if (vendor !== void 0) vendorCost = (vendorCost ?? 0) + vendor;
		else vendorMissing += 1;
		const official = costOf(counts, officialPriceOf(record.model));
		if (official !== void 0) officialCost = (officialCost ?? 0) + official;
		else officialMissing += 1;
	}
	const failed = requests - ok;
	const promptTokens = totals.cacheReadTokens + totals.inputTokens;
	const partialOf = (total, missing) => total !== void 0 && missing > 0 ? true : void 0;
	return {
		period,
		since,
		...totals,
		requests,
		ok,
		failed,
		successRate: requests === 0 ? void 0 : ok / requests,
		cacheHitRate: promptTokens === 0 ? void 0 : totals.cacheReadTokens / promptTokens,
		vendorCost,
		officialCost,
		...partialOf(vendorCost, vendorMissing) === void 0 ? {} : { vendorCostPartial: true },
		...partialOf(officialCost, officialMissing) === void 0 ? {} : { officialCostPartial: true }
	};
}
/** 一次窗口裁切的起点（epoch 毫秒）；`all` 返回 `undefined`。 */
function windowStart(window, now) {
	if (window === "all") return void 0;
	const day = 864e5;
	if (window === "today") {
		const start = new Date(now);
		start.setHours(0, 0, 0, 0);
		return start.getTime();
	}
	if (window === "7d") return now - 7 * day;
	return now - 30 * day;
}
/**
* 按窗口裁记录。
* @param records - 全部记录。
* @param window - 窗口。
* @param now - 「现在」（注入，便于测试）。
* @returns 落在窗口内的记录。
*/
function withinWindow(records, window, now) {
	const start = windowStart(window, now);
	if (start === void 0) return [...records];
	return records.filter((record) => record.at >= start);
}
//#endregion
//#region src/core/usage/report.ts
/**
* 用量统计的**查询层**：把台账里的记录整理成界面要的形状。
*
* 界面的要求（需求）：「每个账号只统计自己的记账周期，然后单独有一个总的记录」。
* 于是这里产出两块：
* 1. {@link AccountUsage}：每个账号一条，按**它自己的周期**聚合；
* 2. {@link TotalUsage}：跨账号的总账，按用户选的时间窗口聚合。
*
* 周期与窗口是**两件不同的事**，不要混：周期回答「这个账号本周期用了多少」，窗口回答
* 「最近 N 天我一共用了多少」。两者各有各的比率与成本，分别算。
* @module dsh-llm-account/src/core/usage-report
*/
/**
* 生成报表。
* @param query - 见 {@link UsageQuery}。
* @returns 每账号明细 + 总账。
*/
function buildUsageReport(query) {
	const { records, window, now } = query;
	const priceOf = (vendor) => vendorPriceOf(vendor);
	const official = (model) => officialPriceOf(model);
	const groups = /* @__PURE__ */ new Map();
	for (const record of records) {
		const key = `${record.vendor}\u0000${record.account}`;
		const existing = groups.get(key);
		if (existing === void 0) groups.set(key, {
			vendor: record.vendor,
			account: record.account,
			items: [record]
		});
		else existing.items.push(record);
	}
	const accounts = [];
	for (const group of groups.values()) {
		const planEnd = query.planPeriodEndOf?.(group.vendor, group.account);
		const planStart = query.planPeriodStartOf?.(group.vendor, group.account);
		const windowKey = query.periodWindowOf?.(group.vendor, group.account);
		const kind = periodKindOf(windowKey ?? "monthly");
		const resetAt = query.resetAtOf?.(group.vendor, group.account);
		const period = (planEnd === void 0 ? void 0 : planPeriodAt(planEnd, now, planStart)) ?? periodAt(kind, now, resetAt);
		const inPeriod = group.items.filter((record) => record.at >= period.start && (period.end === void 0 || record.at < period.end));
		const bucket = aggregateUsage(inPeriod, period.key, period.start, priceOf(group.vendor), official);
		const windowed = aggregateUsage(withinWindow(group.items, window, now), window, startOf(window, now), priceOf(group.vendor), official);
		const spent = query.spentOf?.(group.vendor, group.account);
		const lastAt = inPeriod.reduce((latest, record) => latest === void 0 || record.at > latest ? record.at : latest, void 0);
		accounts.push({
			vendor: group.vendor,
			account: group.account,
			period,
			bucket,
			windowed,
			...spent === void 0 ? {} : {
				spent: spent.amount,
				spentWindow: spent.window
			},
			...bucket.officialCost === void 0 ? {} : { localSpent: bucket.officialCost },
			...lastAt === void 0 ? {} : { lastAt }
		});
	}
	accounts.sort((left, right) => left.vendor.localeCompare(right.vendor) || left.account.localeCompare(right.account));
	const windowRecords = withinWindow(records, window, now);
	const lastAt = windowRecords.reduce((latest, record) => latest === void 0 || record.at > latest ? record.at : latest, void 0);
	const total = {
		window,
		bucket: aggregateUsage(windowRecords, window, startOf(window, now), () => void 0, official),
		byVendor: [],
		...lastAt === void 0 ? {} : { lastAt }
	};
	const vendors = /* @__PURE__ */ new Map();
	for (const record of windowRecords) {
		const list = vendors.get(record.vendor);
		if (list === void 0) vendors.set(record.vendor, [record]);
		else list.push(record);
	}
	for (const [vendor, items] of [...vendors.entries()].sort((left, right) => left[0].localeCompare(right[0]))) total.byVendor.push({
		vendor,
		bucket: aggregateUsage(items, window, startOf(window, now), priceOf(vendor), official)
	});
	return {
		accounts,
		total
	};
}
/** 窗口的起点（`all` 用 0）。 */
function startOf(window, now) {
	return windowStart(window, now) ?? 0;
}
//#endregion
//#region src/core/usage/ledger.ts
/**
* 用量采集：**把每次请求记下来**，按账号落盘，进程重启后继续累计。
*
* 三条设计约束（都是踩过的坑）：
* 1. **不能阻塞请求**。记录是旁路：`record()` 只做内存追加与异步落盘，adapter 的
*    流式输出不等它。
* 2. **失败也要记**。成功率的分母是「尝试过的请求」；只记成功会让成功率永远是 100%。
* 3. **落盘要能自愈**。文件损坏/半截写入时丢弃坏行、保留好行，绝不让统计把插件带崩。
*
* 存储形态：JSON Lines，一天一个文件（`usage-YYYY-MM-DD.jsonl`）。读取时**按文件名
* 预筛**——选「今日」只读今天那一个文件，不必把 120 天全扫一遍。
* @module dsh-llm-account/src/core/usage-ledger
*/
/** 一天一条文件（`usage-2026-10-19.jsonl`），避免单文件无限增长。 */
function fileNameOf(at) {
	const date = new Date(at);
	const pad = (value) => String(value).padStart(2, "0");
	return `usage-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.jsonl`;
}
/**
* 从文件名取出它覆盖的那一天起点（本地时区，与 {@link fileNameOf} 一致）。
* @param name - 文件名。
* @returns 当天零点（epoch 毫秒）；名字不合规时为 `undefined`。
*/
function dayOfFile(name) {
	const match = /^usage-(\d{4})-(\d{2})-(\d{2})\.jsonl$/u.exec(name);
	if (match === null) return void 0;
	const [, year, month, day] = match;
	const date = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
	return Number.isNaN(date.getTime()) ? void 0 : date.getTime();
}
/**
* 把一行文本解析成记录。
* @param line - 一行 JSONL。
* @returns 记录，或 `undefined`（空行/坏行）。
*/
function parseLine(line) {
	const text = line.trim();
	if (text === "") return void 0;
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof raw !== "object" || raw === null) return void 0;
	const row = raw;
	const numberOr0 = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
	const at = numberOr0(row["at"]);
	const vendor = typeof row["vendor"] === "string" ? row["vendor"] : "";
	if (at === 0 || vendor === "") return void 0;
	const outcome = row["outcome"] === "success" ? "success" : "failure";
	const record = {
		vendor,
		account: typeof row["account"] === "string" ? row["account"] : "",
		at,
		outcome,
		inputTokens: numberOr0(row["inputTokens"]),
		outputTokens: numberOr0(row["outputTokens"]),
		cacheReadTokens: numberOr0(row["cacheReadTokens"]),
		cacheWriteTokens: numberOr0(row["cacheWriteTokens"]),
		model: typeof row["model"] === "string" ? row["model"] : ""
	};
	const failureKind = row["failureKind"];
	if (typeof failureKind === "string" && failureKind !== "") record.failureKind = failureKind;
	return record;
}
/**
* 读台账里的记录。
*
* 两级筛选：
* 1. 先按**文件名**筛掉不可能有命中的日期（「切到今日」从 120 个文件降到 1 个）；
* 2. 再按文件 `mtime + size` 判断要不要真的读盘解析（没变就用缓存）。
* @param directory - 存放目录。
* @param now - 时钟（测试注入）。
* @param range - 时间范围。
* @param cache - 跨调用保留的解析缓存（按文件名索引）。
* @param counters - 读盘/命中计数（测试与审计用）。
* @returns 记录（按时间升序）。
*/
async function readRecords(directory, now, range = {}, cache = /* @__PURE__ */ new Map(), counters = {
	fileReads: 0,
	cacheHits: 0
}) {
	let names;
	try {
		names = await readdir(directory);
	} catch {
		return [];
	}
	const retentionCutoff = now() - 10368e6;
	const since = range.since === void 0 ? retentionCutoff : Math.max(range.since, retentionCutoff);
	const until = range.until;
	const dayStartOf = (at) => {
		const date = new Date(at);
		date.setHours(0, 0, 0, 0);
		return date.getTime();
	};
	const firstDay = dayStartOf(since);
	const lastDay = until === void 0 ? void 0 : dayStartOf(until);
	const files = names.filter((name) => dayOfFile(name) !== void 0).filter((name) => {
		const day = dayOfFile(name);
		if (day < firstDay) return false;
		if (lastDay !== void 0 && day > lastDay) return false;
		return true;
	}).sort().slice(-120);
	const records = [];
	for (const name of files) {
		const file = join(directory, name);
		let stamp;
		try {
			const info = await stat(file);
			stamp = {
				mtimeMs: info.mtimeMs,
				size: info.size
			};
		} catch {
			cache.delete(name);
			continue;
		}
		const cached = cache.get(name);
		if (cached !== void 0 && cached.mtimeMs === stamp.mtimeMs && cached.size === stamp.size) {
			counters.cacheHits += 1;
			for (const record of cached.records) {
				if (record.at < since) continue;
				if (until !== void 0 && record.at > until) continue;
				records.push(record);
			}
			continue;
		}
		let text;
		try {
			counters.fileReads += 1;
			text = await readFile(file, "utf8");
		} catch {
			cache.delete(name);
			continue;
		}
		const parsed = [];
		for (const line of text.split("\n")) {
			const record = parseLine(line);
			if (record === void 0) continue;
			parsed.push(record);
		}
		cache.set(name, {
			...stamp,
			records: parsed
		});
		for (const record of parsed) {
			if (record.at < since) continue;
			if (until !== void 0 && record.at > until) continue;
			records.push(record);
		}
	}
	records.sort((left, right) => left.at - right.at);
	return records;
}
/**
* 造一个台账。
*
* @param directory - 存放目录（宿主侧一个插件私有目录）。
* @param now - 时钟注入（测试用）。
* @returns 台账句柄。
*/
function createUsageLedger(directory, now = Date.now) {
	/** 写队列：保证同一进程内追加是有序的（否则 JSONL 会交错成坏行）。 */
	let writeChain = Promise.resolve();
	let ready;
	/**
	* 解析缓存（按文件名）。句柄级而不是模块级：不同目录/不同注入时钟的实例互不干扰，
	* 测试也不会互相污染。
	*/
	const cache = /* @__PURE__ */ new Map();
	/** 读盘 / 缓存命中计数（`stats()` 暴露给测试与审计）。 */
	const counters = {
		fileReads: 0,
		cacheHits: 0
	};
	/**
	* 台账目录与文件的权限位（2026-11-12 审查 A10）。
	*
	* ## 为什么需要显式权位
	*
	* 台账里有 vendor、账号 ref、模型、token 数与时间戳 —— 不含 prompt、不含密钥，
	* 但它仍然是**用量行为画像**。旧代码只写 `mkdir(dir, { recursive: true })` 与
	* `appendFile(path, line, "utf8")`，权限完全取决于进程 umask：在 umask 022 的机器上
	* 目录会是 0755（同机其他用户可读）、文件 0644。
	*
	* 显式设成 0700 / 0600 让「只有本用户能读」成为**代码里的契约**，而不是运气。
	*
	* ## 为什么在 Windows 上无害
	*
	* Windows 没有 POSIX 权限位；`mode` 会被 Node 忽略（目录仍走继承的 ACL）。
	* 那一侧的隔离由系统 ACL 负责 —— 但传它不会报错，也不需要平台分支。
	*/
	const ensureDirectory = async () => {
		ready ??= mkdir(directory, {
			recursive: true,
			mode: 448
		}).then(() => void 0);
		await ready;
	};
	const pathOf = (at) => join(directory, fileNameOf(at));
	return {
		async record(input) {
			const at = input.at ?? now();
			const record = {
				vendor: input.vendor,
				account: input.account,
				at,
				outcome: input.outcome,
				inputTokens: input.inputTokens ?? 0,
				outputTokens: input.outputTokens ?? 0,
				cacheReadTokens: input.cacheReadTokens ?? 0,
				cacheWriteTokens: input.cacheWriteTokens ?? 0,
				model: input.model ?? "",
				...input.failureKind === void 0 ? {} : { failureKind: input.failureKind }
			};
			const line = `${JSON.stringify(record)}\n`;
			writeChain = writeChain.then(async () => {
				await ensureDirectory();
				await appendFile(pathOf(at), line, {
					encoding: "utf8",
					mode: 384
				});
			}).catch((error) => {
				console.warn("[dsh-llm-account] could not append the usage ledger:", error);
			});
			await writeChain;
		},
		async read(range) {
			await ensureDirectory().catch(() => void 0);
			return readRecords(directory, now, range ?? {}, cache, counters);
		},
		stats() {
			return {
				fileReads: counters.fileReads,
				cacheHits: counters.cacheHits
			};
		},
		async clear() {
			writeChain = writeChain.then(async () => {
				await ensureDirectory();
				let names;
				try {
					names = await readdir(directory);
				} catch {
					return;
				}
				const targets = names.filter((name) => dayOfFile(name) !== void 0).sort().slice(-120);
				for (const name of targets) await writeFile(join(directory, name), "", {
					encoding: "utf8",
					mode: 384
				});
				if (targets.length === 0) await writeFile(pathOf(now()), "", {
					encoding: "utf8",
					mode: 384
				});
				cache.clear();
			});
			await writeChain;
		}
	};
}
/** 台账文件的目录名（相对插件私有目录）。 */
const USAGE_DIR_NAME = "usage";
//#endregion
//#region src/vendors/usage-store.ts
/**
* 用量采集的**宿主侧单例**：三条 provider 行共用一本台账。
*
* 为什么是模块级单例而不是每行一个：三个 `apply` 在同一个 node 进程里跑（同一个 bundle
* 模块实例），而「总账」必须跨厂商、跨账号 —— 每行各写一本账就没法合计，也会把同一个
* 数据目录写坏。这里仿照客户端 `sharedUsage` 的做法：第一次用的人定下目录，之后共用。
* @module dsh-llm-account/src/vendors/usage-store
*/
/** 单例台账。 */
let sharedLedger;
/** 覆盖数据目录的环境变量名。 */
const USAGE_DIR_ENV = "DSH_LLM_ACCOUNT_USAGE_DIR";
/**
* 用量数据的根目录。
*
* 放 `~/.dsh/llm-account/usage`：与宿主其它插件的用户级状态同处一地（`~/.dsh`），
* 但用插件自己的子目录，不与宿主的 `cache/` `logs/` 混在一起。
*
* **环境变量优先**（{@link USAGE_DIR_ENV}）：测试跑 `apply()` 时会走到这里，而 `apply()` 造
* 的采集端口**就是生产端口** —— 没有这个开关，整套测试会把假记录（`m1` 模型、`PREFERRED_REF`
* 账号）写进用户真实台账。2026-10-19 实测：831 条记录里 638 条是测试垃圾，把「总量」抬成
* 一个纯属虚构的数。`vitest.config.ts` 的 setup 文件把它指到临时目录。
* @returns 目录路径。
*/
function defaultUsageRoot() {
	const override = process.env[USAGE_DIR_ENV];
	if (typeof override === "string" && override.trim() !== "") return override;
	return join(homedir(), ".dsh", "llm-account", USAGE_DIR_NAME);
}
/**
* 取（或首次创建）共享台账。
* @param directory - 存放目录；首次调用时生效，之后忽略（保证只有一本账）。
* @returns 台账。
*/
function sharedUsageLedger(directory = defaultUsageRoot()) {
	sharedLedger ??= createUsageLedger(directory);
	return sharedLedger;
}
/**
* 造一个写共享台账的采集端口。
*
* 端口必须**同步返回、不抛错**：adapter 在流式路径上调用它，任何抛出都会变成请求失败。
* `record()` 内部把落盘 Promise 交给台账自己的写队列，这里只负责不 await。
* @param ledger - 台账；缺省用共享单例。
* @returns 采集端口。
*/
function createUsagePort(ledger = sharedUsageLedger()) {
	return { record(sample) {
		try {
			ledger.record({
				vendor: sample.vendor,
				account: sample.account,
				outcome: sample.outcome,
				...sample.model === void 0 ? {} : { model: sample.model },
				...sample.inputTokens === void 0 ? {} : { inputTokens: sample.inputTokens },
				...sample.outputTokens === void 0 ? {} : { outputTokens: sample.outputTokens },
				...sample.cacheReadTokens === void 0 ? {} : { cacheReadTokens: sample.cacheReadTokens },
				...sample.cacheWriteTokens === void 0 ? {} : { cacheWriteTokens: sample.cacheWriteTokens },
				...sample.failureKind === void 0 ? {} : { failureKind: sample.failureKind }
			});
		} catch (error) {
			console.warn("[dsh-llm-account] could not queue the usage sample:", error);
		}
	} };
}
//#endregion
//#region src/vendors/usage-remote.ts
/**
* 由窗口算出读台账的下界。
*
* 为什么不是只按窗口：报表同时给「账号本周期」与「当前窗口」两套聚合，而周期可能比窗口
* 更长（例如窗口选「今日」、账号周期是按月的），所以下界要取两者更早的那个 —— 否则周期
* 那半边会缺数据。
* @param window - 时间窗口。
* @param now - 现在。
* @returns 读范围。
*/
function readRangeFor(window, now) {
	const periodFloor = now - 3456e6;
	const windowFloor = windowStartOf(window, now);
	if (window === "all") return {};
	return { since: windowFloor === void 0 ? periodFloor : Math.min(windowFloor, periodFloor) };
}
/** 窗口起点（`all` 无下界）。 */
function windowStartOf(window, now) {
	if (window === "all") return void 0;
	if (window === "today") {
		const start = new Date(now);
		start.setHours(0, 0, 0, 0);
		return start.getTime();
	}
	return now - (window === "7d" ? 7 : 30) * 864e5;
}
/**
* 额度窗口的「精细度」排序：数字越小越细。
*
* 用来挑出「本周期」该按哪一档算：5 小时窗口比周/月更能反映最近用了多少。
* @param key - `QuotaWindow.key`。
* @returns 排序权重。
*/
function rankOfWindow(key) {
	const lower = key.toLowerCase();
	if (lower.includes("5h") || lower.includes("fivehour") || lower.includes("rolling")) return 0;
	if (lower.includes("day")) return 1;
	if (lower.includes("week")) return 2;
	return 3;
}
/**
* 判定「能挂属性的宿主对象」：cordis 的 `Service` 对外是**可调用代理**（`typeof` 是 `"function"`），
* 所以只认 `typeof === "object"` 会漏掉服务实例 —— 那会让第二行以为服务不存在，从而重复构造。
*/
function isServiceLike(value) {
	return (typeof value === "object" || typeof value === "function") && value !== null;
}
/** 错误对象到一行文案（不泄漏对象结构，也不把 `undefined` 打成空白）。 */
function messageOf$1(error) {
	return error instanceof Error ? error.message : String(error);
}
/** 往宿主日志里留一行警告（形式残缺的 ctx 上静默跳过 —— 日志不是本模块的硬依赖）。 */
function warnOn(ctx, message) {
	ctx.logger?.warn?.(message);
}
/**
* 账号中心的远程服务。
*
* 方法名必须与描述符里的 `method` 一致：`invocation: { kind: "direct" }` 就是按名字在实例上
* 派发的。三个方法都要求显式给出厂商 —— 页面一次只渲染一家的标签页（规格 §8），没有默认值
* 比猜一个默认厂商安全。
*
* **不要在本类里用 `#` 私有成员**（字段与方法都不行）：cordis 的 `Service` 实例对外是**代理**，
* `ctx.get(key)` 拿到的是代理而不是原对象，访问 `#` 私有成员会抛
* `TypeError: Receiver must be an instance of class …`（实测）。TS 的 `private` 是编译期的、
* 不经过代理机制，所以本类一律用它。旧插件同样只用普通字段（`deps`），不是巧合。
*/
var LlmAccountUsageService = class LlmAccountUsageService extends TypertRemoteService {
	vendorDeps = /* @__PURE__ */ new Map();
	/**
	* 额度窗口快照的**短期缓存**（2026-10-30 修 P1-P01）。
	*
	* ## 为什么需要
	*
	* 设置页每 30 秒刷一次 `usageReport()`。而那个报表同时会去问**每家、每个已配置
	* 账号**的实时额度 —— 只为拿到「周期窗口的起止时刻」来定位统计口径。账号一多，
	* 30 秒一次的代价就是成倍的上游 HTTP。
	*
	* 报表本身的**数据源是本地用量台账**（`sharedUsageLedger()`），额度只用来选窗口。
	* 窗口边界（5 小时 / 周 / 套餐期）**不会在 30 秒内变化**，所以按账号缓存一小段
	* 时间完全不影响正确性。
	*
	* ## 语义约束
	*
	* - 缓存**只影响报表的口径选择**，不影响账号卡片/侧边栏的实时额度展示（那些走
	*   `status()` 本身，不经过这里）；
	* - TTL 到点后重新读；读失败**保留上一次的值**（口径沿用上次已知的窗口比退回自然
	*   周期更稳）；
	* - **账号集合/凭据变化立即失效**（见 `invalidateWindowHints`）。
	*/
	quotaWindowCache = /* @__PURE__ */ new Map();
	/**
	* 额度窗口缓存的有效期（毫秒）。
	*
	* 取 60 秒：设置页 30 秒刷一次，于是最多「每两次刷新打一轮上游」，且窗口边界
	* （最小是 5 小时）在这段时间里不太可能变。
	*
	* **但「不太可能」不是「不可能」**：重置点恰好落在未来几十秒内时，`resetAt` 与本期
	* 金额都会变。所以下面 `quotaWindowHintsOf` 还会按「最近的窗口到期时刻」缩短 TTL
	* （第七轮复审 BUG-02）。
	*/
	static QUOTA_WINDOW_TTL_MS = 6e4;
	/**
	* 每个厂商的**缓存代际**（第八轮复审 BUG-01：在途请求竞态）。
	*
	* ## 为什么光删缓存不够
	*
	* 失效原来只是 `Map.delete`。但如果此时**正有一个读取在途**：
	*
	* ```
	* T0  报表调用 → 缓存 miss → 开始 await status(vendor)（要点几秒）
	* T1  用户新增账号 → invalidateWindowHints() 删掉缓存
	* T2  T0 那个请求返回 → **把不含新账号的旧结果写回缓存**
	* ```
	*
	* 用户的账号变更被旧请求覆盖，又要等 60 秒。所以写入前必须确认「我还是最新那代」。
	*
	* 每次失效把该厂商的代际 +1；读取开始时记下当时的代际，写回时若已变化就丢弃。
	*/
	quotaCacheGeneration = /* @__PURE__ */ new Map();
	/**
	* 让某厂商的额度窗口缓存失效。
	*
	* ## 为什么需要（第七轮复审 BUG-01）
	*
	* 缓存原来只按 `vendor` 做键、**只在 TTL 到点时**才更新。于是：
	*
	* - 新增账号 B → 60 秒内报表仍用旧账号清单，**B 不出现**；
	* - 删除账号 A → A 仍留在 `known` 集合与「最近使用账号」判断里；
	* - 同 ref 换密钥 → 仍显示用旧密钥读到的金额。
	*
	* 这些都是**账号生命期事件**，缓存必须立刻作废，不能等 TTL。
	*
	* 同时**递增代际**，让在途请求返回后不会把旧值写回来（见
	* {@link quotaCacheGeneration}）。
	* @param vendor - 要失效的厂商；缺省清空全部（厂商卸载/重挂时用）。
	*/
	invalidateWindowHints(vendor) {
		if (vendor === void 0) {
			this.quotaWindowCache.clear();
			for (const [key, generation] of this.quotaCacheGeneration) this.quotaCacheGeneration.set(key, generation + 1);
			return;
		}
		this.quotaWindowCache.delete(vendor);
		this.quotaCacheGeneration.set(vendor, (this.quotaCacheGeneration.get(vendor) ?? 0) + 1);
	}
	/**
	* @param ctx - 拥有本服务的 cordis 上下文（基类会用 `serviceKey` 注册自己并盖上 typert 绑定）。
	*/
	constructor(ctx) {
		super(ctx, USAGE_SERVICE_KEY, { namespace: USAGE_NAMESPACE });
	}
	/**
	* 登记（或更新）一个厂商的读口。两个 profile 行各调一次。
	* @param deps - 该厂商的账号/额度/轮换读口。
	*/
	registerVendor(deps) {
		this.vendorDeps.set(deps.vendor, deps);
	}
	/**
	* 摘掉一个厂商的读口（该 profile 行卸载时调用）。
	*
	* 服务本身住在根上下文（两个行共享），比任何一行都长命；行走了就必须把自己的读口带走，
	* 否则远程面会拿着指向已释放端口的陈旧条目继续回答。
	* @param vendor - 要摘掉的厂商 id。
	*/
	unregisterVendor(vendor) {
		this.vendorDeps.delete(vendor);
	}
	/**
	* 一家厂商的完整状态：生效账号、固定账号、逐账号的拒绝与额度摘要。
	* @param vendor - 厂商 id。
	* @returns 状态；额度读不出来时只在 `failures` 里体现。
	*/
	async status(vendor) {
		const deps = this.requireVendor(vendor);
		const engine = deps.rotation.current();
		const views = await deps.accounts.list();
		const effective = engine.effectiveAccount();
		const pinned = deps.pinnedRef();
		const rejections = engine.rejections();
		const failures = [];
		const quotas = /* @__PURE__ */ new Map();
		/**
		* **额度整体没读到的账号**（超时、端口抛错）。
		*
		* 与厂商级 `failures` 分开记：`failures` 是「界面要显示的那行原因」，而这个是
		* 「这份数据缺了哪个账号」—— 客户端据它把「一个账号坏了」与「整家坏了」区分开
		* （见 2026-11-10 修的问题 ③）。
		*/
		const unread = /* @__PURE__ */ new Set();
		/**
		* **并发上限**（第七轮复审 PERF-01）。
		*
		* 原来是无限制 `Promise.all` —— 10 个账号就是 10 个额度读取同时在途，
		* 每个账号内部还会再并发 3-4 个端点。账号多时既容易撞上游限流，也让超时窗口
		* 更容易叠在一起。
		*
		* 4 是保守值：常见配置是 1-3 个账号，正常情况跑不满；账号多时把突发压下来。
		* 不改成串行 —— 那会让延迟随账号数线性增长。
		*/
		const configuredViews = views.filter((view) => view.configured);
		const CONCURRENCY = 4;
		/** 一个简单的「最多 n 个同时在跑」的池。 */
		let cursor = 0;
		const workers = Array.from({ length: Math.min(CONCURRENCY, configuredViews.length) }, async () => {
			for (;;) {
				const index = cursor;
				cursor += 1;
				const view = configuredViews[index];
				if (view === void 0) return;
				try {
					quotas.set(view.ref, quotaSummaryOf(await quotaWithTimeout(deps.quota, view.ref)));
				} catch (error) {
					failures.push(`quota: ${vendor} "${view.label}" read failed (${messageOf$1(error)})`);
					unread.add(view.ref);
				}
			}
		});
		await Promise.all(workers);
		const accounts = views.map((view) => {
			const rejection = rejections.get(view.ref);
			return {
				...view,
				effective: effective !== void 0 && view.ref === effective.ref,
				...rejection === void 0 ? {} : { rejection: {
					kind: rejection.kind,
					...rejection.resetAt === void 0 ? {} : { until: rejection.resetAt }
				} },
				...quotas.has(view.ref) ? { quota: quotas.get(view.ref) } : {}
			};
		});
		const latestSwitch = engine.switchNotice();
		return {
			vendor,
			capabilities: deps.capabilities,
			pinned,
			...effective === void 0 ? {} : { effective },
			...latestSwitch === void 0 ? {} : { switch: latestSwitch },
			...deps.switchState === void 0 ? {} : { switchState: deps.switchState() },
			...deps.accountOrder === void 0 ? {} : { accountOrder: [...deps.accountOrder()] },
			...deps.modelRules === void 0 ? {} : { modelRules: deps.modelRules().map((rule) => ({
				...rule,
				models: [...rule.models]
			})) },
			accounts,
			failures,
			...unread.size === 0 ? {} : { quotaUnread: [...unread] }
		};
	}
	/**
	* 账号行（页面账户卡片与仪表盘的列表数据源）。
	* @param vendor - 厂商 id。
	* @returns 账号行，顺序即轮换顺序。
	*/
	async accounts(vendor) {
		return this.requireVendor(vendor).accounts.list();
	}
	/**
	* 未过滤的模型目录（设置页的勾选列表）。
	*
	* 与宿主 `listModels` 的分工：那个已经按可见性过滤；这个回答「厂商现在有哪些模型」，
	* 隐藏的模型也要在这里出现，用户才有入口重新勾上。读取失败不抛（页面要显示原因与重试）。
	* @param vendor - 厂商 id。
	* @returns 目录与失败项。
	*/
	async models(vendor) {
		const deps = this.requireVendor(vendor);
		if (deps.models === void 0) return {
			models: [],
			failures: [`models: ${vendor} does not expose a model catalog`]
		};
		try {
			return {
				models: await deps.models(),
				failures: []
			};
		} catch (error) {
			return {
				models: [],
				failures: [`models: ${vendor} catalog read failed (${messageOf$1(error)})`]
			};
		}
	}
	/**
	* 切换记录，**最新在前**（仪表盘的切换记录区；每条都带厂商标签）。
	* @param vendor - 厂商 id。
	* @returns 切换记录数组。
	*/
	async switches(vendor) {
		return this.requireVendor(vendor).rotation.current().switchNotices().map((notice) => ({
			...notice,
			vendor
		}));
	}
	/**
	* 磁盘上**当前安装版本**（读 `package.json` 的 `version`）。
	*
	* 用途：客户端 bundle 里有构建期注入的版本号（= 页面加载时的版本）。两者不一致
	* 说明插件已被更新、但页面里跑的还是旧代码 —— 那时应当提示用户刷新页面，而不是
	* 让他重启程序。
	*
	* **为什么不缓存**：这个值正是「磁盘变了」的探针，缓存会让它永远报旧值。
	* 读一次文件很便宜（几 KB），而且只在页面加载与更新完成后调用。
	* @returns 版本字符串；读不到时抛错（调用方据此不提示，而不是猜）。
	*/
	async installedVersion() {
		const here = new URL(import.meta.url);
		const manifest = new URL("../package.json", here);
		const raw = await readFile(manifest, "utf8");
		const parsed = JSON.parse(raw);
		const version = typeof parsed === "object" && parsed !== null ? parsed.version : void 0;
		if (typeof version !== "string" || version.trim() === "") throw new Error("package.json has no version field");
		return version.trim();
	}
	/**
	* 追加一个账号。有密钥时同时写入凭据服务（ref 由账号端口按标签分配一个**空闲**槽）。
	* @param vendor - 厂商 id。
	* @param input - 展示名称与可选密钥。
	* @returns 新账号的视图。
	*/
	async addAccount(vendor, input) {
		const added = await this.requireVendor(vendor).accounts.add(input);
		this.invalidateWindowHints(vendor);
		return added;
	}
	/**
	* 只改展示名称（ref 是身份键，永不重推）。
	* @param vendor - 厂商 id。
	* @param ref - 目标账号。
	* @param label - 新名称。
	*/
	async renameAccount(vendor, ref, label) {
		await this.requireVendor(vendor).accounts.rename(ref, label);
	}
	/**
	* 把账号名恢复成登录时的默认名（2026-10-22）。
	*
	* 默认名住在**账号条目**里（`defaultName` 字段），所以由厂商端口自己查、自己写 ——
	* 客户端传来的只是「点的是哪个账号」，不是一个可能已过期的名字。这样「默认名」只有
	* 一处真相。
	*
	* 没实现这个能力（或该账号没有记录默认名）时**报错**而不是静默：界面本来就不会显示
	* 那个入口，能走到这里说明是直接调的远程方法，静默失败会让它以为成功了。
	* @param vendor - 厂商 id。
	* @param ref - 目标账号。
	*/
	async restoreAccountName(vendor, ref) {
		const port = this.requireVendor(vendor).accounts;
		if (typeof port.restoreDefaultLabel !== "function") throw new Error(`dsh-llm-account: vendor "${vendor}" does not support restoring the default account name`);
		await port.restoreDefaultLabel.call(port, ref);
	}
	/**
	* 换密钥。
	*
	* 密钥只交给账号端口，端口只写凭据服务 —— **不经过设置文档**（全局约束）。这里不做日志输出，
	* 也不把它放进任何返回值。
	* @param vendor - 厂商 id。
	* @param ref - 目标账号。
	* @param key - 新密钥。
	*/
	async replaceKey(vendor, ref, key) {
		await this.requireVendor(vendor).accounts.replaceKey(ref, key);
		this.invalidateWindowHints(vendor);
	}
	/**
	* 移除账号（凭据的实际清理由账号端口按各厂商语义处理）。
	* @param vendor - 厂商 id。
	* @param ref - 目标账号。
	*/
	async removeAccount(vendor, ref) {
		await this.requireVendor(vendor).accounts.remove(ref);
		this.invalidateWindowHints(vendor);
	}
	/**
	* 固定账号或回到自动轮换。
	* @param vendor - 厂商 id。
	* @param ref - 目标账号；`null` 表示自动轮换。
	*/
	async selectAccount(vendor, ref) {
		const deps = this.requireVendor(vendor);
		await deps.accounts.select(ref);
		if (ref !== null) deps.rotation.current().noteSelected(ref);
	}
	/**
	* 调整账号顺序。
	*
	* 只有声明了 `reorder` 能力的厂商才实现（本包只有 opencode）。没实现的厂商**报明确错误**，
	* 不是静默无操作 —— 页面上没有这个控件，能走到这里就说明接线错了。
	* @param vendor - 厂商 id。
	* @param ref - 目标账号。
	* @param toIndex - 移动后的最终下标。
	*/
	async moveAccount(vendor, ref, toIndex) {
		const move = this.requireVendor(vendor).accounts.move;
		if (move === void 0) throw new Error(`dsh-llm-account: vendor "${vendor}" does not support reordering accounts`);
		await move.call(this.requireVendor(vendor).accounts, ref, toIndex);
	}
	/**
	* 写自动切换开关。
	*
	* 两家都已实现（设计 §6.4.5 把 `autoSwitch` 落库定为共用的可靠性机制；Command Code 在
	* 2026-10-17 按交接文件 §4.2 的 C 项补齐，此前只有 opencode）。端口上仍是可选方法：
	* 没实现的厂商报明确错误，不是静默无操作。
	* @param vendor - 厂商 id。
	* @param value - 开关值。
	*/
	async setAutoSwitch(vendor, value) {
		const setAutoSwitch = this.requireVendor(vendor).accounts.setAutoSwitch;
		if (setAutoSwitch === void 0) throw new Error(`dsh-llm-account: vendor "${vendor}" has no auto-switch setting`);
		await setAutoSwitch.call(this.requireVendor(vendor).accounts, value);
	}
	/**
	* 立即执行一次切换（页面按钮）：有 pending 先应用；否则强制评估一次并立即写选择。
	* @param vendor - 厂商 id。
	* @returns 是否真的切了、切到谁、原因。
	*/
	async switchNow(vendor) {
		const switchNow = this.requireVendor(vendor).switchNow;
		if (switchNow === void 0) return { switched: false };
		const decision = await switchNow();
		return decision === void 0 ? { switched: false } : {
			switched: true,
			target: decision.target,
			reason: decision.reason
		};
	}
	/**
	* 把一份全局顺序写进**所有**已注册厂商的设置文档（两家保存同一份，各自投影）。
	* @param order - `vendor:ref` 键。
	*/
	async setAccountOrder(order) {
		const writes = [];
		for (const deps of this.vendorDeps.values()) if (deps.setAccountOrder !== void 0) writes.push(deps.setAccountOrder(order));
		await Promise.all(writes);
	}
	/**
	* 把一套全局切换设置写进**所有**已注册厂商的设置文档。
	* @param settings - 策略/间隔/回合末/自动切换。
	*/
	async setSwitchSettings(settings) {
		const writes = [];
		for (const deps of this.vendorDeps.values()) if (deps.setSwitchSettings !== void 0) writes.push(deps.setSwitchSettings(settings));
		await Promise.all(writes);
	}
	/**
	* 覆盖一个账号可用的模型；同一模型可以同时属于多个账号。
	* @param vendor - 厂商 id。
	* @param ref - 账号 ref。
	* @param models - 该账号的模型 id 列表。
	*/
	async setAccountModels(vendor, ref, models) {
		const setter = this.requireVendor(vendor).setAccountModels;
		if (setter === void 0) return;
		await setter(ref, models);
	}
	/**
	* 开始（或接续）一次网页登录。
	* @param vendor - 厂商 id。
	* @returns 登录状态（`waiting` 时带授权网址）。
	*/
	async loginBegin(vendor) {
		return this.requireLogin(vendor).begin();
	}
	/**
	* 查询当前登录尝试。
	* @param vendor - 厂商 id。
	* @returns 登录状态。
	*/
	async loginStatus(vendor) {
		return this.requireLogin(vendor).status();
	}
	/**
	* 取消等待中的登录尝试。
	* @param vendor - 厂商 id。
	*/
	async loginCancel(vendor) {
		await this.requireLogin(vendor).cancel();
	}
	/**
	* 取某厂商各账号的**额度窗口提示**（带 TTL 缓存）。
	*
	* ## 为什么要缓存（第七轮复审 P1-P01）
	*
	* `usageReport()` 被设置页每 30 秒调一次。它需要每个账号的窗口边界来定位「统计
	* 周期」，而这份信息来自 `status(vendor)` —— 后者会对**每个已配置账号并发打额度
	* 端点**（Command Code 每账号最多 4 个请求）。
	*
	* 也就是说：用户只是看着用量页面不动，每 30 秒就会产生 `账号数 × 端点` 次上游
	* 请求。而窗口边界（最小 5 小时）在这段时间根本不会变。
	*
	* 缓存 60 秒后，最长「每两次刷新打一轮」。
	*
	* ## 失败处理
	*
	* 读失败时**保留上一次成功的值** —— 沿用已知窗口比退回自然周期更符合用户预期
	* （报表不会在 30 秒后突然换口径）。缓存过期且从未成功过时返回空数组，调用方
	* 自然回退到自然周期。
	*
	* ## 缓存有效期不是固定 60 秒（第七轮复审 BUG-02）
	*
	* 原来只要没到 60 秒就直接用缓存。两个边界没处理好：
	*
	* 1. **部分失败被当成成功缓存**：`status()` 对单个账号的额度失败只记 `failures`、
	*    不抛错。于是「A 超时、拿到没有窗口的 A」也会被缓存 60 秒 —— 网络恢复了却
	*    还在用缺窗口的结果；
	* 2. **窗口即将重置**：`resetAt` 就在未来几十秒时，本期的金额与窗口状态都会变，
	*    但 60 秒 TTL 还挡着。
	*
	* 现在：缓存的有效期取 `min(TTL, 最近的 resetAt / planEnd)`；读到部分失败时
	* **只更新成功的账号**，失败账号沿用上一次的完整值（若没有则留空，不假装知道）。
	* @param vendor - 厂商 id。
	* @returns 各账号的窗口提示（可能为空）。
	*/
	async quotaWindowHintsOf(vendor) {
		const now = Date.now();
		const cached = this.quotaWindowCache.get(vendor);
		if (cached !== void 0 && now - cached.at < cached.ttlMs) return cached.value;
		/**
		* 记下**读取开始时的代际**。写回前若已变化，说明期间发生过账号变更
		* （`invalidateWindowHints` 把它 +1 了）—— 这次读到的结果已经过期，丢弃。
		*/
		const generationAtStart = this.quotaCacheGeneration.get(vendor) ?? 0;
		try {
			const status = await this.status(vendor);
			/** 上一次成功的值按 ref 建索引，供「这次失败的账号」沿用。 */
			const previous = new Map((cached?.value ?? []).map((hint) => [hint.ref, hint]));
			const hints = [];
			for (const account of status.accounts ?? []) {
				const ranked = [...account.quota?.windows ?? []].sort((left, right) => rankOfWindow(left.key) - rankOfWindow(right.key));
				const finest = ranked[0];
				if (finest === void 0) {
					const before = previous.get(account.ref);
					if (before !== void 0) {
						hints.push(before);
						continue;
					}
				}
				const periodEnd = account.quota?.plan?.periodEnd;
				const periodStart = account.quota?.plan?.periodStart;
				const usdWindows = ranked.filter((window) => window.unit === "usd" && window.used !== void 0);
				const usd = (periodEnd === void 0 ? void 0 : usdWindows.find((window) => window.resetAt !== void 0 && Math.abs(window.resetAt - periodEnd) < 6e4)) ?? (periodEnd === void 0 ? usdWindows[0] : void 0);
				hints.push({
					ref: account.ref,
					...finest === void 0 ? {} : { windowKey: finest.key },
					...finest?.resetAt === void 0 ? {} : { resetAt: finest.resetAt },
					...periodEnd === void 0 ? {} : { planEnd: periodEnd },
					...periodStart === void 0 ? {} : { planStart: periodStart },
					...usd?.used === void 0 ? {} : { spent: {
						amount: usd.used,
						window: usd.key
					} }
				});
			}
			/**
			* 有效期取 `min(TTL, 最近的窗口到期时刻)`。
			*
			* 窗口边界通常离得很远（5 小时 / 周），这时就是 60 秒；但如果某个窗口**几十秒
			* 后就要重置**，那之后 `resetAt` 与本期金额都会变 —— 缓存必须提前失效，否则
			* 报表会拿旧账期算数（第七轮复审 BUG-02）。
			*/
			const nearestEdge = hints.reduce((earliest, hint) => {
				const candidates = [hint.resetAt, hint.planEnd].filter((value) => typeof value === "number" && value > now);
				if (candidates.length === 0) return earliest;
				const soonest = Math.min(...candidates);
				return earliest === void 0 ? soonest : Math.min(earliest, soonest);
			}, void 0);
			const ttlMs = nearestEdge === void 0 ? LlmAccountUsageService.QUOTA_WINDOW_TTL_MS : Math.max(1e3, Math.min(LlmAccountUsageService.QUOTA_WINDOW_TTL_MS, nearestEdge - now));
			/**
			* **只有代际未变才写回**（第八轮复审 BUG-01 的在途竞态）。
			*
			* 若期间发生过账号增删/换钥，这次读到的清单已经过期 —— 写回去就是用一个旧
			* 结果覆盖用户刚做的变更，然后还要再等一个 TTL。这次丢弃，下次调用重读。
			*/
			if ((this.quotaCacheGeneration.get(vendor) ?? 0) !== generationAtStart) return hints;
			this.quotaWindowCache.set(vendor, {
				at: now,
				ttlMs,
				value: hints
			});
			return hints;
		} catch {
			return cached?.value ?? [];
		}
	}
	/**
	* 用量报表：读共享台账，按「每账号自己的记账周期」+ 一份总账聚合。
	*
	* **跨厂商**：台账是三条 provider 行共用的那一本，所以这里不按 vendor 取读口。
	*
	* 周期粒度从**当前额度窗口**推断：`status()` 里已经有每账号的窗口（含 `resetAt`），
	* 用它能让周期锚到厂商真实的重置时间；额度读不到时退回自然周期（报表里会标明
	* `fromResetAt: false`，界面上显示成「按自然 X 推算」）。
	* @param window - 时间窗口（`today` / `7d` / `30d` / `all`）。
	* @returns 报表。
	*/
	async usageReport(window = "today") {
		const now = Date.now();
		let records = [];
		try {
			records = await sharedUsageLedger().read(readRangeFor(window, now));
		} catch (error) {
			console.warn("[dsh-llm-account] could not read the usage ledger:", error);
		}
		const windows = /* @__PURE__ */ new Map();
		const planEnds = /* @__PURE__ */ new Map();
		/** 每账号的套餐本期开始时刻（厂商公布了才填）。 */
		const planStarts = /* @__PURE__ */ new Map();
		/** 每账号的**权威已用金额**（只来自 `unit === "usd"` 的窗口）。 */
		const spent = /* @__PURE__ */ new Map();
		/**
		* 取各厂商的额度窗口提示 —— **带 TTL 缓存**（2026-10-30 修 P1-P01）。
		*
		* 原来这里直接 `await this.status(vendor)`，而 `status()` 会对每个已配置账号并发
		* 打额度端点。设置页每 30 秒刷一次报表，账号一多就是成倍的上游 HTTP —— 而报表
		* 本身的数据源是**本地台账**，额度只用来选「统计周期」。
		*
		* 窗口边界最小是 5 小时，不可能在 60 秒内变化，所以缓存完全不影响口径正确性。
		*/
		/**
		* **三家并行取**，不再逐家 `await`（第七轮复审 PERF-01）。
		*
		* 原来是 `for (const vendor of ...) await this.quotaWindowHintsOf(vendor)` ——
		* 三家各有账号卡住时，等待时间**逐家累加**：单家最多等 30 秒超时，三家顺序就是
		* 近 90 秒。而这份数据只是用来定位报表口径，不该让用户看 90 秒的加载。
		*
		* `allSettled` 而不是 `all`：一家抛错不该让另外两家的窗口丢掉。
		*/
		const vendors = [...this.vendorDeps.keys()];
		const settled = await Promise.allSettled(vendors.map((vendor) => this.quotaWindowHintsOf(vendor)));
		for (let index = 0; index < vendors.length; index += 1) {
			const vendor = vendors[index];
			const outcome = settled[index];
			if (vendor === void 0 || outcome === void 0 || outcome.status !== "fulfilled") continue;
			const hints = outcome.value;
			for (const hint of hints) {
				const key = `${vendor}\u0000${hint.ref}`;
				windows.set(key, {
					...hint.windowKey === void 0 ? {} : { windowKey: hint.windowKey },
					...hint.resetAt === void 0 ? {} : { resetAt: hint.resetAt }
				});
				if (hint.planEnd !== void 0) planEnds.set(key, hint.planEnd);
				if (hint.planStart !== void 0) planStarts.set(key, hint.planStart);
				if (hint.spent !== void 0) spent.set(key, hint.spent);
			}
		}
		const report = buildUsageReport({
			records,
			window,
			now,
			periodWindowOf: (vendor, account) => windows.get(`${vendor}\u0000${account}`)?.windowKey,
			resetAtOf: (vendor, account) => windows.get(`${vendor}\u0000${account}`)?.resetAt,
			planPeriodEndOf: (vendor, account) => planEnds.get(`${vendor}\u0000${account}`),
			planPeriodStartOf: (vendor, account) => planStarts.get(`${vendor}\u0000${account}`),
			spentOf: (vendor, account) => spent.get(`${vendor}\u0000${account}`)
		});
		const known = new Set(windows.keys());
		const lastUsed = lastUsedAccountOf(records, (vendor, account) => known.has(`${vendor}\u0000${account}`));
		const scoped = withinWindow(records, window, now);
		const failuresByAccount = [...failureBreakdownPerAccount(scoped).entries()].map(([key, rows]) => {
			const separator = key.indexOf("\0");
			return {
				vendor: separator < 0 ? "" : key.slice(0, separator),
				account: separator < 0 ? key : key.slice(separator + 1),
				rows
			};
		});
		const failuresByKind = failureBreakdownOf(scoped);
		return {
			...report,
			...lastUsed === void 0 ? {} : { lastUsed },
			...failuresByKind.length === 0 ? {} : { failuresByKind },
			...failuresByAccount.length === 0 ? {} : { failuresByAccount }
		};
	}
	/**
	* 导出用量台账为 CSV。
	*
	* 为什么在宿主侧做序列化：台账文件在这台机器上，客户端只拿到远程结果；把 CSV 文本整个传过去
	* 比传几千条记录再在浏览器里拼更省事，也保证导出与界面看到的是**同一份**数据。
	*
	* **缺省导出全部**（120 天保留期内）。以前缺省是「最近 1000 条」，而客户端从不传参 ——
	* 台账一旦超过 1000 条，用户拿到的文件就悄悄少了前面那部分，界面上却毫无提示
	* （2026-10-20 审计；当时台账已有 2401 条）。对账场景下「看起来成功但数据不全」比失败更糟。
	* @param limit - 可选上限（尾部，即最近的）。省略 = 不截断。
	* @returns CSV 文本（含表头）。
	*/
	async usageExportCsv(limit) {
		const records = await sharedUsageLedger().read();
		return ledgerCsvOf(typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? exportTailOf(records, limit) : [...records]);
	}
	/**
	* 清空用量台账。
	*
	* 只清内容、不删文件（见 `usage-ledger` 的 `clear`）：删文件的破坏性更大，而
	* 「清空」的语义已经达成。二次确认在客户端做 —— 宿主侧不该替用户决定。
	*/
	async usageClear() {
		await sharedUsageLedger().clear();
	}
	/**
	* 查询一组凭据引用名是否**真的**配置了。
	*
	* 为什么需要：界面上「搜索 API key」填的是**引用名**，真 key 在凭据库里 ——
	* 填了名字不等于库里有那把 key，而界面从来不去查，用户无从判断自己加没加成功
	* （2026-10-20 报障「添加 API KEY 后没有显示是否已添加」）。
	*
	* **只回布尔，绝不回密钥**：密钥一旦进了浏览器内存就多一条泄漏途径，
	* 而界面只需要「有没有」这一个事实。
	* @param refs - 要查询的引用名。
	* @returns 逐条 `{ ref, configured }`（顺序与入参一致）。
	*/
	async credentialStatus(refs) {
		const credentials = [...this.vendorDeps.values()][0]?.credentials;
		if (credentials === void 0) return refs.map((ref) => ({
			ref,
			configured: false
		}));
		const described = await credentials.describe([...refs]);
		return refs.map((ref) => ({
			ref,
			configured: described[ref]?.configured === true
		}));
	}
	/**
	* 往凭据库里写一把密钥。
	*
	* 与账号卡片的「更换密钥」走**同一条路径**（`credentials.set`）：密钥只经凭据服务进出，
	* 设置文档里永远不落明文（项目全局约束）。
	* @param ref - 凭据引用名。
	* @param secret - 密钥（空值在边界上已被拒绝）。
	*/
	async setCredential(ref, secret) {
		const credentials = [...this.vendorDeps.values()][0]?.credentials;
		if (credentials === void 0) throw new Error("dsh-llm-account: 凭据服务不可用，无法写入密钥（请在宿主的凭据页添加）");
		await credentials.set(ref, secret);
	}
	/** 取一家厂商的读口；没登记过就吵出来（静默返回空结果会伪装成「没有账号」）。 */
	requireVendor(vendor) {
		const deps = this.vendorDeps.get(vendor);
		if (deps === void 0) throw new Error(`dsh-llm-account: vendor "${vendor}" is not registered on the ${USAGE_SERVICE_KEY} remote (registered: ${[...this.vendorDeps.keys()].join(", ") || "none"})`);
		return deps;
	}
	/** 取一家厂商的登录端口；该厂商不支持网页登录时给出可读错误（而不是静默无操作）。 */
	requireLogin(vendor) {
		const login = this.requireVendor(vendor).login;
		if (login === void 0) throw new Error(`dsh-llm-account: vendor "${vendor}" does not support browser login`);
		return login;
	}
};
/**
* 单个账号额度读取的超时（毫秒）；一个账号卡住不能拖住整页状态。
*
* **2026-10-18 从 8s 提到 30s**（本机实测：用量面板「经常获取不到账户信息」的根因）。
* Command Code 的额度端口是 `whoami` → 另三个端点并行，即**两跳**；而端口自身的端点预算
* （`DEFAULT_REQUEST_TIMEOUT_MS`）是 300s。8s 比一次正常读取的两跳时间还短 —— 慢网下
* （每跳 4-5s）读取必然在 8s 被砍，于是界面显示「暂无额度数据 + read failed (timeout
* after 8000ms)」，而账号信息本身（名称、状态）其实读到了。30s 留足了两跳在慢网下的
* 余量，同时仍能砍掉真正卡住的端点（端口自己的 300s 预算对界面太长了）。
*/
const QUOTA_READ_TIMEOUT_MS = 3e4;
/**
* 带超时（超时后重试一次）的额度读取。
*
* ## 超时后底层调用怎么办（2026-10-22 修 MEDIUM-1）
*
* `Promise.race` 的败者**不会被取消** —— 超时 reject 之后 `snapshot(ref)` 仍在飞。
* 若直接重试，失败路径上会同时存在两个未完成的 snapshot：
*
* - 厂商额度接口的请求量翻倍（重试几次就翻几倍）；
* - `snapshot` 内部会 `resolveKey(ref)`，在 opencode 那条链路上可能触发 OAuth 刷新并
*   回写凭据槽 —— 两个并发刷新会互相踩踏。
*
* 本包的 `QuotaPort.snapshot` **不接受 `AbortSignal`**（端口签名由厂商实现决定，三家
* 都不支持取消），所以无法真正中止它。能做的是两件事：
*
* 1. 给败者挂一个 `.catch()`，避免它在超时后被当成 unhandled rejection；
* 2. **放弃重试**（`QUOTA_READ_RETRIES = 0`）—— 超时的根因是上游慢，再发一次只会让
*    在途请求叠加。界面已经会如实显示 `timeout after 30000ms`，用户点刷新即可再来。
*
* 这比「重试拿翻倍请求量换一次可能的成功」更克制：额度面板是旁路读数，晚一拍看到
* 数字没有代价，而并发刷新踩踏会真的让某个账号的凭据暂时失效。
* @param quota - 额度端口。
* @param ref - 账号 ref。
* @returns 读数；超时或端口明确失败时抛错（由调用方记入 failures）。
*/
async function quotaWithTimeout(quota, ref) {
	let timer;
	/** 底层读取的 promise；超时后仍会继续跑完，所以要在后面挂 catch。 */
	const reading = quota.snapshot(ref);
	try {
		return await Promise.race([reading, new Promise((_resolve, reject) => {
			timer = setTimeout(() => reject(/* @__PURE__ */ new Error(`timeout after ${QUOTA_READ_TIMEOUT_MS}ms`)), QUOTA_READ_TIMEOUT_MS);
		})]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
		/**
		* **给败者挂一个兜底 catch。**
		*
		* 竞态赢的是超时那一侧时，`reading` 还在飞；它之后 reject 的话，没有人 await 它
		* —— 那会变成 unhandled rejection（Node 会打印警告，测试里还可能被判失败）。
		* 这里挂一个空 catch 明确表示「这个结果已经不再需要」。
		*
		* 注意不能因此认为它被取消了：请求仍会跑完，只是结果被丢弃。
		*/
		reading.catch(() => void 0);
	}
}
/** 把额度读数转成摘要：字段原样搬运，缺失即缺失。 */
function quotaSummaryOf(snapshot) {
	return {
		...snapshot.plan === void 0 ? {} : { plan: { ...snapshot.plan } },
		windows: snapshot.windows.map((window) => ({ ...window })),
		failures: [...snapshot.failures]
	};
}
/** 读宿主 `ctx.typert`，形状不认识时返回 `undefined`。 */
function hostTypertOf(ctx) {
	const service = ctx.get("typert");
	if (!isServiceLike(service) || typeof service.register !== "function") return void 0;
	return service;
}
/** 取现有的账号中心服务（**结构**判定：两个 entry 可能是两份模块实例，`instanceof` 会误判）。 */
function existingServiceOf(ctx) {
	const service = ctx.get(USAGE_SERVICE_KEY);
	if (!isServiceLike(service) || typeof service.registerVendor !== "function") return void 0;
	return service;
}
/**
* 装配一个厂商的账号中心远程：`typert` 就绪后创建（或复用）服务、登记读口，并由**创建者**
* 注册一次描述符。
*
* 两条硬约束（都是实测结果，不是设计偏好）：
* 1. **服务必须住在根上下文**：两个 profile 行的注入作用域是**兄弟**，第一行在自己作用域里
*    注册的服务第二行看不见（`ctx.get` 只会向上找），结果就是两家各建一个实例、同名服务
*    互相覆盖。注册在共同祖先（root）上才有一个共享实例。
* 2. **不能每次都 `new`**：同名 cordis 服务重复注册会撞车或悄悄覆盖，使其中一家读不到数据；
*    所以先按结构判定复用已有实例（`instanceof` 不行 —— 两条子路径可能是两份模块实例）。
* @param ctx - 该 profile 行的插件上下文。
* @param deps - 该行的厂商读口。
*/
function applyUsageRemote(ctx, deps) {
	if (typeof ctx.inject !== "function") {
		warnOn(ctx, `dsh-llm-account: this host context has no inject(); the ${USAGE_NAMESPACE} remote is not published`);
		return;
	}
	ctx.inject(["typert"], (remoteCtx) => {
		const root = remoteCtx.root;
		const service = existingServiceOf(root) ?? new LlmAccountUsageService(root);
		service.registerVendor(deps);
		ctx.effect(() => () => {
			service.unregisterVendor(deps.vendor);
		}, "dsh-llm-account: usage remote vendor");
		/**
		* 描述符：**每次都尝试**，由 `publishInvocations` 自己判定幂等。
		*
		* 原来这里写 `if (existing !== undefined) return;` —— 用「服务在不在」代替
		* 「描述符在不在」。两者是独立状态：`typert` 服务的 ctx 重建过时，服务还在
		* root 上、描述符却被 `withdraw` 了，于是我们永远跳过注册，客户端拿到
		* `gateway/definition-unavailable`。
		*/
		publishInvocations(remoteCtx);
	});
}
/**
* 把三个强类型调用描述符登记给宿主 `typert` —— **幂等**。
*
* ## 为什么需要幂等（2026-10-29）
*
* 调用方原来只在「新建服务」时调本函数（`if (existing !== undefined) return`）。
* 但**服务实例**与**描述符**是两套独立状态：
*
* - 服务挂在 `root` 上（`ctx.get(USAGE_SERVICE_KEY)`）；
* - 描述符挂在 `typert` 服务的 `descriptors` 表里，随 **`typert` 的 ctx** 销毁而
*   `withdraw`。
*
* 两者不同步时就会出问题：服务还在 → 调用方跳过注册；而描述符表已空 → 客户端拿到
* `gateway/definition-unavailable: its strict definition was withdrawn`。
*
* 现在改成**查了再决定**：宿主暴露 `remotes.get(endpoint)`，描述符全在就什么都不做；
* 缺任何一个就补注册。
* @param remoteCtx - 注入 `typert` 后的上下文。
*/
function publishInvocations(remoteCtx) {
	const typert = hostTypertOf(remoteCtx);
	if (typert === void 0) {
		warnOn(remoteCtx, `dsh-llm-account: the host typert service does not expose register(); the ${USAGE_NAMESPACE} remote was not published`);
		return;
	}
	const descriptors = usageDescriptors();
	const endpoints = descriptors.map((descriptor) => `${USAGE_NAMESPACE}/${descriptor.method}`);
	/**
	* 描述符都还在 → 已经是想要的状态，什么都不做。
	*
	* 只在宿主真的暴露了查询面时判定；旧宿主没有 `remotes.get` 就直接走注册
	* （那种宿主也只有一次装配，不存在「撤回了却没人补」的场景）。
	*/
	const lookup = typert.remotes?.get;
	if (typeof lookup === "function") {
		if (endpoints.every((endpoint) => {
			try {
				return lookup.call(typert.remotes, endpoint) !== void 0;
			} catch {
				return false;
			}
		})) return;
	}
	try {
		typert.register({
			package: USAGE_PACKAGE,
			face: "host",
			schemas: [],
			model: {
				services: [],
				events: [],
				objects: []
			},
			invocations: descriptors
		});
	} catch (error) {
		/**
		* 宿主拒绝重复注册（`typert: Remote package "..." is already registered`）。
		*
		* 这说明描述符表里**其实还在**，只是 `remotes.get` 没查到（或没这个接口）——
		* 不是需要整行挂掉的错误。
		*/
		warnOn(remoteCtx, `dsh-llm-account: the host refused to re-register the ${USAGE_NAMESPACE} remote (likely already registered): ${String(error)}`);
	}
}
/**
* 一个窗口的剩余比例（0..1）。
*
* 判定顺序：`exceeded` → 0；`percent` → `1 - percent/100`；`used/cap` → `1 - used/cap`；
* 都缺 → `undefined`（未知，绝不倒成 0）。结果夹到 `[0,1]`。
* @param window - 归一化窗口。
* @returns 剩余比例；无法判定时 `undefined`。
*/
function windowRemaining(window) {
	if (window.exceeded === true) return 0;
	let usedFraction;
	if (typeof window.percent === "number" && Number.isFinite(window.percent)) usedFraction = window.percent / 100;
	else if (typeof window.used === "number" && typeof window.cap === "number" && Number.isFinite(window.used) && Number.isFinite(window.cap) && window.cap > 0) usedFraction = window.used / window.cap;
	if (usedFraction === void 0) return void 0;
	return Math.min(1, Math.max(0, 1 - usedFraction));
}
/**
* 一个快照的剩余比例：取**最紧**的那个窗口（额度优先看最先耗尽的约束）。
* @param snapshot - 额度读数。
* @returns 剩余比例；没有任何可判定窗口时 `undefined`。
*/
function remainingFraction(snapshot) {
	if (snapshot === void 0) return void 0;
	let min;
	for (const window of snapshot.windows) {
		const remaining = windowRemaining(window);
		if (remaining === void 0) continue;
		if (min === void 0 || remaining < min) min = remaining;
		if (min === 0) break;
	}
	return min;
}
/**
* 这个快照是否已耗尽（任一窗口超出或剩余归零）。
* 未知读数**不算**耗尽 —— 否则一次失败的额度读取会触发无谓换号。
* @param snapshot - 额度读数。
* @returns 是否耗尽。
*/
function quotaExhausted(snapshot) {
	if (snapshot === void 0) return false;
	return snapshot.windows.some((window) => windowRemaining(window) === 0);
}
/**
* 从设置文档解析策略，坏值落默认：`order` / 60 分钟 / 回合末切换。
* @param document - 设置文档。
* @returns 清洗后的策略参数。
*/
function switchSettingsOf(document) {
	const strategy = document.switchStrategy === "best-quota" ? "best-quota" : document.switchStrategy === "scheduled" ? "scheduled" : "order";
	const rawInterval = document.switchIntervalMinutes;
	return {
		strategy,
		intervalMinutes: typeof rawInterval === "number" && Number.isFinite(rawInterval) ? Math.min(1440, Math.max(0, Math.floor(rawInterval))) : 60,
		atTurnEnd: document.switchAtTurnEnd !== false
	};
}
/**
* 现在是否该评估一次切换。
* @param lastEvaluatedAt - 上一次评估时刻（epoch 毫秒）；`0` 表示从未评估。
* @param now - 当前时刻。
* @param intervalMinutes - 评估间隔（分钟）；`0` 表示不按时间评估。
* @param currentExhausted - 当前账号是否已耗尽（耗尽立刻评估）。
* @returns 是否评估。
*/
function isDue(lastEvaluatedAt, now, intervalMinutes, currentExhausted) {
	if (currentExhausted) return true;
	if (intervalMinutes <= 0) return false;
	if (lastEvaluatedAt <= 0) return true;
	return now - lastEvaluatedAt >= intervalMinutes * 6e4;
}
/** 候选是否不可用（被拒或额度耗尽）。 */
function unavailable(candidate) {
	return candidate.rejected === true || quotaExhausted(candidate.quota);
}
/**
* 选下一个账号。
*
* - `current` 为 `null`：不主动切（还没有「当前」可言）；
* - 当前耗尽：`order` 取顺序里第一个可用者；`best-quota` 取额度最高者（都没有读数时退回
*   顺序里的第一个可用者）。原因 `quota`；
* - 当前未耗尽：`order` 永不切；`best-quota` 只在**到期**且最高者领先当前至少
*   {@link SWITCH_MARGIN} 时切，原因 `balance`；当前额度未知时不切。
*
* @param input - 当前账号、候选顺序、额度与是否到期。
* @returns 切换决定；不该切时 `undefined`。
*/
function chooseSwitch(input) {
	if (input.current === null) return void 0;
	const currentCandidate = input.candidates.find((candidate) => candidate.ref === input.current);
	const currentSnapshot = input.currentQuota ?? currentCandidate?.quota;
	const currentExhausted = input.currentRejected === true || currentCandidate?.rejected === true || quotaExhausted(currentSnapshot);
	const available = input.candidates.filter((candidate) => candidate.ref !== input.current).filter((candidate) => !unavailable(candidate));
	if (available.length === 0) return void 0;
	const rotate = (reason) => {
		const at = input.candidates.findIndex((candidate) => candidate.ref === input.current);
		const next = (at === -1 ? input.candidates : [...input.candidates.slice(at + 1), ...input.candidates.slice(0, at)]).find((candidate) => candidate.ref !== input.current && !unavailable(candidate));
		return next === void 0 ? void 0 : {
			target: next.ref,
			reason
		};
	};
	if (input.strategy === "scheduled") {
		if (!input.due) return void 0;
		return rotate("scheduled");
	}
	if (currentExhausted) {
		if (input.strategy !== "best-quota") return rotate("quota");
		return {
			target: available.flatMap((candidate) => {
				const remaining = remainingFraction(candidate.quota);
				return remaining === void 0 ? [] : [{
					ref: candidate.ref,
					remaining
				}];
			}).sort((left, right) => right.remaining - left.remaining)[0]?.ref ?? available[0].ref,
			reason: "quota"
		};
	}
	if (!input.due) return void 0;
	if (input.strategy !== "best-quota") return void 0;
	const currentRemaining = remainingFraction(currentSnapshot);
	if (currentRemaining === void 0) return void 0;
	const best = available.flatMap((candidate) => {
		const remaining = remainingFraction(candidate.quota);
		return remaining === void 0 ? [] : [{
			ref: candidate.ref,
			remaining
		}];
	}).sort((left, right) => right.remaining - left.remaining)[0];
	if (best === void 0 || best.remaining <= currentRemaining + .1) return void 0;
	return {
		target: best.ref,
		reason: "balance"
	};
}
/** 会话边界表的上限；超过后丢最早的一条（长时间运行的会话不会无限涨）。 */
const MAX_SESSIONS = 128;
/** 判断一个宿主事件是不是回合结束。 */
function isTurnEndEvent(event) {
	if (typeof event !== "object" || event === null) return false;
	const record = event;
	const type = record.type;
	if (type === "turn/end" || type === "turn_end") return true;
	if (record.kind === "turn/end") return true;
	return record.event !== void 0 && isTurnEndEvent(record.event);
}
/** 可读的错误信息。 */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/** 把 key 写进有上限的表；满了先丢最早插入的项。 */
function remember(map, key, value) {
	if (!map.has(key) && map.size >= MAX_SESSIONS) {
		const oldest = map.keys().next().value;
		if (oldest !== void 0) map.delete(oldest);
	}
	map.set(key, value);
}
/** 手动顺序里的下一个可用账号（当前之后，绕回开头）。 */
function nextInOrder(current, candidates) {
	const at = candidates.findIndex((candidate) => candidate.ref === current);
	return (at === -1 ? candidates : [...candidates.slice(at + 1), ...candidates.slice(0, at)]).find((candidate) => candidate.ref !== current && candidate.rejected !== true && !quotaExhausted(candidate.quota))?.ref;
}
/**
* 账号切换控制器（每个厂商一份）。
*/
var SwitchingController = class {
	#deps;
	#now;
	#warn;
	/** 上一次评估策略的时刻（进程内；重启后从 0 开始，等价于「立刻评估一次」）。 */
	#lastEvaluatedAt = 0;
	/** ref → 额度读数（带时刻，读时判 TTL）。 */
	#quotaCache = /* @__PURE__ */ new Map();
	/** session → 最近一次 turn/end 的时刻。 */
	#turnEnds = /* @__PURE__ */ new Map();
	/** session → 最近一次普通请求的时刻。 */
	#lastRequests = /* @__PURE__ */ new Map();
	/** 回合末要应用的切换决定。 */
	#pending;
	/** 防止并发请求同时评估（同一个插件只有一份控制器）。 */
	#busy = false;
	/**
	* @param deps - 账号、额度、轮换与设置来源。
	*/
	constructor(deps) {
		this.#deps = deps;
		this.#now = deps.now ?? (() => Date.now());
		this.#warn = deps.warn ?? (() => {});
	}
	/**
	* 普通对话请求前调用。永远不抛。
	* @param input - 会话 id 与宿主调用目的。
	*/
	async beforeRequest(input) {
		if (input.purpose !== void 0) return;
		if (this.#busy) return;
		this.#busy = true;
		const now = this.#now();
		try {
			if (this.#deps.document().autoSwitch === false) {
				this.#pending = void 0;
				return;
			}
			this.#discardStalePending();
			if (this.#pending !== void 0) {
				if (this.#atTurnBoundary(input)) {
					const pending = this.#pending.decision;
					this.#pending = void 0;
					await this.#apply(pending);
				}
			} else await this.#evaluate(input, now);
		} catch (error) {
			this.#warn(`switching: ${messageOf(error)}`);
		} finally {
			this.#busy = false;
			if (input.sessionId !== void 0) remember(this.#lastRequests, input.sessionId, now);
		}
	}
	/**
	* 接收宿主会话事件；只有回合结束才改变门控状态。
	* @param sessionId - 会话 id。
	* @param event - 宿主事件（形状不可信）。
	*/
	noteSessionEvent(sessionId, event) {
		if (sessionId === void 0 || !isTurnEndEvent(event)) return;
		remember(this.#turnEnds, sessionId, this.#now());
	}
	/**
	* 接收宿主 `session/event` 的原始参数（形状未文档化，做容错解析）：
	* 既支持 `(sessionId, event)`，也支持 `({ sessionId, event })`。
	* @param args - 宿主事件回调收到的参数。
	*/
	noteHostEvent(...args) {
		const [first, second] = args;
		if (typeof first === "string") {
			this.noteSessionEvent(first, second);
			return;
		}
		if (typeof first !== "object" || first === null) return;
		const record = first;
		if (typeof record.id === "string" && second !== void 0) {
			this.noteSessionEvent(record.id, second);
			return;
		}
		const session = record.sessionId ?? record.session;
		if (typeof session !== "string") return;
		this.noteSessionEvent(session, record.event ?? first);
	}
	/**
	* 现在是否允许「立即应用」：没有会话（单次调用）、会话还没发过请求、或
	* 上次请求之后收到过 turn/end。
	* @param input - 本次请求信息。
	* @returns 是否在回合边界上。
	*/
	#atTurnBoundary(input) {
		const session = input.sessionId;
		if (session === void 0) return true;
		const last = this.#lastRequests.get(session);
		if (last === void 0) return true;
		const end = this.#turnEnds.get(session);
		return end !== void 0 && end > last;
	}
	/**
	* 页面运行态：倒计时与待切换。
	* @returns 当前策略、上次/下次评估与 pending。
	*/
	snapshot() {
		const document = this.#deps.document();
		const settings = switchSettingsOf(document);
		const now = this.#now();
		const pending = this.#pending?.from === this.#deps.pinnedRef() ? this.#pending?.decision : void 0;
		const nextAt = (settings.strategy === "best-quota" || settings.strategy === "scheduled") && settings.intervalMinutes > 0 ? this.#lastEvaluatedAt > 0 ? this.#lastEvaluatedAt + settings.intervalMinutes * 6e4 : now : void 0;
		return {
			...settings,
			autoSwitch: document.autoSwitch === void 0 ? this.#deps.autoSwitchDefault !== false : document.autoSwitch !== false,
			evaluatedAt: this.#lastEvaluatedAt,
			...nextAt === void 0 ? {} : { nextAt },
			...pending === void 0 ? {} : { pending: { ...pending } }
		};
	}
	/**
	* 「立即切换」：有 pending 就先应用它；否则强制评估一次并立即应用（不等间隔、不等回合末）。
	* @returns 实际发生的切换；没有可切的目标时 `undefined`。
	*/
	async switchNow() {
		if (this.#busy) return void 0;
		this.#busy = true;
		try {
			this.#discardStalePending();
			if (this.#pending !== void 0) {
				const pending = this.#pending.decision;
				this.#pending = void 0;
				await this.#apply(pending);
				return pending;
			}
			return await this.#evaluate(void 0, this.#now(), { force: true });
		} catch (error) {
			this.#warn(`switching: ${messageOf(error)}`);
			return;
		} finally {
			this.#busy = false;
		}
	}
	/**
	* 到点就评估一次。
	* @param input - 本次请求信息；`undefined` 表示页面「立即切换」。
	* @param now - 当前时刻。
	* @param options - `force` 跳过 autoSwitch/间隔/回合末门控。
	* @returns 实际应用的切换；只记 pending 或没有目标时 `undefined`。
	*/
	async #evaluate(input, now, options = {}) {
		const force = options.force === true;
		const document = this.#deps.document();
		if (!force && document.autoSwitch === false) return void 0;
		const settings = switchSettingsOf(document);
		const current = this.#deps.pinnedRef();
		if (current === null) return void 0;
		const rejections = this.#deps.rotation.current().rejections();
		const currentExhausted = rejections.has(current) || quotaExhausted(this.#freshQuota(current, now));
		if (!force && settings.strategy === "order" && !currentExhausted) return void 0;
		if (!force && settings.strategy === "scheduled" && this.#lastEvaluatedAt <= 0) {
			this.#lastEvaluatedAt = now;
			return;
		}
		const quotaDriven = settings.strategy !== "scheduled";
		if (!force && !isDue(this.#lastEvaluatedAt, now, settings.intervalMinutes, quotaDriven ? currentExhausted : false)) return void 0;
		const views = (await this.#deps.accounts.list()).filter((view) => view.configured);
		const candidates = [];
		for (const view of views) {
			let snapshot = this.#freshQuota(view.ref, now);
			if (settings.strategy === "best-quota" && snapshot === void 0) snapshot = await this.#readQuota(view.ref, now);
			candidates.push({
				ref: view.ref,
				...snapshot === void 0 ? {} : { quota: snapshot },
				...rejections.has(view.ref) ? { rejected: true } : {}
			});
		}
		this.#lastEvaluatedAt = now;
		let currentSnapshot = this.#freshQuota(current, now);
		if (settings.strategy === "best-quota" && currentSnapshot === void 0) currentSnapshot = await this.#readQuota(current, now);
		if (!force && this.#deps.document().autoSwitch === false) return void 0;
		if (this.#deps.pinnedRef() !== current) return void 0;
		let decision;
		if (force && settings.strategy !== "best-quota" && !currentExhausted) {
			const target = nextInOrder(current, candidates);
			decision = target === void 0 ? void 0 : {
				target,
				reason: "manual"
			};
		} else decision = chooseSwitch({
			strategy: settings.strategy,
			candidates,
			current,
			...currentSnapshot === void 0 ? {} : { currentQuota: currentSnapshot },
			currentRejected: rejections.has(current),
			due: true
		});
		if (decision === void 0) return void 0;
		if (!force && settings.atTurnEnd && input !== void 0 && !this.#atTurnBoundary(input)) {
			this.#pending = {
				from: current,
				decision
			};
			return;
		}
		await this.#apply(decision);
		return decision;
	}
	/** A queued decision belongs to the account that triggered it. */
	#discardStalePending() {
		if (this.#pending !== void 0 && this.#pending.from !== this.#deps.pinnedRef()) this.#pending = void 0;
	}
	/**
	* 应用一个切换决定：写设置里的当前账号，再让引擎记提示。
	* @param decision - 目标与原因。
	*/
	async #apply(decision) {
		if (this.#deps.pinnedRef() === decision.target) return;
		await this.#deps.accounts.select(decision.target);
		this.#deps.rotation.current().noteAutoSwitch(decision.target, decision.reason);
	}
	/**
	* 读缓存里的新鲜读数。
	* @param ref - 账号 ref。
	* @param now - 当前时刻。
	* @returns 未过期读数；没有或过期时 `undefined`。
	*/
	#freshQuota(ref, now) {
		const entry = this.#quotaCache.get(ref);
		if (entry === void 0) return void 0;
		return now - entry.at < 6e4 ? entry.snapshot : void 0;
	}
	/**
	* 读一个账号的额度并写缓存；失败只记日志，返回 `undefined`。
	* @param ref - 账号 ref。
	* @param now - 当前时刻。
	* @returns 读数或 `undefined`。
	*/
	async #readQuota(ref, now) {
		try {
			const snapshot = await this.#deps.quota.snapshot(ref);
			this.#quotaCache.set(ref, {
				snapshot,
				at: now
			});
			return snapshot;
		} catch (error) {
			this.#warn(`switching: quota read for "${ref}" failed (${messageOf(error)})`);
			return;
		}
	}
};
//#endregion
export { assignModelsToAccount as $, assignUniqueNames as A, disableSettingsAutoForm as B, NOOP_USAGE_PORT as C, modelCandidates as D, invalidateCatalogCandidates as E, recentlyNetworkDown as F, markVolatileFields as G, intentLogFor as H, createCredentialsPort as I, writeSwitchSettings as J, unwrapVolatileConfig as K, createRotationAccess as L, hasImageInput as M, pickFallbackModel as N, noteCatalogModels as O, noteNetworkFailure as P, accountRef as Q, createSettingsIntentStore as R, selectVisible as S, delegateStream as T, isParsedConfig as U, environmentValue as V, isRecord$3 as W, repairLegacyContinueMessages as X, applyAutoContinue as Y, CREDENTIAL_REF_PATTERN as Z, withRequestDeadline as _, assistantImageText as a, normalizeKey as at, isModelIdVisible as b, dataUrlOf as c, projectImageBudget as d, dedupeByRef as et, readImageBytes as f, runStream as g, RequestDeadline as h, assertProjectableContent as i, reorder as it, officialModelName as j, registerCatalogSource as k, fileBlockText as l, LLM_STREAM_IDLE_TIMEOUT as m, applyUsageRemote as n, moveFirst as nt, base64Of as o, pickApiKey as ot, LLM_REQUEST_TIMEOUT as p, writeModelRules as q, createUsagePort as r, readAccountSlot as rt, collectImageBytes as s, SwitchingController as t, globalOrderOfVendor as tt, missingImagePlaceholder as u, runAttemptLoop as v, catalogCandidateRevision as w, normalizeVisibility as x, rejection as y, createSettingsPort as z };
