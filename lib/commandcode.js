import { A as writeSwitchSettings, B as pickApiKey, C as environmentValue, D as markVolatileFields, E as isRecord$6, F as globalOrderOfVendor, L as readAccountSlot, M as accountRef, N as assignModelsToAccount, O as unwrapVolatileConfig, P as dedupeByRef, R as reorder, S as disableSettingsAutoForm, T as isParsedConfig, _ as pickFallbackModel, a as LLM_REQUEST_TIMEOUT, b as createSettingsIntentStore, c as normalizeVisibility, d as delegateStream, f as modelCandidates, g as officialModelName, h as assignUniqueNames, i as rejection, j as CREDENTIAL_REF_PATTERN, k as writeModelRules, l as selectVisible, m as registerCatalogSource, n as applyUsageRemote, o as LLM_STREAM_IDLE_TIMEOUT, p as noteCatalogModels, r as createUsagePort, s as runStream, t as SwitchingController, u as NOOP_USAGE_PORT, v as createCredentialsPort, w as intentLogFor, x as createSettingsPort, y as createRotationAccess, z as normalizeKey } from "./switching-BotRE8RY.js";
import { t as gatewayAccessOf } from "./gateway-access-B1KtcMWy.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { randomBytes, randomUUID } from "node:crypto";
import { EMPTY_RESPONSE_CODE, LlmAdapter, LlmError, ReasoningEffortId, ToolCallId, attributionHeaders, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { createServer } from "node:http";
//#region src/vendors/commandcode/accounts.ts
/**
* Command Code 账号端口：真源在设置文档（命名空间 `llm-commandcode`），每个操作
* **先写意图日志、再提交设置变更、提交成功后 `settle`**（设计 §6.4.5、§7.1；
* 与 Task 13 同语义，Review Focus 5）。
*
* 形状逐条对照旧插件 `@mars-sea/dsh-commandcode-provider/lib/index.js`：
* - 文档字段 `accounts`（条目 `{ label, apiKeyEnv }`）/ `activeAccount` /
*   `modelAccountRules` / `credentialCleanupRefs`（Config schema 第 10059-10080 行）；
* - `remove` 的顺序（`cleanup` 第 9221-9234 行）：移除条目 → 丢掉挂在该 ref 上的
*   整条模型规则 → 若是当前固定账号则清成自动轮换 → 把 ref 记进 `credentialCleanupRefs`；
* - `activeAccount` 的自动轮换取值用旧插件导出的 `ACTIVE_ACCOUNT_AUTO`（第 9523 行），
*   空串也读作自动轮换（第 10153-10155 行 `preferredId`）；
* - **合成的默认槽**：顶层 `apiKeyEnv` 那个账号是旧插件 `slots()` 的第一项（第 10130-10152
*   行，`id: "default"`），它不在 `accounts[]` 里。`list()` 因此在第一行补出它，
*   `activeAccount: "default"` 也按它解析（`commandCodeAccountSlot`）—— 否则「正在服务请求的
*   那个账号」会既没有行、也固定不了（`select` 抛 unknown account ref）。
*
* **标识空间**：账号身份一律是**凭据引用名 ref**（`accountRef()` 的产物或用户手写的
* 引用名），存在条目的 `apiKeyEnv` 字段里 —— 沿用旧插件的字段名才能让两个命名空间里的
* 真实账号零迁移（设计 §5.1）。`label` 只用于展示，改名**绝不**重新推导 ref。
* 合成的默认槽**不是**一个真账号条目：`remove` 对它不写任何东西（幂等无操作），
* `rename` / `replaceKey` 对它抛 unknown account ref。
*
* **写回纪律**：改条目时按字段覆盖（改 `label`、保留其它字段），改数组时只摘除目标条目，
* 所以**存量文档里的其它字段与其它条目都原样保留**。本模块从不写入明文密钥：新条目只有
* `{ label, apiKeyEnv }`，`key` 一律走凭据服务。旧插件的条目允许内联 `apiKey` 字面量
* （Config schema 第 10062-10063 行），存量文档里如果有，本模块**不主动删**（删掉会让那个
* 账号静默失去密钥）—— 是否把它迁进凭据服务属于迁移决策，见任务报告。
*
* **修订号冲突**（Review Focus 5）：`mutate` 抛 `SETTINGS_CONFLICT` 时**重读 → 用新修订号
* 重放本次操作**，不覆盖对方的写入；`build` 每轮都拿刚读到的文档重算 ops，所以重放的
* 是「用户的操作」而不是过期的 ops。
*
* **意图与身份**：`add` 在 `append` **之前**解析出 ref 并写进意图（`{ kind: "add", ref, label }`），
* 提交用的就是同一个 ref —— 重放因此按 ref 对齐，不必按 label 猜（同名标签合法）。提交还会按
* **最新文档**再判一次身份（ref 已在账号表里就不再追加条目、不再写凭据槽），所以并发的同标签
* `add` 不会造出两个同 ref 的条目。所有不改状态就可能失败的校验都跑在 `append` 之前，日志里
* 不会留下永远应用不了的意图。
*
* 本任务**不**做：网页登录（Task 11）、客户端页面（计划 1b）、套餐过滤与费用估算（第 2 期）。
* @module dsh-llm-account/src/vendors/commandcode/accounts
*/
/** 设置命名空间（全局约束，不得更改）。 */
const COMMAND_CODE_SETTINGS_NS = "llm-commandcode";
/** 本端口所属的 provider 路由（ref 生成用的厂商段）。 */
const VENDOR$1 = "commandcode";
/** 顶层默认账号的凭据引用名（旧插件 `DEFAULT_API_KEY_ENV` 第 10030 行；也是 `apiKeyEnv` 的 schema 默认值）。 */
const DEFAULT_API_KEY_ENV = "COMMANDCODE_API_KEY";
/**
* `activeAccount` 的「自动轮换」取值（旧插件 `ACTIVE_ACCOUNT_AUTO` 第 9523 行；它自己的
* 界面把这个值渲染成「自动」，并且也把空串读作自动）。写它而不是空串，是为了让值是
* 自解释的字符串：消费方必须把 `"auto"` 与空串一视同仁。
*/
const ACTIVE_ACCOUNT_AUTO = "auto";
/**
* 旧插件的「默认槽」id（第 10130-10133 行 `slots()` 的第一项：`id: "default"`、
* `ref: credentialRef(apiKeyEnv ?? DEFAULT_API_KEY_ENV)`）。`activeAccount: "default"`
* 指的就是顶层 `apiKeyEnv` 那个账号 —— 用户现有配置里就写着它（零迁移）。
*/
const ACTIVE_ACCOUNT_DEFAULT = "default";
/** 账号条目的凭据引用字段（旧插件 Config schema 第 10059-10064 行）。 */
const REF_FIELD = "apiKeyEnv";
/** 账号条目的展示名称字段。 */
const LABEL_FIELD = "label";
/** 账号条目数组字段。 */
const ACCOUNTS_FIELD = "accounts";
/** 按模型绑定账号的规则数组字段。 */
const RULES_FIELD = "modelAccountRules";
/** 一条模型规则指向账号的字段（`ModelRule.account`）。 */
const RULE_ACCOUNT_FIELD = "account";
/** 当前固定账号字段。 */
const ACTIVE_FIELD = "activeAccount";
/** 手动排序覆盖（新字段；缺省时沿用「顶层默认账号 + accounts[]」的派生顺序）。 */
const ORDER_FIELD = "accountOrder";
/** 待清理凭据引用数组字段。 */
const CLEANUP_FIELD = "credentialCleanupRefs";
/**
* 自动切换开关字段（设计 §6.4.5：`autoSwitch` 落库是两家共用的可靠性机制）。与 opencode
* 同名字段；轮换引擎的门在入口的 `accountStateOf`（对同一份文档给出同一个答案）。
*/
const AUTO_SWITCH_FIELD = "autoSwitch";
/** ref 撞名时的后缀尝试上限（旧插件开通过程第 9108 行的同一条 128 次上限）。 */
const MAX_REF_ATTEMPTS = 128;
/**
* 修订号冲突后的重放轮数上限。冲突是并发写的正常结果，重读即可推进；给上限是为了
* 不在持续争用下无限循环，耗尽后把最后一次冲突错误抛给调用方。
*/
const MAX_CONFLICT_RETRIES = 8;
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$5(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 文档里的账号数组（形状不可信，非数组一律当空）。 */
function rawAccounts(value) {
	const accounts = value[ACCOUNTS_FIELD];
	return Array.isArray(accounts) ? accounts : [];
}
/** 文档里的规则数组（写回时原样保留非规则条目，只按 ref 摘除）。 */
function rawRules(value) {
	const rules = value[RULES_FIELD];
	return Array.isArray(rules) ? rules : [];
}
/** 文档里的待清理引用数组（写回时同样原样保留）。 */
function rawCleanupRefs(value) {
	const refs = value[CLEANUP_FIELD];
	return Array.isArray(refs) ? refs : [];
}
/** 读一个账号条目的 ref（存量的合法凭据引用名），读不到时为 `undefined`。 */
function refOf(item) {
	if (!isRecord$5(item)) return void 0;
	const ref = normalizeKey(item[REF_FIELD]);
	return ref !== void 0 && CREDENTIAL_REF_PATTERN.test(ref) ? ref : void 0;
}
/** 读一个账号条目的展示名称。 */
function labelOf(item) {
	if (!isRecord$5(item)) return void 0;
	return normalizeKey(item[LABEL_FIELD]);
}
/** 读一条模型规则挂在哪个账号上。 */
function ruleAccountOf(item) {
	if (!isRecord$5(item)) return void 0;
	return normalizeKey(item[RULE_ACCOUNT_FIELD]);
}
/** 文档里是否已有这个账号条目。 */
function hasAccount(value, ref) {
	return rawAccounts(value).some((item) => refOf(item) === ref);
}
/**
* 顶层默认账号的 ref：`apiKeyEnv`；缺省或非法时回落到内置默认名（旧插件 `slots()` 第
* 10130-10135 行的 `credentialRef(raw.apiKeyEnv ?? DEFAULT_API_KEY_ENV)` 同一读法）。
*/
function commandCodeDefaultRef(value) {
	const ref = normalizeKey(value[REF_FIELD]);
	return ref !== void 0 && CREDENTIAL_REF_PATTERN.test(ref) ? ref : DEFAULT_API_KEY_ENV;
}
/**
* 固定账号槽：**哨兵词汇只在这一个函数里决定**。入口的 `pinnedRefOf`（轮换引擎的固定账号与
* 应用期诊断）与端口的 `activeRefOf`（`list()` 的 active、`remove()` 的回落、`add()` 的返回）
* 都读它，所以「`"default"` 指顶层账号」这件事不可能在两个地方读成两种结果。
* @param value - 现读的设置文档。
* @returns 归一化后的槽判定。
*/
function commandCodeAccountSlot(value) {
	return readAccountSlot(value[ACTIVE_FIELD], {
		fallback: commandCodeDefaultRef(value),
		auto: ACTIVE_ACCOUNT_AUTO,
		legacyDefault: ACTIVE_ACCOUNT_DEFAULT
	});
}
/**
* 读当前固定账号；`undefined` 表示自动轮换（字段缺失、空串、`"auto"` 与认不出的坏值都算自动
* —— 坏值宁可轮换，也不能把请求指到一个不存在的凭据槽上）。
*/
function activeRefOf(value) {
	return commandCodeAccountSlot(value).pinned ?? void 0;
}
/** 标签必须是可展示的非空文本（空标签会渲染成一行没有名字的账号）。 */
function requireLabel(label) {
	const next = normalizeKey(label);
	if (next === void 0) throw new Error("llm-commandcode: account label must not be blank");
	return next;
}
/** 密钥必须是可用的非空文本（空值/纯空白永远不该写进凭据服务）。 */
function requireKey(key) {
	const next = normalizeKey(key);
	if (next === void 0) throw new Error("llm-commandcode: API key must not be blank");
	return next;
}
/** 修订号过期（`SettingsPort.mutate` 的约定错误形状）。 */
function isSettingsConflict(error) {
	return isRecord$5(error) && error.code === "SETTINGS_CONFLICT";
}
/** 未知账号 ref（改名/换 key/固定时用）。 */
function unknownRef(ref) {
	return /* @__PURE__ */ new Error(`llm-commandcode: unknown account ref "${ref}"`);
}
/**
* 给新账号挑一个未被占用的 ref：先是 `accountRef()` 的产物，撞名时按旧插件的办法加
* 数字后缀（`_2`、`_3`…）。
*
* 占用集合 = 现有账号条目的 ref ∪ 待清理的 ref ∪ 顶层默认凭据引用（旧插件开通过程
* 第 9099-9105 行的同一集合）。这条护栏是 Review Focus 1 的机器化保证：两个账号
* 永远不会共用同一个凭据槽，否则它们会互相污染失效标记与额度。
* @param value - 当前设置文档。
* @param label - 新账号的展示名称。
* @returns 未被占用的 ref。
*/
function freeRef(value, label) {
	const occupied = /* @__PURE__ */ new Set();
	for (const item of rawAccounts(value)) {
		const ref = refOf(item);
		if (ref !== void 0) occupied.add(ref);
	}
	for (const item of rawCleanupRefs(value)) {
		const ref = normalizeKey(item);
		if (ref !== void 0) occupied.add(ref);
	}
	const fallback = normalizeKey(value[REF_FIELD]);
	if (fallback !== void 0) occupied.add(fallback);
	const first = accountRef(VENDOR$1, label);
	if (!occupied.has(first)) return first;
	for (let suffix = 2; suffix <= MAX_REF_ATTEMPTS; suffix += 1) {
		const candidate = `${first}_${suffix}`;
		if (!occupied.has(candidate)) return candidate;
	}
	throw new Error(`llm-commandcode: no free credential reference for label "${label}"`);
}
/** Command Code 的账号端口（设置变更实现）。 */
/**
* 派生顺序（不含手动覆盖）：顶层默认账号 + `accounts[]`，按首次出现去重。
* @param value - 设置文档。
* @returns ref 顺序。
*/
function orderOf$1(value) {
	const refs = [];
	const seen = /* @__PURE__ */ new Set();
	for (const ref of [commandCodeDefaultRef(value), ...rawAccounts(value).map(refOf)]) {
		if (ref === void 0 || seen.has(ref)) continue;
		seen.add(ref);
		refs.push(ref);
	}
	return refs;
}
var CommandCodeAccounts = class {
	#deps;
	/**
	* @param deps - 设置、凭据与意图日志三个端口。
	*/
	constructor(deps) {
		this.#deps = deps;
	}
	/**
	* @returns 账号行视图：身份取自 `apiKeyEnv`，`configured` 来自凭据服务。
	*
	* **合成的默认槽在第一行**（旧插件 `slots()` 第 10130-10152 行的同一顺序）：顶层
	* `apiKeyEnv` 那个账号是轮换顺序的首项、也是 `activeAccount: "default"` 指的对象，但它不在
	* `accounts[]` 里 —— 只列 `accounts[]` 会让「正在服务请求的那个账号」既看不见、也固定不了。
	* 只有当真账号条目已经占用了这个 ref 时才不合成（same ref 的重复行不该出现）。
	*
	* **顺序不随固定账号重排**（刻意不同于 opencode 的 `moveFirst`）：Command Code 的轮换顺序
	* 首项是顶层默认账号，固定账号只是「先试它」而不是顺序的队首 —— 把它提到第一行会让列表
	* 顺序与真实轮换顺序脱钩（`usage-remote.accounts()` 的顺序同时是页面顺序与轮换顺序）。
	* 当前固定账号由 `active` 标记指认；顺序保持旧插件 `slots()` 的同一形状，与本家
	* `reorder: false` 的能力声明一致（测试锁死这一形状）。
	*/
	async list() {
		const snapshot = await this.#deps.settings.describe(COMMAND_CODE_SETTINGS_NS);
		const slot = commandCodeAccountSlot(snapshot.value);
		const views = [];
		views.push(...rawAccounts(snapshot.value).map((item) => ({
			ref: refOf(item),
			label: labelOf(item)
		})).filter((item) => item.ref !== void 0).map((item) => ({
			ref: item.ref,
			label: item.label ?? item.ref,
			configured: false,
			active: item.ref === slot.pinned
		})));
		const unique = dedupeByRef(views);
		const order = globalOrderOfVendor(unique.map((view) => view.ref), snapshot.value[ORDER_FIELD], VENDOR$1);
		const byRef = new Map(unique.map((view) => [view.ref, view]));
		const ordered = order.map((ref) => byRef.get(ref)).filter((view) => view !== void 0);
		const info = await this.#deps.credentials.describe(ordered.map((view) => view.ref));
		return ordered.map((view) => ({
			...view,
			configured: info[view.ref]?.configured === true
		}));
	}
	/**
	* 追加一个账号。
	*
	* **ref 在写意图之前解析**：它先进意图（`{ kind: "add", ref, label }`）、再进提交，
	* 提交用的就是这一个 ref。于是崩溃重放**按 ref 对齐**就够了 —— 同名标签合法（`_2`
	* 后缀），按 label 重新推导分不清「已提交但凭据没写成」「根本没提交」与「同名的存量
	* 账号」，会造出重复账号或把密钥写到错的账号上。
	*
	* **提交是幂等的**：每一轮（含冲突重试）都拿**刚读到的**文档再判一次身份 —— 冻结的
	* ref 已经在账号表里就不再追加第二个条目，也不再写凭据槽。同标签的并发 `add` 会因为
	* `accountRef` 的确定性而冻结到同一个 ref：没有这道闸门，两次调用会把同一个凭据槽写
	* 两遍（`list()` 的 `dedupeByRef` 只会把重复行藏起来，文档里仍然留着两条）。
	*
	* 所有**不改状态就可能失败**的校验（标签、密钥、没有空闲 ref）都跑在 `append` 之前，
	* 因此日志里不会留下一条永远应用不了的意图。真正写失败（凭据服务写失败、设置冲突重试
	* 用尽）才留下未决意图：重放能确认账号条目已经落地，但**补不回密钥** —— 那条账号会保持
	* `configured: false`，直到用户重新提供密钥（`replaceKey`）。带 `key` 时先提交账号条目、
	* 再写凭据服务（旧插件 `run()` → `store()` 的次序）。
	* @param input - 展示名称与可选密钥。
	* @returns 新账号的视图。
	*/
	async add(input) {
		const label = requireLabel(input.label);
		const key = input.key === void 0 ? void 0 : requireKey(input.key);
		const ref = freeRef((await this.#deps.settings.describe(COMMAND_CODE_SETTINGS_NS)).value, label);
		const document = await this.#transaction("add", {
			ref,
			label
		}, async () => {
			const { result: applied, value: current } = await this.#mutate((value) => {
				if (hasAccount(value, ref)) return {
					ops: [],
					result: false
				};
				const existing = rawAccounts(value);
				const ops = [{
					op: "set",
					path: [ACCOUNTS_FIELD],
					value: [...existing, {
						[LABEL_FIELD]: label,
						[REF_FIELD]: ref
					}]
				}];
				if (existing.length === 0 && activeRefOf(value) === null) ops.push({
					op: "set",
					path: [ACTIVE_FIELD],
					value: ref
				});
				return {
					ops,
					result: true
				};
			});
			if (applied && key !== void 0) await this.#deps.credentials.set(ref, key);
			return current;
		});
		return {
			ref,
			label,
			configured: (await this.#deps.credentials.describe([ref]))[ref]?.configured === true,
			active: activeRefOf(document) === ref
		};
	}
	/**
	* 只改展示名称。**绝不**重新推导 ref：ref 是账号的身份键，也是凭据槽名，重推会让顺序、
	* 规则、固定标记与凭据全部脱钩。
	* @param ref - 目标账号的 ref。
	* @param label - 新名称。
	*/
	async rename(ref, label) {
		const next = requireLabel(label);
		await this.#require(ref);
		await this.#transaction("rename", {
			ref,
			label: next
		}, () => this.#mutate((value) => ({
			ops: [{
				op: "set",
				path: [ACCOUNTS_FIELD],
				value: rawAccounts(value).map((item) => refOf(item) === ref && isRecord$5(item) ? {
					...item,
					[LABEL_FIELD]: next
				} : item)
			}],
			result: void 0
		})));
	}
	/**
	* 换密钥：只写凭据服务，设置文档一个字都不动（Global Constraints：文档里只允许出现
	* 凭据引用名）。与其它操作一样先写意图，凭据写入成功后才收尾。
	* @param ref - 目标账号的 ref。
	* @param key - 新密钥（空值/纯空白直接拒绝）。
	*/
	async replaceKey(ref, key) {
		const next = requireKey(key);
		await this.#require(ref);
		await this.#transaction("replace-key", { ref }, async () => {
			await this.#deps.credentials.set(ref, next);
		});
	}
	/**
	* 移除账号：条目、挂在该 ref 上的整条模型规则、必要时当前固定账号标记，并把 ref 记进
	* `credentialCleanupRefs`。**真正删凭据不在本操作内**：只记录，等清理动作确认该 ref 不再
	* 被引用后再 `credentials.unset`（旧插件 `cleanup` 第 9235-9242 行就是这个次序）。
	*
	* 幂等：ref 已不在账号表里时什么都不写（重放一次已提交的移除不会产生多余写入）。
	* @param ref - 目标账号的 ref。
	*/
	async remove(ref) {
		if (!hasAccount((await this.#deps.settings.describe("llm-commandcode")).value, ref)) return;
		await this.#transaction("remove", { ref }, () => this.#mutate((value) => {
			const ops = [
				{
					op: "set",
					path: [ACCOUNTS_FIELD],
					value: rawAccounts(value).filter((item) => refOf(item) !== ref)
				},
				{
					op: "set",
					path: [RULES_FIELD],
					value: rawRules(value).filter((item) => ruleAccountOf(item) !== ref)
				},
				{
					op: "set",
					path: [CLEANUP_FIELD],
					value: [...rawCleanupRefs(value).filter((item) => item !== ref), ref]
				},
				{
					op: "set",
					path: [ORDER_FIELD],
					value: orderOf$1(value).filter((item) => item !== ref)
				}
			];
			if (activeRefOf(value) === ref) ops.push({
				op: "set",
				path: [ACTIVE_FIELD],
				value: ACTIVE_ACCOUNT_AUTO
			});
			return {
				ops,
				result: void 0
			};
		}));
	}
	/**
	* 固定账号或回到自动轮换。
	*
	* 可选的目标包含**合成的默认槽**（顶层 `apiKeyEnv` 那个 ref，即使它不在 `accounts[]` 里）：
	* `list()` 会把它列成第一行，页面拿这一行的 ref 回来固定时必须成立。固定它写回旧插件的
	* 槽 id {@link ACTIVE_ACCOUNT_DEFAULT}，而不是把顶层 ref 写死成字面量 —— 用户现有文档
	* 因此一字不改，且以后改顶层 `apiKeyEnv` 时固定跟随默认槽，而不是钉在一个可能已经不在
	* 轮换顺序里的旧 ref 上。真实账号条目照旧写它自己的 ref。
	* @param ref - 目标账号的 ref；`null` 表示自动轮换。
	*/
	async select(ref) {
		let target = ACTIVE_ACCOUNT_AUTO;
		if (ref !== null) {
			const snapshot = await this.#deps.settings.describe(COMMAND_CODE_SETTINGS_NS);
			if (hasAccount(snapshot.value, ref)) target = ref;
			else if (ref === commandCodeDefaultRef(snapshot.value)) target = ACTIVE_ACCOUNT_DEFAULT;
			else throw unknownRef(ref);
		}
		await this.#transaction("select", ref === null ? {} : { ref }, () => this.#mutate(() => ({
			ops: [{
				op: "set",
				path: [ACTIVE_FIELD],
				value: target
			}],
			result: void 0
		})));
	}
	/**
	* 调整顺序：写 `accountOrder` 覆盖，**不改当前账号**。
	*
	* 与 `select` 的分工：排序只改「先试谁」的顺序，当前账号只由「切换到此账户」与切换策略决定。
	* 旧实现把排序与提首都塞进 `accounts`/`apiKeyEnv`，于是「排一下序」会顺带换号。
	* @param ref - 目标账号。
	* @param toIndex - 移动后的最终下标（越界夹到两端）。
	*/
	async move(ref, toIndex) {
		await this.#require(ref);
		await this.#transaction("move", {
			ref,
			toIndex
		}, () => this.#mutate((value) => {
			const current = orderOf$1(value);
			const next = reorder(current, ref, toIndex);
			if (next.join("\0") === current.join("\0")) return {
				ops: [],
				result: void 0
			};
			return {
				ops: [{
					op: "set",
					path: [ORDER_FIELD],
					value: next
				}],
				result: void 0
			};
		}));
	}
	/**
	* 写全局顺序（`vendor:ref`；两家文档保存同一份）。
	* @param order - 全局顺序键。
	*/
	async setOrder(order) {
		const clean = order.filter((key) => typeof key === "string" && key.trim() !== "");
		await this.#mutate(() => ({
			ops: [{
				op: "set",
				path: [ORDER_FIELD],
				value: clean
			}],
			result: void 0
		}));
	}
	/**
	* 写自动切换开关（设计 §6.4.5：`autoSwitch` 落库是两家共用的可靠性机制；2026-10-17 按
	* 交接文件 §4.2 的 C 项从 opencode 对齐过来，此前只有 opencode 实现）。
	*
	* 关闭后轮换只试当前账号 —— 固定账号；未固定时是轮换顺序的首项（顶层默认账号）—— 不再
	* 回落到其它账号；门在入口的 `accountStateOf`（对同一份文档给出同一个答案）。默认 `true`
	* 保持旧插件「额度耗尽总是回落」的行为（见入口 Config 的同名字段）。
	* @param value - 开关值。
	*/
	async setAutoSwitch(value) {
		await this.#transaction("auto-switch", { value }, () => this.#mutate(() => ({
			ops: [{
				op: "set",
				path: [AUTO_SWITCH_FIELD],
				value
			}],
			result: void 0
		})));
	}
	/**
	* 一次完整事务：先 `append` 意图，再交给 `submit`（通常是设置变更），全部成功后才
	* `settle`。顺序不能颠倒：崩溃时留下的未决意图正是重放的依据。
	* @param kind - 意图类型。
	* @param fields - 意图携带的 ref/label/value。
	* @param submit - 真正的提交动作。
	* @returns `submit` 的结果。
	*/
	async #transaction(kind, fields, submit) {
		const intent = this.#intent(kind, fields);
		await this.#deps.intents.append(intent);
		const result = await submit(intent);
		await this.#deps.intents.settle(intent.id);
		return result;
	}
	/**
	* 提交一次设置变更，带修订号冲突重放：每轮都重新 `describe` 拿最新修订号，并用最新
	* 文档重算 ops 后再提交。冲突时**不**覆盖对方的写入。
	*
	* `build` 针对**刚读到的**文档返回空 ops，表示这次操作在这个文档上已经成立（`add`
	* 发现冻结的 ref 已经存在就是这种情况）：直接返回，**不落盘**。这样「幂等的提交」不必
	* 伪造一次空写，也不会白白推进修订号去作废别人的写入。
	* @param build - 由最新文档算出 ops 与调用方要的结果。
	* @returns 调用方的结果与提交后的文档。
	*/
	async #mutate(build) {
		for (let attempt = 0;; attempt += 1) {
			const snapshot = await this.#deps.settings.describe(COMMAND_CODE_SETTINGS_NS);
			const { ops, result } = build(snapshot.value);
			if (ops.length === 0) return {
				result,
				value: snapshot.value
			};
			try {
				return {
					result,
					value: (await this.#deps.settings.mutate(COMMAND_CODE_SETTINGS_NS, ops, snapshot.revision)).value
				};
			} catch (error) {
				if (attempt >= MAX_CONFLICT_RETRIES || !isSettingsConflict(error)) throw error;
			}
		}
	}
	/** 确认账号存在；未知 ref 不该留下一条永远重放不了的意图。 */
	async #require(ref) {
		if (!hasAccount((await this.#deps.settings.describe("llm-commandcode")).value, ref)) throw unknownRef(ref);
	}
	/** 造一条带唯一 id 的意图（`createdAt` 仅供展示，不参与排序）。 */
	#intent(kind, fields) {
		return {
			id: randomUUID(),
			kind,
			createdAt: Date.now(),
			...fields.ref === void 0 ? {} : { ref: fields.ref },
			...fields.label === void 0 ? {} : { label: fields.label },
			...fields.value === void 0 ? {} : { value: fields.value },
			...fields.toIndex === void 0 ? {} : { toIndex: fields.toIndex }
		};
	}
};
/**
* 造一个 Command Code 账号端口（真源在设置文档，密钥走凭据服务）。
* @param deps - 设置、凭据与意图日志三个端口。
* @returns 账号端口；`reorder: true` 后 `move` 一并实现（写 `accountOrder` 覆盖）。
*/
function createCommandCodeAccounts(deps) {
	return new CommandCodeAccounts(deps);
}
//#endregion
//#region src/vendors/commandcode/catalog.ts
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$4(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 读取非空字符串（目录里的 id/name 必须是非空字符串才算有效）。 */
function stringValue$3(value) {
	return typeof value === "string" && value.trim() !== "" ? value : void 0;
}
/** 读取正数（上下文窗口与输出上限为 0 或负数时视为未公布）。 */
function positiveNumber$1(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
/**
* 从一行里取出模型数组：线上形状是 `{ object: "list", data: [...] }`，
* 缓存与搜索形状是 `{ models: [...] }`，两种都认。
* @param payload - 目录负载。
* @returns 待解析的原始行；形状不认识时为空数组。
*/
function rowsOf(payload) {
	if (Array.isArray(payload.models)) return payload.models;
	if (Array.isArray(payload.data)) return payload.data;
	return [];
}
/**
* 读出一行的输入模态。
*
* 只信负载自己声明的能力：`modalities` 数组里的 `"image"`，或布尔 `image: true`。
* 旧插件用一份 `KNOWN_IMAGE_MODELS` 常量表兜底（第 462 行起），本期不搬那份表 ——
* 未声明就是**未知**，不猜（与「额度缺失不倒成 0」同一条纪律）。
* @param row - 一行原始目录数据。
* @returns 至少含 `"text"` 的模态列表。
*/
function inputModalitiesOf(row) {
	const declared = row.modalities;
	if (Array.isArray(declared) && declared.includes("image") || row.image === true) return ["text", "image"];
	return ["text"];
}
/**
* 读出一行声明的推理档位。
*
* 只信负载自己声明的档位（`efforts` / `supported_efforts` / `reasoning_efforts`）；
* 旧插件用一份 `KNOWN_EFFORTS` 常量表兜底（第 115 行起、约 350 行数据），本期不搬 ——
* 未声明就是**未知**，不猜。
* @param row - 一行原始目录数据。
* @returns 档位 id（按负载顺序）；未声明时为空数组。
*/
function effortsOf(row) {
	const declared = row.efforts ?? row.supported_efforts ?? row.reasoning_efforts;
	if (!Array.isArray(declared)) return [];
	return declared.filter((item) => typeof item === "string" && item !== "");
}
/**
* 解析一份 Command Code 目录负载。
*
* 有效的行必须同时有非空 `id` 与非空 `name`（旧插件 `normalizeModel` 第 5218-5220 行
* 的同一道门槛）；其余行计入 `ignored`。`contextWindow` / `maxTokens` 缺失时**不写**
* 该字段，让「未公布」与「公布为 0」在数据上可区分。
*
* **展示名不用负载里的 `name`**：那份 name 带网关自己的标记（`DeepSeek V4.1 Flash (CC)`、
* `… (latest)`），与另两家的同一模型写法不同（2026-10-20 报障「模型名称又不一致了」）。
* name 只用来过上面那道门槛，展示名由 `assignUniqueNames` 统一从 id 派生。
* @param payload - 已解析的响应正文（形状不可信）。
* @returns 可用条目与被忽略的行数。
*/
function parseCatalog(payload) {
	if (!isRecord$4(payload)) return {
		entries: [],
		ignored: 0
	};
	const rows = rowsOf(payload);
	const entries = [];
	let ignored = 0;
	for (const raw of rows) {
		if (!isRecord$4(raw)) {
			ignored += 1;
			continue;
		}
		const id = stringValue$3(raw.id);
		const name = stringValue$3(raw.name);
		if (id === void 0 || name === void 0) {
			ignored += 1;
			continue;
		}
		const contextWindow = positiveNumber$1(raw.context_length ?? raw.contextWindow);
		const maxTokens = positiveNumber$1(raw.max_output_tokens ?? raw.maxTokens ?? raw.publishedMaxTokens);
		const efforts = effortsOf(raw);
		entries.push({
			id,
			...contextWindow === void 0 ? {} : { contextWindow },
			...maxTokens === void 0 ? {} : { maxTokens },
			...efforts.length === 0 ? {} : { efforts },
			inputModalities: inputModalitiesOf(raw)
		});
	}
	const names = assignUniqueNames(entries.map((entry) => entry.id));
	return {
		entries: entries.map((entry, index) => ({
			...entry,
			name: names[index] ?? entry.id
		})),
		ignored
	};
}
//#endregion
//#region src/vendors/commandcode/efforts.ts
/**
* Command Code 的**静态能力快照**：模型 → 可选推理档位。
*
* 为什么必须是静态表：网关的 `/provider/v1/models` 只公布 `reasoning: true|false`（这个模型
* 会不会思考），**从不公布档位** —— 2026-10-18 线上实测（两个账号、85 个模型），整份负载的键
* 只有 `id` / `name` / `reasoning` / `contextWindow` / `maxTokens`。档位只在官方 CLI 打包的
* 模型表（`command-code` 的 `dist/cli.mjs`）里；本表逐字对应该表，与旧插件
* `@mars-sea/dsh-commandcode-provider` 的 `KNOWN_EFFORTS`（在 command-code@1.79.2 上校验过）
* 完全一致。
*
* 用户可见后果（2026-10-18 报障「选择模型后仍然无法继续选择思考模式」）：宿主的思考档位
* 选择器完全由 `resolveModel().reasoning.efforts` 驱动 —— 不声明档位，等于这家模型没有档位
* 可选；而网关永远不声明，所以这份表就是唯一的档位来源。
*
* 纪律：表里没有的模型**就是不声明档位**（自动思考、由厂商决定深度的模型本来就没有可选档位，
* 旧插件的 `KNOWN_THINKING_MODELS` 就是这批 21 个）；猜一组档位只会换来一个发出去就被厂商
* 拒绝的请求。
* @module dsh-llm-account/src/vendors/commandcode/efforts
*/
/** 模型 id → 可选档位（数组顺序即界面顺序；取自官方 CLI 的模型表）。 */
const KNOWN_EFFORTS = {
	"Qwen/Qwen3.8-Max": [
		"low",
		"medium",
		"xhigh"
	],
	"Qwen/Qwen3.8-Max-0902": [
		"low",
		"medium",
		"xhigh"
	],
	"Qwen/Qwen3.8-27B": [
		"low",
		"medium",
		"xhigh"
	],
	"Qwen/Qwen3.8-Flash": [
		"low",
		"medium",
		"xhigh"
	],
	"Qwen/Qwen3.8-Omni-Flash": [
		"low",
		"medium",
		"xhigh"
	],
	"claude-fable-5-1": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"claude-fable-5": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"claude-opus-4-7": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"claude-opus-4-8": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"claude-opus-5": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"claude-sonnet-4-6": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"claude-sonnet-5": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"claude-sonnet-5-5": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"deepseek/deepseek-v4-flash-fast": [
		"low",
		"high",
		"max"
	],
	"deepseek/deepseek-v4.1-flash": [
		"off",
		"low",
		"high",
		"max"
	],
	"deepseek/deepseek-v4.1-flash-fast": [
		"off",
		"low",
		"high",
		"max"
	],
	"deepseek/deepseek-v4-flash": [
		"off",
		"high",
		"max"
	],
	"deepseek/deepseek-v4-flash-vision-exp": [
		"off",
		"high",
		"max"
	],
	"deepseek/deepseek-v4-pro": [
		"off",
		"high",
		"max"
	],
	"google/gemini-3.1-flash-lite": [
		"low",
		"medium",
		"high"
	],
	"google/gemini-3.5-flash": [
		"low",
		"medium",
		"high"
	],
	"google/gemini-3.5-flash-lite": [
		"low",
		"medium",
		"high"
	],
	"google/gemini-3.6-flash": [
		"low",
		"medium",
		"high"
	],
	"google/gemini-3.7-flash": [
		"low",
		"medium",
		"high"
	],
	"gpt-5.3-codex": [
		"low",
		"medium",
		"high",
		"xhigh"
	],
	"gpt-5.4": [
		"low",
		"medium",
		"high",
		"xhigh"
	],
	"gpt-5.4-mini": [
		"low",
		"medium",
		"high"
	],
	"gpt-5.5": [
		"low",
		"medium",
		"high",
		"xhigh"
	],
	"gpt-5.6-luna": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"gpt-5.6-sol": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"gpt-5.6-terra": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"moonshotai/Kimi-K3": [
		"low",
		"high",
		"max"
	],
	"google/gemini-3.8-flash": [
		"low",
		"medium",
		"high"
	],
	"sakana/fugu-ultra": ["high", "xhigh"],
	"stepfun/Step-5-Preview": [
		"low",
		"medium",
		"high"
	],
	"tencent/hy4-preview": [
		"low",
		"medium",
		"high"
	],
	"xai/grok-4.5": [
		"low",
		"medium",
		"high"
	],
	"xai/grok-4.6": [
		"low",
		"medium",
		"high",
		"xhigh"
	],
	"xai/grok-4.7": [
		"low",
		"medium",
		"high",
		"xhigh"
	],
	"z-ai/glm-5.3-flash": [
		"low",
		"high",
		"max"
	],
	"z-ai/glm-5.3-flashx": [
		"low",
		"high",
		"max"
	],
	"zai-org/GLM-5.2": ["high", "max"],
	"zai-org/GLM-5.3": [
		"low",
		"high",
		"max"
	],
	"meta/muse-spark-1.1": [
		"low",
		"medium",
		"high",
		"xhigh"
	],
	"meta/muse-spark-1.2": [
		"low",
		"medium",
		"high",
		"xhigh"
	],
	"meta/muse-spark-1.2-contributor": [
		"low",
		"medium",
		"high",
		"xhigh"
	],
	"meta/muse-spark-1.3": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"meta/muse-spark-1.3-contributor": [
		"low",
		"medium",
		"high",
		"xhigh"
	],
	"gpt-6-astra": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"claude-opus-5-5": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"gpt-6-luna": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"gpt-6-sol": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"MiniMaxAI/MiniMax-M3": [
		"low",
		"medium",
		"high"
	],
	"gpt-6.1-sol": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"inclusionai/ling-3.1-flash:free": [
		"low",
		"medium",
		"high"
	],
	"mistral/mistral-large-4": [
		"low",
		"medium",
		"high"
	],
	"claude-haiku-5-5": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"stealth/glyph-cluster:free": [
		"low",
		"medium",
		"high",
		"xhigh"
	]
};
/**
* 查一个模型的可选推理档位。
* @param model - 模型 id。
* @returns 档位列表；表里没有该模型时为 `undefined`（不猜）。
*/
function knownEfforts(model) {
	return Object.hasOwn(KNOWN_EFFORTS, model) ? KNOWN_EFFORTS[model] : void 0;
}
//#endregion
//#region src/vendors/commandcode/failures.ts
/**
* Command Code 原始失败到统一分类的映射表。
*
* 本模块是纯函数：只读入 HTTP 状态与已解析的错误正文，产出一个 {@link Rejection}；
* 不做 I/O、不持有状态、不认识账号。分类口径逐条对照旧插件
* `@mars-sea/dsh-commandcode-provider/lib/index.js` 的 `classifyAccountRejection`
* （第 3720-3735 行）、`readWindowLimitEvidence`（第 3753-3766 行）与
* `httpErrorCode`（第 3652-3657 行）：只有**账号级**失败才返回 Rejection
* （调用方据此换账号），请求本身被拒（400/403/404/409/422 的通用拒绝）返回
* `undefined`，避免把一个畸形请求在账号池里走一遍。
* @module dsh-llm-account/src/vendors/commandcode/failures
*/
/**
* 与状态无关的「本账号无法服务这次请求」结构化码（旧插件第 3714-3719 行）。
*
* 刻意不按状态过滤：5xx 携带这些码时同样要换账号而不是当瞬时故障重试，
* 因为同一个账号的同一个请求不可能成功。
*/
const UNAVAILABLE_CODES = /* @__PURE__ */ new Set([
	"USAGE_EXCEEDED",
	"INSUFFICIENT_CREDITS",
	"PREMIUM_CREDITS_EXHAUSTED",
	"MODEL_NOT_IN_PLAN"
]);
/**
* 旧插件在第 3733-3734 行对 4xx 正文做的散文扫描（下划线折成空格后小写匹配）。
* 供应商有时把结构化码写进人话里，只认码会漏判。
*/
const UNAVAILABLE_PROSE = [
	/insufficient credits/,
	/premium credits exhausted/,
	/model not in plan/,
	/insufficient (credit|balance)/,
	/out of credit/,
	/not (available|included)[^.]{0,40}plan/,
	/upgrade your plan/
];
/**
* 任何候选重置时刻最多允许领先当前时刻多久（30 天）。
*
* 对**所有**证据路径一视同仁：无论是供应商在 `error.rateLimit.reset` 里显式公布的
* 秒数（旧插件第 3756-3761 行），还是从错误文案里推断的 `resets at <ISO>` 时间戳
* （旧插件第 3761 行的过滤），只要落在 `now + 30 天` 之外就丢弃。取舍是
* 「宁可少停，不可多停」：一份单位混淆或伪造的远期 reset 会把一个健康账号**无限期**
* 钉出轮换（静默失效，正是本守卫要防的），而丢弃它只是退回
* `RATE_LIMIT_COOLDOWN_MS` 的短冷却，窗口真的重置后账号自愈。
* 代价：真实存在超过 30 天的窗口时会被忽略，该账号按短冷却重试而不是被停到窗口结束。
*/
const MAX_RESET_AHEAD_MS = 2592e6;
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 读取非空字符串字段。 */
function stringValue$2(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/** 读取有限数字字段。 */
function numberValue$2(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/**
* 归一化一份错误正文：优先读嵌套的 `error` 对象，没有则把正文本身当错误对象
* （旧插件 `parseProviderError` 第 3577-3597 行的 same-shape 读取）。
* @param body - 已解析（或字符串）的响应正文。
* @returns 诊断字段；无法识别时为 `{}`。
*/
function readProviderError(body) {
	const root = isRecord$3(body) ? body : void 0;
	const source = (root !== void 0 && isRecord$3(root.error) ? root.error : void 0) ?? root;
	if (source === void 0) return {};
	const result = {};
	const code = stringValue$2(source.code);
	const type = stringValue$2(source.type);
	const message = stringValue$2(source.message);
	if (code !== void 0) result.code = code;
	if (type !== void 0) result.type = type;
	if (message !== void 0) result.message = message;
	if (isRecord$3(source.rateLimit)) result.rateLimit = source.rateLimit;
	return result;
}
/**
* 把原始正文还原成用于扫描的文本。
*
* 旧插件全程在**原始响应文本**（`errText`）上做匹配：供应商会把结构化码、窗口文案、
* `resets at <ISO>` 时间戳放在 `error.message` 之外（平铺 `detail`、根级 `message`，
* 甚至纯文本正文）。只在 `error.message` 上扫描会把这些线索整条漏掉。
* @param body - 已解析的正文，或原始文本。
* @returns 原始文本；空正文/无法序列化时为 `""`。
*/
function rawTextOf(body) {
	if (typeof body === "string") return body;
	if (body === void 0 || body === null) return "";
	try {
		return JSON.stringify(body) ?? "";
	} catch {
		return "";
	}
}
/** 文案里的 `resets at <ISO>` 时间戳（旧插件第 3758 行）。 */
const RESET_STAMP = /resets at (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i;
/** 「用量窗口用尽」的文案（旧插件第 3757 行）。 */
const PLAN_WINDOW_WORDING = /usage limit for your plan/i;
/**
* 读窗口证据并算出重置时刻。
*
* 只有正文**点名窗口**（`error.rateLimit.window` 为 `fiveHour`/`weekly`/`daily`，
* 或文案写着 "usage limit for your plan"）才算「用量窗口用尽」；裸 429 是突发限流器
* 或消费上限，调用方不该据此宣称某个窗口用尽（旧插件第 3737-3766 行）。
*
* 重置时刻在所有证据路径上**统一**受 {@link MAX_RESET_AHEAD_MS} 约束：显式秒数字段与
* 文案 ISO 时间戳各自超出 30 天视野就被丢弃，`window` 仍然保留（分类不变，只是没有
* `resetAt`，调用方退回短冷却）。
*
* 文案匹配与旧插件第 3757-3758 行一致：先看 `error.message`，再回落到**整段原始正文**
* （`rawText`），因为窗口文案与时间戳可能落在 `error.message` 之外。
* @param parsed - 已归一化的错误字段。
* @param now - 判定 30 天视野的当前时刻（epoch 毫秒）；由调用方注入，便于测试确定。
* @param rawText - 原始响应正文；`error.message` 之外的第二条扫描路径。
* @returns 窗口名（未被点名时为 `undefined`）与重置时刻（epoch 毫秒）。
*/
function readWindowLimitEvidence(parsed, now, rawText) {
	const named = stringValue$2(parsed.rateLimit?.window);
	const message = parsed.message ?? "";
	const seconds = numberValue$2(parsed.rateLimit?.reset);
	const window = named === "fiveHour" || named === "weekly" || named === "daily" ? named : PLAN_WINDOW_WORDING.test(message) || PLAN_WINDOW_WORDING.test(rawText) ? /weekly/i.test(message) || /weekly/i.test(rawText) ? "weekly" : "fiveHour" : void 0;
	const horizon = now + MAX_RESET_AHEAD_MS;
	const withinHorizon = (value) => Number.isFinite(value) && value > now && value <= horizon;
	const published = seconds !== void 0 && seconds > 0 ? Math.round(seconds * 1e3) : void 0;
	if (published !== void 0 && withinHorizon(published)) return {
		window,
		resetAt: published
	};
	const stamp = RESET_STAMP.exec(message)?.[1] ?? RESET_STAMP.exec(rawText)?.[1];
	if (stamp === void 0) return { window };
	const parsedStamp = Date.parse(stamp);
	if (Number.isNaN(parsedStamp) || !withinHorizon(parsedStamp)) return { window };
	return {
		window,
		resetAt: parsedStamp
	};
}
/**
* Command Code 状态/正文 → 统一失败分类（Task 5 的 {@link Rejection}）。
*
* 口径（与旧插件逐条对照）：
* - `status <= 0`：请求根本没拿到响应（连接失败、DNS、代理）→ `network`。
* - 401 → `invalid-credential`（该账号退出轮换，只有换 key 能清除）。
* - 429 或码 `RATE_LIMITED` → `rate-limit`；正文点名窗口且给出 30 天视野内的重置时刻时带上 `resetAt`。
* - 码落在 {@link UNAVAILABLE_CODES} → `unavailable`（不按状态过滤）。
* - 4xx 正文命中散文表 → `unavailable`（扫描整段原始正文，不只看 `error.message`）。
* - 408 / 5xx → `server`（瞬时，不污染账号状态）。
* - 其余 4xx → `undefined`：请求本身被拒，换账号没有意义。
* @param status - HTTP 状态码；`0`（或负数）表示未拿到响应。
* @param body - 已解析的响应正文，或原始文本。
* @param now - 判定 30 天重置视野的当前时刻（epoch 毫秒）；缺省读系统时钟（测试可注入）。
* @returns 账号级失败分类；请求级（不可轮换）拒绝时为 `undefined`。
*/
function classifyCommandCodeFailure(status, body, now = Date.now()) {
	const parsed = readProviderError(body);
	const rawText = rawTextOf(body);
	const code = (parsed.code ?? parsed.type)?.toUpperCase();
	if (status <= 0 && code === void 0) return rejection("network", `Command Code 请求未获得响应：${parsed.message ?? "连接失败（网络或代理问题）"}，已按瞬时故障处理`);
	if (status === 429 || code === "RATE_LIMITED") {
		const evidence = readWindowLimitEvidence(parsed, now, rawText);
		const detail = evidence.window === void 0 ? "服务商未报告用量窗口用尽" : `用量窗口 ${evidence.window} 已用尽`;
		const when = evidence.resetAt === void 0 ? "，没有可用的重置时间（未公布，或公布的重置时间超出 30 天视野），按短冷却处理" : `，重置时间 ${new Date(evidence.resetAt).toISOString()}`;
		return rejection("rate-limit", `Command Code 返回 429：当前账号被限流（${detail}）${when}`, evidence.resetAt);
	}
	if (status === 401) return rejection("invalid-credential", `Command Code 返回 401：该账号的 API 密钥缺失或无效，请重新登录或更换密钥`);
	if (code !== void 0 && UNAVAILABLE_CODES.has(code)) return rejection("unavailable", `Command Code 拒绝了本次请求（${code}）：该账号的余额或套餐无法服务这个模型`);
	if (status <= 0) return rejection("network", `Command Code 请求未获得响应（${code ?? "未知码"}），已按瞬时故障处理`);
	if (status >= 400 && status < 500) {
		const lower = rawText.toLowerCase().replaceAll("_", " ");
		if (UNAVAILABLE_PROSE.some((pattern) => pattern.test(lower))) return rejection("unavailable", `Command Code 拒绝了本次请求（HTTP ${status}）：该账号的余额或套餐无法服务这个模型`);
		return;
	}
	if (status === 408 || status >= 500) return rejection("server", `Command Code 上游暂时无法完成请求（HTTP ${status}），已按瞬时故障处理`);
}
/**
* 分类到宿主错误码的映射。dsh-llm-retry 只按错误码（不按状态）决定重试，
* 所以这里必须让瞬时/可恢复的分类落在重试白名单里（见 `adapter.providerRetryPolicy`）。
*/
const FAILURE_CODES = {
	quota: "QUOTA",
	"rate-limit": "RATE_LIMIT",
	"invalid-credential": "INVALID_CREDENTIAL",
	unavailable: "PROVIDER_HTTP_ERROR",
	server: "SERVER",
	network: "TRANSPORT"
};
/**
* 把一次拒绝翻译成宿主认识的 `LlmError`（保留原始 HTTP 状态与 cause）。
* @param value - 已分类的拒绝。
* @param status - 观察到的 HTTP 状态；未拿到响应时省略。
* @param cause - 原始异常（网络异常时保留，便于诊断）。
* @returns 带稳定 `code` 的宿主错误。
*/
function commandCodeLlmError(value, status, cause) {
	const options = {
		...status !== void 0 && status > 0 ? { status } : {},
		...cause !== void 0 ? { cause } : {}
	};
	return new LlmError(value.message, FAILURE_CODES[value.kind], options);
}
//#endregion
//#region src/vendors/commandcode/protocol.ts
/**
* Command Code 线协议：端点、请求头、传输选择与回退、请求体构造、SSE 解码。
*
* 一切形状逐条对照旧插件 `@mars-sea/dsh-commandcode-provider/lib/index.js`
* （行号写在各定义上方）。本模块**只**做线协议：不认识账号、额度、设置，也不做
* 时间预算（那是 `src/core/transport.ts` 的 `runStream`）。
*
* 传输回退顺序（旧插件 `stream()` 第 7506-7519 行）：
* 1. 按模型选初始协议（`claude-*` 强制 Messages，其余 Chat Completions）；
* 2. 403 且正文是 `upgrade_required` 一类的套餐网关拒绝时，同一账号改用 CLI 传输重发一次；
* 3. 其余失败交给适配器的失败分类（不在这里换账号）。
* @module dsh-llm-account/src/vendors/commandcode/protocol
*/
/** 网关默认基地址（旧插件第 5361 行）。 */
const DEFAULT_API_BASE = "https://api.commandcode.ai";
/** CLI 版本头 `x-command-code-version` 的取值（旧插件第 5360 行）。 */
const COMMAND_CODE_CLI_VERSION = "1.79.2";
/** 目录端点路径（旧插件第 6788 行）。 */
const MODELS_PATH = "/provider/v1/models";
/** CLI 传输端点路径（旧插件 `protocolEndpoint` 第 6651 行）。 */
const CLI_GENERATE_PATH = "/alpha/generate";
/** Messages 传输端点路径。 */
const MESSAGES_PATH = "/provider/v1/messages";
/** Chat Completions 传输端点路径。 */
const CHAT_COMPLETIONS_PATH = "/provider/v1/chat/completions";
/** 默认整请求 deadline（旧插件配置默认值 `requestTimeoutMs` 第 10096 行）。 */
const DEFAULT_REQUEST_TIMEOUT_MS = 3e5;
/** 默认流空闲看门狗（旧插件配置默认值 `streamIdleTimeoutMs` 第 10097 行）。 */
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
/** 默认输出上限（旧插件 `DEFAULT_GENERATE_MAX_TOKENS` 第 5390 行）。 */
const DEFAULT_GENERATE_MAX_TOKENS = 131072;
/** 身份传输头：中间压缩会破坏 SSE 的逐字节时间语义（旧插件第 2915 行）。 */
const IDENTITY_ENCODING_HEADER = { "accept-encoding": "identity" };
/**
* 线上只接受 Messages 端点的模型（旧插件 `MESSAGES_ONLY_MODELS` 第 673-684 行）。
* 目录声明了 `supported_endpoints` 时以目录为准，这里是兜底。
*/
const MESSAGES_ONLY_MODELS = /* @__PURE__ */ new Set([
	"claude-sonnet-5-5",
	"claude-sonnet-5",
	"claude-sonnet-4-6",
	"claude-fable-5-1",
	"claude-fable-5",
	"claude-opus-5-5",
	"claude-opus-5",
	"claude-opus-4-8",
	"claude-opus-4-7",
	"claude-haiku-4-5-20251001"
]);
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 读取非空字符串。 */
function stringValue$1(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/** 读取有限数字。 */
function numberValue$1(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/** 去掉基地址末尾的斜杠（旧插件在搜索路径上做同样的归一化，第 9438 行）。 */
function trimBase$1(base) {
	return base.replace(/\/+$/, "");
}
/**
* 一条协议对应的端点（旧插件 `protocolEndpoint` 第 6650-6653 行）。
* @param protocol - 线协议。
* @param base - 网关基地址。
* @returns 绝对端点 URL。
*/
function protocolEndpoint(protocol, base) {
	const root = trimBase$1(base);
	if (protocol === "cli") return `${root}${CLI_GENERATE_PATH}`;
	return protocol === "messages" ? `${root}${MESSAGES_PATH}` : `${root}${CHAT_COMPLETIONS_PATH}`;
}
/**
* 该模型是否只能走 Messages 端点（旧插件第 686-688 行：目录声明的
* `supported_endpoints` 优先，`claude-*` 兜底）。
* @param model - 模型 id。
* @param supportedEndpoints - 目录为该模型声明的端点；缺省表示目录没说。
* @returns 是否必须走 Messages。
*/
function requiresMessagesEndpoint(model, supportedEndpoints) {
	if (supportedEndpoints !== void 0 && supportedEndpoints.length > 0) return supportedEndpoints.includes("/messages") && !supportedEndpoints.includes("/chat/completions");
	return MESSAGES_ONLY_MODELS.has(model) || model.startsWith("claude-");
}
/**
* 选择本次请求的初始协议（旧插件 `resolveProtocol` 第 7176-7188 行的模型与强制项
* 部分；按账号缓存的账单分层（Go 套餐 → CLI）需要额度数据，属于 Task 10）。
* @param input - 模型、可选强制协议与目录声明的端点。
* @returns 初始协议。
*/
function resolveProtocol(input) {
	if (input.forced === "cli") return "cli";
	if (requiresMessagesEndpoint(input.model, input.supportedEndpoints)) return "messages";
	return "openai";
}
/**
* 该拒绝是否是「Go 套餐没有 Provider API 访问权」的网关闸门 —— 唯一应当回退到
* CLI 传输的拒绝类别（旧插件 `isUpgradeRequiredError` 第 3774-3784 行）。
* @param status - HTTP 状态。
* @param body - 已解析的正文，或原始文本。
* @returns 是否回退到 CLI 传输。
*/
function isUpgradeRequired(status, body) {
	if (status !== 403) return false;
	let text;
	if (typeof body === "string") text = body;
	else try {
		text = JSON.stringify(body ?? "");
	} catch {
		text = "";
	}
	const lower = text.toLowerCase();
	if (lower.includes("upgrade_required")) return true;
	if (lower.includes("go plan") && lower.includes("api access")) return true;
	if (lower.includes("only plan without api access")) return true;
	return lower.includes("upgrade to goat or higher");
}
/**
* 由工作目录推导 CLI 传输的 `x-project-slug`（旧插件 `projectSlugFromPath` 第 5715-5717 行）。
* @param pathName - 工作目录。
* @returns 小写、以连字符分隔的 slug；无法推导时为 `"project"`。
*/
function projectSlugFromPath(pathName) {
	const slug = pathName.toLowerCase().replace(/^[a-z]:/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
	return slug === "" ? "project" : slug;
}
/**
* 目录请求（旧插件 `GatewayFacts` 第 6788-6792 行）：不带 Authorization，
* 只带 `accept`、身份编码与 attribution 头。
* @param base - 网关基地址。
* @returns URL 与请求头。
*/
function catalogRequest(base) {
	return {
		url: `${trimBase$1(base)}${MODELS_PATH}`,
		headers: {
			accept: "application/json",
			...IDENTITY_ENCODING_HEADER,
			...attributionHeaders()
		}
	};
}
/**
* 生成请求的头与 URL（旧插件 `connectGenerate` 第 6720-6737 行）：共享头是
* `Content-Type` + 身份编码 + `Authorization` + attribution；CLI 传输额外带版本、
* 环境、项目 slug、体验开关；另两条传输带 `Accept: text/event-stream`。
* @param input - 协议、基地址、密钥、已序列化请求体与可选工作目录。
* @returns 可直接交给 `fetch` 的 URL、请求头与请求体。
*/
function generateRequest(input) {
	const shared = {
		"Content-Type": "application/json",
		...IDENTITY_ENCODING_HEADER,
		Authorization: `Bearer ${input.key}`,
		...attributionHeaders()
	};
	if (input.protocol === "cli") return {
		url: protocolEndpoint("cli", input.base),
		headers: {
			...shared,
			"x-command-code-version": COMMAND_CODE_CLI_VERSION,
			"x-cli-environment": "production",
			"x-project-slug": projectSlugFromPath(input.workingDir ?? process.cwd()),
			"x-taste-learning": "false",
			"x-co-flag": "false"
		},
		body: input.body
	};
	return {
		url: protocolEndpoint(input.protocol, input.base),
		headers: {
			...shared,
			Accept: "text/event-stream"
		},
		body: input.body
	};
}
/** 把一段内容压成纯文本（文件/图片块属于第 3 期，这里只取文本块）。 */
function textOf$1(content) {
	const parts = [];
	for (const block of content) if (block.type === "text") parts.push(block.text);
	return parts.join("");
}
/** 把 `tool.parameters` 包成对象（宿主已保证它是对象）。 */
function toolSchema(parameters) {
	return {
		type: "object",
		properties: {},
		additionalProperties: true,
		...parameters
	};
}
/** Chat Completions 的 messages 数组（旧插件 `buildOpenAIBody` 第 6564-6586 行）。 */
function openAiMessages(messages) {
	const out = [];
	for (const message of messages) {
		if (message.role === "system" || message.role === "developer") continue;
		if (message.role === "user") {
			out.push({
				role: "user",
				content: textOf$1(message.content)
			});
			continue;
		}
		if (message.role === "assistant") {
			const calls = message.content.filter((block) => block.type === "tool-call");
			const text = textOf$1(message.content);
			out.push({
				role: "assistant",
				content: text,
				...calls.length === 0 ? {} : { tool_calls: calls.map((call) => ({
					id: call.id,
					type: "function",
					function: {
						name: call.name,
						arguments: call.arguments
					}
				})) }
			});
			continue;
		}
		out.push({
			role: "tool",
			tool_call_id: message.toolCallId,
			content: textOf$1(message.content)
		});
	}
	return out;
}
/**
* Messages 的 messages 数组（旧插件 `buildMessagesBody` 第 6617-6641 行的消息部分）。
* 相邻同角色消息合并，避免上游对连续 user 消息的校验失败。
*/
function anthropicMessages(messages) {
	const out = [];
	const push = (role, blocks) => {
		const last = out.at(-1);
		if (last !== void 0 && last.role === role) last.content.push(...blocks);
		else out.push({
			role,
			content: blocks
		});
	};
	for (const message of messages) {
		if (message.role === "system" || message.role === "developer") continue;
		if (message.role === "user") {
			push("user", [{
				type: "text",
				text: textOf$1(message.content)
			}]);
			continue;
		}
		if (message.role === "assistant") {
			const blocks = [];
			const text = textOf$1(message.content);
			if (text !== "") blocks.push({
				type: "text",
				text
			});
			for (const block of message.content) {
				if (block.type !== "tool-call") continue;
				blocks.push({
					type: "tool_use",
					id: block.id,
					name: block.name,
					input: parseToolArguments(block.arguments)
				});
			}
			if (blocks.length > 0) push("assistant", blocks);
			continue;
		}
		push("user", [{
			type: "tool_result",
			tool_use_id: message.toolCallId,
			content: textOf$1(message.content),
			is_error: message.isError === true
		}]);
	}
	return out;
}
/** 工具的 arguments 是原始 JSON 字符串，Messages 线上要对象（旧插件第 6261-6268 行）。 */
function parseToolArguments(raw) {
	try {
		const parsed = JSON.parse(raw);
		return isRecord$2(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
/** CLI 传输的 system 段形状（旧插件 `cliSystem` 第 6475-6482 行）。 */
function cliSystem(systemText) {
	if (systemText === "") return "";
	return [{
		type: "text",
		text: systemText,
		cache_control: { type: "ephemeral" }
	}];
}
/**
* CLI 传输的 threadId（旧插件 `cliThreadId` 第 6457-6465 行做 sha1 派生；本期先用
* 会话 id 本身或随机 UUID —— 派生细节属于第 2 期的缓存对齐项）。
*/
function cliThreadId(sessionId) {
	if (sessionId !== void 0 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return sessionId;
	return randomUUID();
}
/**
* 构造一次请求的请求体（三条传输各自的线上形状）。
*
* **本期范围**：文本、工具声明与工具调用/结果；图片与文件投影、缓存断点、
* `max_tokens` 自学习收紧属于第 2/3 期（设计 §15）。
* @param protocol - 目标传输。
* @param options - 宿主的完整请求。
* @param facts - 由适配器算出的请求事实。
* @returns 可 `JSON.stringify` 的请求体。
*/
function buildRequestBody(protocol, options, facts) {
	const tools = options.tools ?? [];
	if (protocol === "openai") return {
		model: options.model,
		messages: [...facts.systemText === "" ? [] : [{
			role: "system",
			content: facts.systemText
		}], ...openAiMessages(options.messages)],
		...tools.length === 0 ? {} : { tools: tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: toolSchema(tool.parameters)
			}
		})) },
		max_tokens: facts.maxTokens,
		temperature: options.temperature ?? .3,
		stream: true,
		...options.stop === void 0 || options.stop.length === 0 ? {} : { stop: [...options.stop] },
		...facts.reasoningEffort === void 0 ? {} : { reasoning_effort: facts.reasoningEffort }
	};
	if (protocol === "messages") return {
		model: options.model,
		max_tokens: facts.maxTokens,
		stream: true,
		...options.stop === void 0 || options.stop.length === 0 ? {} : { stop_sequences: [...options.stop] },
		...facts.selectableEffort === true ? { thinking: { type: "adaptive" } } : {},
		messages: anthropicMessages(options.messages),
		...facts.systemText === "" ? {} : { system: [{
			type: "text",
			text: facts.systemText,
			cache_control: { type: "ephemeral" }
		}] },
		...facts.reasoningEffort === void 0 ? {} : { output_config: { effort: facts.reasoningEffort } },
		...tools.length === 0 ? {} : { tools: tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			input_schema: toolSchema(tool.parameters)
		})) }
	};
	return {
		config: {
			workingDir: facts.workingDir ?? process.cwd(),
			date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
			environment: `${process.platform}-${process.arch}, Node.js ${process.version}`,
			structure: [],
			isGitRepo: false,
			currentBranch: "",
			mainBranch: "",
			gitStatus: "",
			recentCommits: []
		},
		memory: null,
		taste: null,
		skills: null,
		permissionMode: "standard",
		params: {
			model: options.model,
			messages: openAiMessages(options.messages),
			tools: tools.map((tool) => ({
				type: "function",
				name: tool.name,
				description: tool.description,
				input_schema: toolSchema(tool.parameters)
			})),
			system: cliSystem(facts.systemText),
			max_tokens: facts.maxTokens,
			temperature: options.temperature ?? .3,
			stream: true,
			...facts.reasoningEffort === void 0 ? {} : { reasoning_effort: facts.reasoningEffort }
		},
		threadId: cliThreadId(facts.sessionId)
	};
}
/**
* 流中途报告的拒绝（SSE `error` 事件或非 2xx 响应）。
*
* 刻意不是 `LlmError`：它承载的是「厂商原始状态 + 原始正文」，由适配器用
* {@link classifyCommandCodeFailure} 统一分类；直接抛给宿主会丢掉分类所需的证据。
*/
var CommandCodeStreamFailure = class extends Error {
	/** 厂商给出的 HTTP 状态；流中途事件未带状态时为 `0`。 */
	status;
	/** 厂商给出的原始错误正文。 */
	body;
	/**
	* @param status - HTTP 状态；`0` 表示事件里没带。
	* @param body - 原始错误正文。
	*/
	constructor(status, body) {
		super(`Command Code stream error (status ${status})`);
		this.name = "CommandCodeStreamFailure";
		this.status = status;
		this.body = body;
	}
};
/** 把一次 SSE `error` 事件/正文转成 {@link CommandCodeStreamFailure}。 */
function streamFailure(body) {
	return new CommandCodeStreamFailure(isRecord$2(body) ? numberValue$1(body.statusCode) ?? numberValue$1(body.status) ?? 0 : 0, body);
}
/** Chat Completions 的 usage 形状 → 宿主计数（缓存命中要从 prompt 里减出来）。 */
function openAiUsage(raw) {
	if (!isRecord$2(raw)) return void 0;
	const prompt = numberValue$1(raw.prompt_tokens) ?? 0;
	const cached = numberValue$1((isRecord$2(raw.prompt_tokens_details) ? raw.prompt_tokens_details : void 0)?.cached_tokens) ?? 0;
	const completion = numberValue$1(raw.completion_tokens) ?? 0;
	const usage = {
		inputTokens: Math.max(0, prompt - cached),
		outputTokens: completion,
		cacheReadTokens: cached
	};
	const total = numberValue$1(raw.total_tokens);
	if (total !== void 0) usage.totalTokens = total;
	return usage;
}
/**
* Messages 的 usage 形状 → 宿主计数（Anthropic 的 input 已不含缓存读写）。
*
* 每个字段先看本次负载，缺失则沿用 `previous`（旧插件 `mapMessagesUsage` 第 4655-4669 行）：
* 网关实测的 `message_delta.usage` 可能**只有输出计数**，输入/缓存计数只出现在
* `message_start.message.usage`；不合并就会把已知的输入计数读成 0（项目约束：
* 缺失字段绝不能被当成 0）。
* @param raw - 本次事件的 usage 负载。
* @param previous - 同一响应里此前已见过的 usage（`message_start` 的）。
* @returns 宿主计数字段；本次负载不是对象时为 `undefined`。
*/
function messagesUsage(raw, previous) {
	if (!isRecord$2(raw)) return void 0;
	const input = numberValue$1(raw.input_tokens) ?? previous?.inputTokens ?? 0;
	const output = numberValue$1(raw.output_tokens) ?? previous?.outputTokens ?? 0;
	const cacheRead = numberValue$1(raw.cache_read_input_tokens) ?? previous?.cacheReadTokens ?? 0;
	const cacheWrite = numberValue$1(raw.cache_creation_input_tokens) ?? previous?.cacheWriteTokens ?? 0;
	const usage = {
		inputTokens: Math.max(0, input),
		outputTokens: output,
		cacheReadTokens: cacheRead
	};
	if (cacheWrite > 0) usage.cacheWriteTokens = cacheWrite;
	const reasoning = numberValue$1((isRecord$2(raw.output_tokens_details) ? raw.output_tokens_details : void 0)?.thinking_tokens) ?? previous?.reasoningTokens;
	if (reasoning !== void 0) usage.reasoningTokens = reasoning;
	return usage;
}
/** CLI 传输的 totalUsage 形状 → 宿主计数（旧插件第 4521-4536 行）。 */
function cliUsage(raw) {
	if (!isRecord$2(raw)) return void 0;
	const details = isRecord$2(raw.inputTokenDetails) ? raw.inputTokenDetails : void 0;
	const totalInput = numberValue$1(raw.inputTokens) ?? 0;
	const cacheRead = numberValue$1(details?.cacheReadTokens) ?? 0;
	const cacheWrite = numberValue$1(details?.cacheWriteTokens) ?? 0;
	const usage = {
		inputTokens: numberValue$1(details?.noCacheTokens) ?? Math.max(0, totalInput - cacheRead - cacheWrite),
		outputTokens: numberValue$1(raw.outputTokens) ?? 0,
		cacheReadTokens: cacheRead,
		cacheWriteTokens: cacheWrite
	};
	const reasoning = numberValue$1((isRecord$2(raw.outputTokenDetails) ? raw.outputTokenDetails : void 0)?.reasoningTokens) ?? numberValue$1(raw.reasoningTokens);
	if (reasoning !== void 0) usage.reasoningTokens = reasoning;
	return usage;
}
/**
* 线上的结束原因 → 宿主结束原因（两套词汇表共用）。
*
* `length` / `max_tokens` 的特殊处理（与 opencode 的 `toHostFinishReason` 对齐）：打到输出上限
* **却一个字都没产出**时，不能伪装成正常的 `max-tokens` 收尾 —— 空响应会让这一轮什么都不说地
* 结束，且多半是提示词/上下文把回答空间挤没了，重试续写无济于事。此时报 `INVALID_REQUEST`
* （带可执行建议），宿主不重试、不换账号。
* @param raw - 线上原始结束原因（大小写敏感，按厂商原样传）。
* @param producedContent - 本流是否真的产出过内容（文本/推理/工具调用）；`finish` 调用前由
*   装配器据累计状态判定，调用方无需自己算。
*/
function mapFinishReason(raw, producedContent) {
	switch (raw) {
		case "tool_calls":
		case "function_call":
		case "tool_use": return { kind: "tool-calls" };
		case "length":
		case "max_tokens":
			if (!producedContent) return {
				kind: "error",
				failure: {
					message: "the model produced no content at its output cap (finish_reason \"length\"). The prompt may leave too little room for an answer. Compact the context or raise this model's max output, then retry",
					code: "INVALID_REQUEST"
				}
			};
			return { kind: "max-tokens" };
		default: return { kind: "stop" };
	}
}
/** 一次 usage 计入的 token 总数（缺 `totalTokens` 时按分项相加，缺分项按 0）。 */
function usageTotalOf(usage) {
	return usage.totalTokens ?? usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}
/**
* 一条 chunk 是否代表「流真的产出了东西」。
*
* 口径 = 旧插件 `asm.sawContent`（文本/推理/工具调用，第 4405-4800 行）+ 非零 usage：
* 用来在**没有任何终止事件**的情况下区分「空响应」（必须报可重试错误）与
* 「有内容但被截断」（补一条 finish）。
* @param chunk - 已装配好、即将交给宿主的 chunk。
* @returns 是否算作内容。
*/
function chunkIsContent(chunk) {
	switch (chunk.type) {
		case "text-delta":
		case "reasoning-delta": return chunk.text !== "";
		case "tool-call-delta": return chunk.argumentsDelta !== "" || chunk.name !== "";
		case "block-end": return chunk.block.type === "tool-call";
		case "usage": return usageTotalOf(chunk.usage) > 0;
		default: return false;
	}
}
/**
* 块装配器：把一个响应的增量拼成宿主的分块事件流（`block-start` / `*-delta` /
* `block-end`），并保证同一时间只有一个文本块与一个推理块处于打开状态。
*/
var StreamAssembler = class {
	#nextIndex = 0;
	#textIndex = -1;
	#text = "";
	#reasoningIndex = -1;
	#reasoning = "";
	#openAiTools = [];
	#messagesBlocks = /* @__PURE__ */ new Map();
	/** `message_start` 的 usage：`message_delta` 只带输出计数时靠它补齐输入/缓存计数。 */
	#messagesUsage;
	/** usage 已交出的标志：宿主拒绝第二条 usage chunk（`dsh-llm` 的流不变式）。 */
	#messagesUsageEmitted = false;
	/** `message_delta` 记下的结束原因；真正的 finish 由 `message_stop` 发出。 */
	#messagesFinishReason;
	/** 是否已经交出过终止 finish：EOF 兜底不得再补第二条。 */
	#finished = false;
	/**
	* 本流是否真的产出过内容（文本/推理/工具调用）。`length`/`max_tokens` 结束原因且本值为
	* `false` 时，表示打到输出上限却一个字都没产出 —— 此时不能伪装成正常的 `max-tokens` 收尾。
	*/
	#producedContent = false;
	#openText() {
		if (this.#textIndex >= 0) return [];
		this.#textIndex = this.#nextIndex;
		this.#nextIndex += 1;
		return [{
			type: "block-start",
			index: this.#textIndex,
			blockType: "text"
		}];
	}
	#openReasoning() {
		if (this.#reasoningIndex >= 0) return [];
		this.#reasoningIndex = this.#nextIndex;
		this.#nextIndex += 1;
		return [{
			type: "block-start",
			index: this.#reasoningIndex,
			blockType: "reasoning"
		}];
	}
	/** 关闭文本块并交出装配好的内容。 */
	closeText() {
		if (this.#textIndex < 0) return [];
		const chunk = {
			type: "block-end",
			index: this.#textIndex,
			block: {
				type: "text",
				text: this.#text
			}
		};
		this.#textIndex = -1;
		this.#text = "";
		return [chunk];
	}
	/** 关闭推理块并交出装配好的内容。 */
	closeReasoning() {
		if (this.#reasoningIndex < 0) return [];
		const chunk = {
			type: "block-end",
			index: this.#reasoningIndex,
			block: {
				type: "reasoning",
				text: this.#reasoning
			}
		};
		this.#reasoningIndex = -1;
		this.#reasoning = "";
		return [chunk];
	}
	/** 追加一段可见文本（顺带关闭推理块）。 */
	textDelta(text) {
		if (text === "") return [];
		const chunks = [...this.closeReasoning(), ...this.#openText()];
		this.#text += text;
		this.#producedContent = true;
		chunks.push({
			type: "text-delta",
			index: this.#textIndex,
			text
		});
		return chunks;
	}
	/** 追加一段推理文本（顺带关闭文本块）。 */
	reasoningDelta(text) {
		if (text === "") return [];
		const chunks = [...this.closeText(), ...this.#openReasoning()];
		this.#reasoning += text;
		this.#producedContent = true;
		chunks.push({
			type: "reasoning-delta",
			index: this.#reasoningIndex,
			text
		});
		return chunks;
	}
	/** 合并一个 Chat Completions 工具调用片段。 */
	addOpenAiToolCall(fragment) {
		this.#producedContent = true;
		let existing = this.#openAiTools.find((call) => call.index === fragment.index);
		if (existing === void 0) {
			existing = {
				index: fragment.index,
				id: fragment.id ?? "",
				name: fragment.name ?? "",
				arguments: ""
			};
			this.#openAiTools.push(existing);
		} else {
			if (fragment.id !== void 0 && existing.id === "") existing.id = fragment.id;
			if (fragment.name !== void 0 && existing.name === "") existing.name = fragment.name;
		}
		if (fragment.arguments !== void 0) existing.arguments += fragment.arguments;
	}
	/**
	* 是否还缓冲着尚未交出的 OpenAI 工具调用片段。
	*
	* 它已经是「有内容」的证据（旧插件在收到 `delta.tool_calls` 的当刻就置 `sawContent`，第 4610 行），
	* 但这些片段要到 {@link flushOpenAiToolCalls} 才变成 chunk —— 只看已产出的 chunk 会在流末把
	* 它误判成空响应，并连带丢掉一个真实的工具调用。
	*/
	get hasBufferedToolCall() {
		return this.#openAiTools.length > 0;
	}
	/**
	* 本流是否真的产出过内容（文本/推理/工具调用）。供结束原因映射判定「打到输出上限却一个字
	* 都没产出」的失败模式（`finish` 调用前读取，反映的是截至此刻的累计状态）。
	*/
	get producedOutput() {
		return this.#producedContent;
	}
	/** 交出所有缓冲的 Chat Completions 工具调用（在 finish 之前调用）。 */
	flushOpenAiToolCalls() {
		const chunks = [];
		for (const call of this.#openAiTools) {
			const index = this.#nextIndex;
			this.#nextIndex += 1;
			const id = ToolCallId(call.id === "" ? randomUUID() : call.id);
			chunks.push({
				type: "block-start",
				index,
				blockType: "tool-call"
			});
			chunks.push({
				type: "tool-call-delta",
				index,
				id,
				name: call.name,
				argumentsDelta: call.arguments
			});
			chunks.push({
				type: "block-end",
				index,
				block: {
					type: "tool-call",
					id,
					name: call.name,
					arguments: call.arguments
				}
			});
		}
		this.#openAiTools = [];
		return chunks;
	}
	/**
	* 开出一个内容已经完整的一次性工具调用块（CLI 传输的 `tool-call` 事件）。
	* @param id - 工具调用 id。
	* @param name - 工具名。
	* @param args - 已序列化的参数对象。
	* @returns 该块的三个 chunk。
	*/
	openToolCall(id, name, args) {
		this.#producedContent = true;
		const index = this.#nextIndex;
		this.#nextIndex += 1;
		return [
			{
				type: "block-start",
				index,
				blockType: "tool-call"
			},
			{
				type: "tool-call-delta",
				index,
				id,
				name,
				argumentsDelta: args
			},
			{
				type: "block-end",
				index,
				block: {
					type: "tool-call",
					id,
					name,
					arguments: args
				}
			}
		];
	}
	/** Messages 的 `content_block_start`。 */
	messagesBlockStart(nativeIndex, block) {
		const nativeType = stringValue$1(block.type);
		if (nativeType === "text") {
			this.#messagesBlocks.set(nativeIndex, {
				kind: "text",
				index: -1,
				arguments: ""
			});
			return this.#openText();
		}
		if (nativeType === "thinking" || nativeType === "redacted_thinking") {
			this.#messagesBlocks.set(nativeIndex, {
				kind: "reasoning",
				index: -1,
				arguments: ""
			});
			return this.#openReasoning();
		}
		if (nativeType !== "tool_use") return [];
		const id = ToolCallId(stringValue$1(block.id) ?? randomUUID());
		const name = stringValue$1(block.name) ?? "";
		const index = this.#nextIndex;
		this.#nextIndex += 1;
		this.#messagesBlocks.set(nativeIndex, {
			kind: "tool",
			index,
			id,
			name,
			arguments: ""
		});
		return [{
			type: "block-start",
			index,
			blockType: "tool-call"
		}, {
			type: "tool-call-delta",
			index,
			id,
			name,
			argumentsDelta: ""
		}];
	}
	/** Messages 的 `content_block_delta`。 */
	messagesBlockDelta(nativeIndex, delta) {
		const deltaType = stringValue$1(delta.type);
		if (deltaType === "text_delta") return this.textDelta(stringValue$1(delta.text) ?? "");
		if (deltaType === "thinking_delta") return this.reasoningDelta(stringValue$1(delta.thinking) ?? "");
		if (deltaType !== "input_json_delta") return [];
		const block = this.#messagesBlocks.get(nativeIndex);
		if (block === void 0 || block.kind !== "tool" || block.id === void 0) return [];
		const partial = stringValue$1(delta.partial_json) ?? "";
		if (partial === "") return [];
		block.arguments += partial;
		this.#producedContent = true;
		return [{
			type: "tool-call-delta",
			index: block.index,
			id: block.id,
			argumentsDelta: partial
		}];
	}
	/** Messages 的 `content_block_stop`。 */
	messagesBlockStop(nativeIndex) {
		const block = this.#messagesBlocks.get(nativeIndex);
		if (block === void 0) return [];
		this.#messagesBlocks.delete(nativeIndex);
		if (block.kind === "text") return this.closeText();
		if (block.kind === "reasoning") return this.closeReasoning();
		if (block.id === void 0) return [];
		return [{
			type: "block-end",
			index: block.index,
			block: {
				type: "tool-call",
				id: block.id,
				name: block.name ?? "",
				arguments: block.arguments
			}
		}];
	}
	/**
	* 关闭所有仍打开的块（Messages 的原生块、文本、推理、缓冲的 OpenAI 工具调用），
	* 并以 finish 收尾。
	*
	* **幂等**：已经交出过 finish 时返回 `[]`。每条流恰好一条 finish（宿主保留最后一条，多发的
	* 会覆盖结束原因，且 `max-tokens` 截断时本该丢弃的半装工具块会被留下）；一个畸形网关连发
	* 两个终止事件（两个 `finish` / `finish_reason`，或先 `message_stop` 再 `finish`）时，
	* 第二个事件不能凭空再造一条 finish。
	* @param reason - 结束原因。
	* @returns 关闭块与唯一一条 finish；已有 finish 时为 `[]`。
	*/
	finish(reason) {
		if (this.#finished) return [];
		this.#finished = true;
		return [
			...this.closeMessagesBlocks(),
			...this.closeText(),
			...this.closeReasoning(),
			...this.flushOpenAiToolCalls(),
			{
				type: "finish",
				reason
			}
		];
	}
	/**
	* 关闭所有仍打开的 Messages 原生块（等价于补发它们的 `content_block_stop`）。
	*
	* `messagesBlockStop` 会对文本/推理块交出 `block-end`、对工具块交出带累计参数的
	* `block-end`；不排空就会留下宿主账本里的**打开块**，让随后的 finish 被
	* `dsh-llm` 的不变式拒绝（`LLM stream finished with N open block(s)`）。
	* @returns 每个仍打开的原生块的关闭 chunk；没有打开块时为 `[]`。
	*/
	closeMessagesBlocks() {
		const chunks = [];
		for (const nativeIndex of [...this.#messagesBlocks.keys()]) chunks.push(...this.messagesBlockStop(nativeIndex));
		return chunks;
	}
	/** Messages 的 `message_start`：只记下 usage，不在此时交出（全流只发一条 usage）。 */
	setMessagesUsage(usage) {
		this.#messagesUsage = usage;
	}
	/**
	* Messages 的 `message_delta`：把本次 usage 与此前 `message_start` 的合并后交出。
	*
	* 本次负载缺失时（`event.usage` 不是对象）**不**交出任何 chunk —— usage 会留到
	* `message_stop` 由 {@link messagesStop} 发出，绝不把组件重复交给宿主。
	* @param raw - `message_delta.usage` 的原始负载。
	* @returns 至多一条 usage chunk。
	*/
	mergeMessagesUsage(raw) {
		const merged = messagesUsage(raw, this.#messagesUsage);
		if (merged === void 0) return [];
		this.#messagesUsage = merged;
		return this.#emitMessagesUsage();
	}
	/** Messages 的 `message_delta`：记住 `stop_reason`，finish 留给 `message_stop`。 */
	setMessagesFinishReason(raw) {
		if (raw !== void 0) this.#messagesFinishReason = raw;
	}
	/**
	* Messages 的 `message_stop`：先补发（若尚未发出的）usage，再交出**唯一**的 finish。
	*
	* 网关实测序列是 `message_delta`（带 `stop_reason` 与最终 usage）→ `message_stop`
	* （旧插件第 4680-4686 行注释）；finish 只在这里发出一次，否则宿主会拿到两条
	* finish chunk 并只保留最后一条 —— 结束原因被覆盖，且 `max-tokens` 截断时本该丢弃的
	* 半装工具块会被留下（旧插件第 4814-4832 行）。**幂等**：已经交出过 finish 时返回 `[]`
	* （畸形网关连发两个 `message_stop` 时，第二条不能再造一条 finish）。
	* @returns usage chunk（有且仅在尚未交出时）+ 一条 finish chunk；已有 finish 时为 `[]`。
	*/
	messagesStop() {
		if (this.#finished) return [];
		this.#finished = true;
		return [...this.#emitMessagesUsage(), {
			type: "finish",
			reason: mapFinishReason(this.#messagesFinishReason, this.producedOutput)
		}];
	}
	/**
	* 流在**没有任何终止事件**的情况下干净结束时的兜底（正文被截断、`message_stop` /
	* `finish_reason` / `finish` 事件缺席）。
	*
	* 三条判据（旧插件第 4209-4222 行的同一处分支）：
	* - 已经交出过 finish（正常的 `message_stop` / `finish_reason` / `finish` 路径）→ 返回 `[]`：
	*   每条流**恰好一条** finish，绝不补第二条。
	* - 没交出过 finish 且**什么内容都没产出** → 抛可重试的 {@link EMPTY_RESPONSE_CODE}：
	*   空响应/被截断的空响应不能伪装成 `{kind:"stop"}` 的正常收尾（旧插件第 4221 行；
	*   该码在本适配器的 `providerRetryPolicy` 白名单里，宿主会重试）。
	* - 有内容但缺终止事件（旧插件第 4222 行的 `STREAM_CLOSED` 场景）→ 补一条 finish：
	*   Messages 用 `message_delta` 记下的 {@link #messagesFinishReason}（没有则 `stop`），
	*   另外两条传输补 `stop`。补发走 {@link finish}，因此仍打开的 Messages 原生块、文本/推理块与
	*   缓冲的 OpenAI 工具调用都会被关闭/交出（否则宿主的 `finished with N open block(s)` 会拒）。
	*
	* 说明：宿主 `FinishReason` 的取值只有 `stop` / `tool-calls` / `max-tokens` /
	* `aborted` / `error`（后两者要求 `failure` 负载，是宿主自己表达**失败回合**的通道，见
	* `dsh-llm` 的 `adapterFailureChunk`），没有「截断/流被关闭」这一类，故截断情形保持 `stop`。
	* @param sawContent - 本流是否产出过内容（文本/推理/工具调用 chunk、非零 usage，或
	*   仍缓冲在装配器里、要到 finish 才交出的 OpenAI 工具调用）。
	* @returns 尚未交出的 usage（若有）+ 唯一一条兜底 finish；已有 finish 时为 `[]`。
	* @throws {LlmError} `EMPTY_RESPONSE`：没有终止事件且毫无内容。
	*/
	endOfStream(sawContent) {
		if (this.#finished) return [];
		if (!sawContent) throw new LlmError("Command Code API returned an empty response: the stream produced no content and ended without a terminal event", EMPTY_RESPONSE_CODE);
		return [...this.#emitMessagesUsage(), ...this.finish(mapFinishReason(this.#messagesFinishReason, true))];
	}
	/** 交出尚未发出的 Messages usage；已经交过或根本没有时为 `[]`。 */
	#emitMessagesUsage() {
		if (this.#messagesUsage === void 0 || this.#messagesUsageEmitted) return [];
		this.#messagesUsageEmitted = true;
		return [{
			type: "usage",
			usage: this.#messagesUsage
		}];
	}
};
/** Chat Completions 的一行事件（旧插件 `handleOpenAIEvent` 第 4557-4644 行）。 */
function openAiChunks(assembler, event) {
	if (event.error !== void 0) throw streamFailure(event.error);
	const chunks = [];
	const choices = event.choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		const usage = openAiUsage(event.usage);
		if (usage !== void 0) chunks.push({
			type: "usage",
			usage
		});
		return chunks;
	}
	const choice = isRecord$2(choices[0]) ? choices[0] : {};
	const delta = isRecord$2(choice.delta) ? choice.delta : {};
	const reasoning = stringValue$1(delta.reasoning) ?? stringValue$1(delta.reasoning_content);
	if (reasoning !== void 0) chunks.push(...assembler.reasoningDelta(reasoning));
	const content = stringValue$1(delta.content);
	if (content !== void 0) chunks.push(...assembler.textDelta(content));
	if (Array.isArray(delta.tool_calls)) for (const raw of delta.tool_calls) {
		if (!isRecord$2(raw)) continue;
		const fn = isRecord$2(raw.function) ? raw.function : {};
		const id = stringValue$1(raw.id);
		const name = stringValue$1(fn.name);
		const args = stringValue$1(fn.arguments);
		assembler.addOpenAiToolCall({
			index: numberValue$1(raw.index) ?? 0,
			...id === void 0 ? {} : { id },
			...name === void 0 ? {} : { name },
			...args === void 0 ? {} : { arguments: args }
		});
	}
	if (choice.finish_reason !== void 0 && choice.finish_reason !== null) {
		const usage = openAiUsage(event.usage);
		if (usage !== void 0) chunks.push({
			type: "usage",
			usage
		});
		chunks.push(...assembler.finish(mapFinishReason(stringValue$1(choice.finish_reason), assembler.producedOutput)));
	}
	return chunks;
}
/** Messages 的一行事件（旧插件第 4678 行起的处理器）。 */
function messagesChunks(assembler, event) {
	switch (stringValue$1(event.type)) {
		case "message_start": {
			const usage = messagesUsage((isRecord$2(event.message) ? event.message : {}).usage);
			if (usage !== void 0) assembler.setMessagesUsage(usage);
			return [];
		}
		case "content_block_start": {
			const index = numberValue$1(event.index) ?? 0;
			const block = isRecord$2(event.content_block) ? event.content_block : {};
			return assembler.messagesBlockStart(index, block);
		}
		case "content_block_delta": {
			const index = numberValue$1(event.index) ?? 0;
			const delta = isRecord$2(event.delta) ? event.delta : {};
			return assembler.messagesBlockDelta(index, delta);
		}
		case "content_block_stop": return assembler.messagesBlockStop(numberValue$1(event.index) ?? 0);
		case "message_delta": {
			const chunks = assembler.mergeMessagesUsage(event.usage);
			const delta = isRecord$2(event.delta) ? event.delta : {};
			assembler.setMessagesFinishReason(stringValue$1(delta.stop_reason));
			return chunks;
		}
		case "message_stop": return assembler.messagesStop();
		case "error": throw streamFailure(event.error ?? event);
		default: return [];
	}
}
/** CLI 传输的一行事件（旧插件 `handleCliEvent` 第 4435-4550 行）。 */
function cliChunks(assembler, event) {
	switch (stringValue$1(event.type)) {
		case "text-delta": return assembler.textDelta(stringValue$1(event.text) ?? "");
		case "reasoning-delta": return assembler.reasoningDelta(stringValue$1(event.text) ?? "");
		case "reasoning-start": return assembler.closeText();
		case "reasoning-end": return assembler.closeReasoning();
		case "tool-call": {
			const id = ToolCallId(stringValue$1(event.toolCallId) ?? randomUUID());
			const name = stringValue$1(event.toolName) ?? "";
			const input = event.input ?? event.args ?? event.arguments;
			const args = JSON.stringify(isRecord$2(input) ? input : {});
			return assembler.openToolCall(id, name, args);
		}
		case "finish": {
			const chunks = [];
			const usage = cliUsage(event.totalUsage);
			if (usage !== void 0) chunks.push({
				type: "usage",
				usage
			});
			chunks.push(...assembler.finish(mapFinishReason(stringValue$1(event.finishReason), assembler.producedOutput)));
			return chunks;
		}
		case "error": throw streamFailure(event.error ?? event);
		default: return [];
	}
}
/** 按协议把一行解析成 chunk。 */
function decodeLine(assembler, protocol, line) {
	const trimmed = line.trim();
	if (trimmed === "" || trimmed.startsWith(":") || trimmed.startsWith("event:")) return [];
	const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
	if (payload === "" || payload === "[DONE]") return [];
	let event;
	try {
		event = JSON.parse(payload);
	} catch {
		return [];
	}
	if (!isRecord$2(event)) return [];
	if (protocol === "openai") return openAiChunks(assembler, event);
	if (protocol === "messages") return messagesChunks(assembler, event);
	return cliChunks(assembler, event);
}
/**
* 把 HTTP 响应体解码成宿主的 chunk 流。
*
* 行级解析（与旧插件一致）：逐行 trim，跳过空行/注释/`event:` 行，去掉 `data:` 前缀，
* 忽略 `[DONE]`，其余按 JSON 解析，解析失败的坏行跳过。调用方负责用
* `runStream` 套上时间预算。
*
* 正文在终止事件之前结束时（缺 `message_stop` / `finish_reason` / `finish`，即断流）由
* {@link StreamAssembler.endOfStream} 收尾：有内容就补一条 finish，**毫无内容**则抛可重试的
* `EMPTY_RESPONSE`（空响应不能伪装成正常收尾）。补发/报错只发生在正常读完整个正文之后；
* 调用方提前 `return()`/中止时生成器直接走 `finally`，不会补出假 finish。
* @param protocol - 该响应对应的线协议。
* @param body - 响应体；`null`（无响应体）时抛协议错误。
* @returns 与线上事件同序的 chunk 流。
*/
async function* decodeStream(protocol, body) {
	if (body === null) throw new LlmError("Command Code API returned no response body", "PROVIDER_PROTOCOL_ERROR");
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const assembler = new StreamAssembler();
	let buffer = "";
	let sawContent = false;
	const produced = (chunks) => {
		for (const chunk of chunks) if (chunkIsContent(chunk)) sawContent = true;
		return chunks;
	};
	try {
		for (;;) {
			const read = await reader.read();
			if (read.done === true) break;
			buffer += decoder.decode(read.value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				for (const chunk of produced(decodeLine(assembler, protocol, line))) yield chunk;
				newline = buffer.indexOf("\n");
			}
		}
		buffer += decoder.decode();
		for (const chunk of produced(decodeLine(assembler, protocol, buffer))) yield chunk;
		for (const chunk of assembler.endOfStream(sawContent || assembler.hasBufferedToolCall)) yield chunk;
	} finally {
		reader.cancel().catch(() => {});
	}
}
//#endregion
//#region src/vendors/commandcode/adapter.ts
/**
* Command Code 的宿主适配器：把共享内核串成一次真实请求。
*
* 一次 `stream()` 的固定顺序（设计 §9.1）：
* 1. `rotation.pick({ model, tried })` 选账号 —— 决策顺序在轮换引擎里，这里不另写规则；
* 2. 收集凭据来源（字面量 / 凭据库 / 环境变量 / auth.json 兜底）交给 `pickApiKey`；
* 3. 按模型选线协议、构造请求体、发出请求，用 `runStream` 套上整请求 deadline 与流空闲看门狗；
* 4. 失败时用 `classifyCommandCodeFailure` 分类、`markRejected` 记入轮换引擎，
*    **只在 `rotation.fallbackAllowed({ emitted, totalTokens, aborted })` 为真时**才换下一个账号；
* 5. `tried.size` 达到 `MAX_TRIED` 时停止轮换，并把最后一次失败抛给宿主。
*
* 本任务**不**做：网页登录（Task 11）、额度读取（Task 10）、账号增删改（Task 10）、
* 客户端代码（计划 1b）、套餐过滤与费用估算（第 2 期）。
* @module dsh-llm-account/src/vendors/commandcode/adapter
*/
/**
* 调用方中止的错误码。宿主 `LlmRuntime` 用同一个字符串判定「这次请求是被取消的」；
* `src/core/transport.ts` 刻意不导出它（它不是内核的公开常量），所以这里直接比字面量。
*/
const ABORTED_CODE = "ABORTED";
/** 目录请求的预算（旧插件 `MODELS_TIMEOUT_MS` 第 5391 行）。 */
const MODELS_TIMEOUT_MS = 1e4;
/**
* 目录读数的缓存时长（毫秒）。
*
* 宿主的模型选择器与每个请求的身份解析（`resolveModel`）都会问一次目录，而目录是**厂商级**
* 资源、按分钟级变化。不缓存等于每个请求多打一次网络。60 秒足够让「刚在设置里勾了模型」
* 立刻生效，也足够省掉重复请求；失败不缓存。
*/
const CATALOG_TTL_MS = 6e4;
/** 错误正文最多读多少字符（旧插件 `readGenerateErrorBody` 第 6661 行同样封顶 64 KiB）。 */
const ERROR_BODY_LIMIT = 65536;
/** 重试延迟上限（旧插件 `RETRY_MAX_DELAY_MS` 第 2974 行）。 */
const RETRY_MAX_DELAY_MS = 9e5;
/**
* 路由的重试白名单（控制器裁决 12）。`LLM_REQUEST_TIMEOUT` 与
* `LLM_STREAM_IDLE_TIMEOUT` **不在**宿主的 `DEFAULT_RETRYABLE_CODES` 里，必须在此显式列出；
* 保留这两个具体码（不退化成一个 `TIMEOUT`）是为了区分「整请求超时」与「流空闲超时」。
*/
const RETRYABLE_CODES = [
	"EMPTY_RESPONSE",
	"RATE_LIMIT",
	"THROTTLED",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT",
	LLM_REQUEST_TIMEOUT,
	LLM_STREAM_IDLE_TIMEOUT
];
/** 填默认值；`0`/负数/NaN 一律回落到默认值，避免把坏配置变成「立即超时」。 */
function resolveConfig(raw) {
	const positive = (value, fallback) => value !== void 0 && Number.isFinite(value) && value > 0 ? value : fallback;
	return {
		apiBase: raw.apiBase !== void 0 && raw.apiBase.trim() !== "" ? raw.apiBase : DEFAULT_API_BASE,
		...raw.apiKey === void 0 ? {} : { apiKey: raw.apiKey },
		...raw.protocol === void 0 ? {} : { protocol: raw.protocol },
		requestTimeoutMs: positive(raw.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
		streamIdleTimeoutMs: positive(raw.streamIdleTimeoutMs, DEFAULT_STREAM_IDLE_TIMEOUT_MS),
		defaultMaxTokens: positive(raw.defaultMaxTokens, DEFAULT_GENERATE_MAX_TOKENS),
		...raw.workingDir === void 0 ? {} : { workingDir: raw.workingDir }
	};
}
/** 把系统提示折叠成一段文本（旧插件第 7420 行的同一规则）。 */
function systemTextOf(options) {
	const parts = [];
	if (options.system !== void 0 && options.system !== "") parts.push(options.system);
	for (const message of options.messages) {
		if (message.role !== "system") continue;
		const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		if (text !== "") parts.push(text);
	}
	return parts.join("\n\n");
}
/** 一次 usage chunk 计入的 token 总数（缺 `totalTokens` 时按分项相加）。 */
function usageTotal(usage) {
	if (usage.totalTokens !== void 0) return usage.totalTokens;
	return usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}
/** 读一份错误正文：最多读 {@link ERROR_BODY_LIMIT}，能解析成 JSON 就解析。 */
async function readErrorBody(response) {
	let text = "";
	try {
		text = (await response.text()).slice(0, ERROR_BODY_LIMIT);
	} catch {
		return;
	}
	if (text.trim() === "") return void 0;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}
/** 命令码适配器：宿主 `LlmAdapter` 的一个真实子类。 */
var CommandCodeAdapter = class extends LlmAdapter {
	#deps;
	/** 目录缓存：同一基地址在 TTL 内复用；换配置（基地址变化）立即失效。 */
	#catalogCache;
	/** 在途的目录请求（并发去重：模型选择器一次能并发问好几条）。 */
	#catalogInFlight;
	/**
	* @param deps - 配置读取、轮换引擎、端口与各 I/O 注入点。
	*/
	constructor(deps) {
		super();
		this.#deps = deps;
	}
	/** @returns 路由的展示元数据（name 用产品名，id 必须是路由 id）。 */
	providerInfo(provider) {
		return {
			id: provider,
			name: "Command Code"
		};
	}
	/**
	* 路由的重试白名单（控制器裁决 12；依据是旧插件 `providerRetryPolicy` 第 6893-6911 行）。
	* @returns 已解析的重试策略。
	*/
	providerRetryPolicy(_provider) {
		return resolveRetryPolicy({
			mode: "normal",
			maxRetries: 1e3,
			retryableCodes: [...RETRYABLE_CODES],
			backoff: {
				initialDelayMs: 500,
				maxDelayMs: RETRY_MAX_DELAY_MS,
				jitterRatio: .1
			}
		}, "llm-commandcode: retryPolicy");
	}
	/**
	* 拉目录 → 应用可见性规则 → 映射为宿主形状（旧插件 `listModels` 第 6927-6946 行的
	* 可见性部分；套餐过滤与免费置顶属第 2 期）。
	*/
	async listModels(provider) {
		const raw = this.#deps.config();
		const entries = await this.#catalog(resolveConfig(raw));
		const visible = selectVisible(entries, normalizeVisibility(raw));
		noteCatalogModels(provider, visible.map((entry) => ({
			id: entry.id,
			...entry.contextWindow === void 0 ? {} : { contextWindow: entry.contextWindow },
			...entry.efforts === void 0 ? {} : { effortCount: entry.efforts.length }
		})));
		return visible.map((entry) => ({
			provider,
			id: entry.id,
			name: entry.name,
			inputModalities: entry.inputModalities
		}));
	}
	/**
	* 全部目录条目（**不受** `visibleModels` / `modelVisibility` 过滤），供设置页勾选。
	*
	* 与 `listModels` 的分工：那个回答「宿主的模型选择器该看到什么」，这个回答「厂商现在
	* 有哪些模型」—— 隐藏的模型也要出现在勾选列表里，否则用户没有入口把它重新打开。
	* @returns 目录里的模型 id 与名称。
	*/
	async catalogModels(fresh = false) {
		return (await this.#catalog(resolveConfig(this.#deps.config()), void 0, fresh)).map((entry) => ({
			id: entry.id,
			...entry.name === "" ? {} : { name: entry.name }
		}));
	}
	/**
	* 解析一个模型：目录里有就带上下文、输出上限、推理档位与图片能力；目录不可用或
	* 没有该模型时退化成「只有 id 的目录外模型」（旧插件 `resolveModel` 第 6971-6992 行）。
	*
	* 档位的来源是 {@link knownEfforts} 的静态表（网关从不公布档位），负载自己哪天公布了就
	* 以负载为准 —— 那是更新的真相。表里没有的模型**不声明**档位：宿主的选择器随之不出现，
	* 与旧插件同一行为。
	*/
	async resolveModel(provider, model, signal) {
		const config = resolveConfig(this.#deps.config());
		let entry;
		try {
			entry = (await this.#catalog(config, signal)).find((candidate) => candidate.id === model);
		} catch {
			entry = void 0;
		}
		const efforts = entry?.efforts ?? knownEfforts(model) ?? [];
		return {
			provider,
			id: model,
			name: entry?.name ?? officialModelName(model),
			inputModalities: entry?.inputModalities ?? ["text"],
			...entry?.contextWindow === void 0 ? {} : { context: { contextWindow: entry.contextWindow } },
			...entry?.maxTokens === void 0 ? {} : { defaultMaxTokens: entry.maxTokens },
			systemPromptUpdate: "in-history",
			toolUpdate: "addition-only",
			...efforts.length === 0 ? {} : { reasoning: { efforts: efforts.map((effort) => ({
				id: ReasoningEffortId(effort),
				name: effort
			})) } }
		};
	}
	/**
	* 流式请求：账号轮换 → 凭据 → 请求 → 时间预算 → 失败分类 → 有条件的账号回退。
	* @param options - 宿主的完整请求；实现必须遵守 `options.signal`。
	* @returns 与线上同序的 chunk 流。
	*/
	async *stream(options) {
		await this.#deps.beforeRequest?.({
			...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) },
			...options.purpose === void 0 ? {} : { purpose: options.purpose }
		});
		const config = resolveConfig(this.#deps.config());
		const tried = /* @__PURE__ */ new Set();
		let lastFailure;
		/** 已经换过一次模型了吗（只换一次：替代也限额就停手，不再套娃）。 */
		let swappedOnce = false;
		for (;;) {
			if (options.signal?.aborted === true) throw this.#abortError(options.signal);
			const ref = this.#deps.rotation.pick({
				model: options.model,
				tried
			});
			if (ref === void 0) {
				if (!swappedOnce && lastFailure !== void 0 && lastFailure.rejection.kind !== "invalid-credential") {
					const swapped = await this.#fallbackModel(options);
					if (swapped !== void 0 && swapped.model !== options.model) {
						swappedOnce = true;
						if (swapped.provider !== options.provider) {
							const delegated = delegateStream(swapped, options);
							if (delegated !== void 0) {
								yield* delegated;
								return;
							}
						} else {
							options = {
								...options,
								model: swapped.model
							};
							tried.clear();
							continue;
						}
					}
				}
				if (lastFailure !== void 0) throw lastFailure.thrown;
				throw new LlmError(`llm-commandcode: no Command Code account is available for model "${options.model}"; add an account or store its API key`, "MISSING_CREDENTIAL");
			}
			tried.add(ref);
			const key = await this.#resolveKey(config, ref);
			if (key === void 0) {
				const rejection = {
					kind: "invalid-credential",
					message: `Command Code account "${ref}" has no usable API key`
				};
				this.#deps.rotation.markRejected(ref, rejection);
				lastFailure = {
					rejection,
					thrown: new LlmError(`llm-commandcode: no API key for Command Code account "${ref}"; store it through the credentials service, export it in the launching environment, set config.apiKey, or run \`command-code login\` to write ~/.commandcode/auth.json`, "MISSING_CREDENTIAL")
				};
				if (tried.size >= 16) throw lastFailure.thrown;
				continue;
			}
			let emitted = false;
			let totalTokens = 0;
			const counts = {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0
			};
			const iterator = this.#attempt(config, options, key)[Symbol.asyncIterator]();
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
					const chunk = step.value;
					if (chunk.type === "usage") {
						totalTokens += usageTotal(chunk.usage);
						counts.inputTokens += chunk.usage.inputTokens ?? 0;
						counts.outputTokens += chunk.usage.outputTokens ?? 0;
						counts.cacheReadTokens += chunk.usage.cacheReadTokens ?? 0;
						counts.cacheWriteTokens += chunk.usage.cacheWriteTokens ?? 0;
					}
					emitted = true;
					yield chunk;
				}
			} finally {
				if (!exhausted) {
					const closing = iterator.return?.(void 0);
					if (closing !== void 0) closing.catch(() => {});
				}
			}
			if (exhausted) {
				this.#deps.rotation.noteSettled(ref);
				this.#recordUsage(ref, options.model, "success", counts);
				return;
			}
			if (options.signal?.aborted === true || this.#isAbort(failure)) {
				this.#recordUsage(ref, options.model, "failure", counts, "aborted");
				throw failure;
			}
			const classified = this.#classify(failure);
			if (classified === void 0) {
				this.#recordUsage(ref, options.model, "failure", counts, "request");
				throw failure;
			}
			this.#deps.rotation.markRejected(ref, classified.rejection);
			lastFailure = classified;
			this.#recordUsage(ref, options.model, "failure", counts, classified.rejection.kind);
			if (!this.#deps.rotation.fallbackAllowed({
				emitted,
				totalTokens,
				aborted: false
			})) throw classified.thrown;
			if (tried.size >= 16) throw classified.thrown;
		}
	}
	/** 一次尝试：选协议 → 发请求 → （必要时）回退 CLI 传输 → 解码并套上时间预算。 */
	async *#attempt(config, options, key) {
		const cap = Math.min(config.defaultMaxTokens, DEFAULT_GENERATE_MAX_TOKENS);
		const supported = knownEfforts(options.model) ?? [];
		const declared = options.reasoningEffort !== void 0 && supported.includes(options.reasoningEffort) ? options.reasoningEffort : void 0;
		const facts = {
			maxTokens: options.maxTokens === void 0 ? cap : Math.min(options.maxTokens, cap),
			systemText: systemTextOf(options),
			...declared === void 0 ? {} : { reasoningEffort: declared },
			...supported.length === 0 ? {} : { selectableEffort: true },
			...config.workingDir === void 0 ? {} : { workingDir: config.workingDir },
			...options.sessionId === void 0 ? {} : { sessionId: options.sessionId }
		};
		let protocol = resolveProtocol({
			model: options.model,
			...config.protocol === void 0 ? {} : { forced: config.protocol }
		});
		let response = await this.#post(config, protocol, key, buildRequestBody(protocol, options, facts), options.signal);
		if (!response.ok) {
			const body = await readErrorBody(response);
			if (protocol !== "cli" && isUpgradeRequired(response.status, body)) {
				protocol = "cli";
				response = await this.#post(config, protocol, key, buildRequestBody(protocol, options, facts), options.signal);
				if (!response.ok) throw new CommandCodeStreamFailure(response.status, await readErrorBody(response));
			} else throw new CommandCodeStreamFailure(response.status, body);
		}
		yield* runStream(decodeStream(protocol, response.body), {
			requestTimeoutMs: config.requestTimeoutMs,
			streamIdleTimeoutMs: config.streamIdleTimeoutMs
		}, { signal: options.signal });
	}
	/** 发一次请求；`fetch` 抛出的网络异常原样上抛，交给失败分类。 */
	async #post(config, protocol, key, body, signal) {
		const wire = generateRequest({
			protocol,
			base: config.apiBase,
			key,
			body: JSON.stringify(body),
			...config.workingDir === void 0 ? {} : { workingDir: config.workingDir }
		});
		const init = {
			method: "POST",
			headers: wire.headers,
			body: wire.body
		};
		if (signal !== void 0) init.signal = signal;
		return await this.#deps.fetchImpl(wire.url, init);
	}
	/** 收集四个凭据来源并按优先级挑选（`literal → stored → environment → authFile`）。 */
	async #resolveKey(config, ref) {
		const stored = await this.#deps.resolveStored?.(ref);
		const environment = this.#deps.resolveEnvironment?.(ref);
		const authFile = await this.#deps.authFileFallback?.();
		return pickApiKey({
			...config.apiKey === void 0 ? {} : { literal: config.apiKey },
			...stored === void 0 ? {} : { stored },
			...environment === void 0 ? {} : { environment },
			...authFile === void 0 ? {} : { authFile }
		}).key;
	}
	/**
	* 把一次尝试的结果交给用量端口。
	*
	* 采集是**旁路**：端口自己保证不抛错，这里再兜一层 —— 统计出问题绝不能让一次本来
	* 成功的对话变成失败（那样用户会觉得「插件把请求弄坏了」）。
	* @param account - 服务这次请求的账号 ref。
	* @param model - 模型 id（缺省为空串，计价会按「未知」处理）。
	* @param outcome - 成功或失败。
	* @param counts - 本次累计的四个 token 计数。
	* @param failureKind - 失败分类（成功时不传）。
	*/
	#recordUsage(account, model, outcome, counts, failureKind) {
		const port = this.#deps.usage ?? NOOP_USAGE_PORT;
		try {
			port.record({
				vendor: "commandcode",
				account,
				outcome,
				...model === void 0 ? {} : { model },
				...counts,
				...failureKind === void 0 ? {} : { failureKind }
			});
		} catch (error) {
			console.warn("[dsh-llm-account] could not record the usage sample:", error);
		}
	}
	/**
	* 拉目录并解析（TTL 缓存 + 并发去重）。
	*
	* 缓存键是**基地址**：换基地址立即失效（目录属于端点，不属于账号）。60 秒的量级用真实
	* 时钟即可，不需要注入。
	* @param config - 已填默认值的配置。
	* @param signal - 宿主的取消信号（有缓存时不发请求，信号自然用不上）。
	* @returns 目录条目。
	*/
	async #catalog(config, signal, fresh = false) {
		const cached = this.#catalogCache;
		if (!fresh && cached !== void 0 && cached.base === config.apiBase && Date.now() - cached.at <= CATALOG_TTL_MS) return cached.entries;
		if (this.#catalogInFlight !== void 0) return this.#catalogInFlight;
		const pending = this.#fetchCatalog(config, signal);
		this.#catalogInFlight = pending;
		try {
			const entries = await pending;
			this.#catalogCache = {
				base: config.apiBase,
				at: Date.now(),
				entries
			};
			return entries;
		} finally {
			this.#catalogInFlight = void 0;
		}
	}
	/**
	* 真正打一次目录端点。
	* @param config - 已填默认值的配置。
	* @param signal - 宿主的取消信号。
	* @returns 目录条目。
	*/
	async #fetchCatalog(config, signal) {
		const { url, headers } = catalogRequest(config.apiBase);
		const response = await this.#deps.fetchImpl(url, {
			headers,
			signal: signal ?? AbortSignal.timeout(MODELS_TIMEOUT_MS)
		});
		if (!response.ok) throw new LlmError(`Command Code models endpoint returned ${response.status}`, "PROVIDER_HTTP_ERROR", { status: response.status });
		return parseCatalog(await response.json()).entries;
	}
	/**
	* 额度用尽后换模型的判定。
	*
	* 只在**所有账号都被拒绝**之后调用，且必须先过开关（`autoSwitchModel`，默认关闭）。
	*
	* 四级优先由 `core/model-fallback` 的纯函数实现：同网关同名 → 跨网关同名 →
	* 同网关异名（按上下文窗口与推理档位接近度收窄）→ 跨网关异名；同一级里随机。
	* @param options - 当前请求。
	* @returns 替代目标；开关关着 / 不该换 / 没有候选时都是 `undefined`。
	*/
	async #fallbackModel(options) {
		if (this.#deps.autoSwitchModel?.() !== true) return void 0;
		const candidates = await this.#deps.fallbackCandidates?.();
		if (candidates === void 0 || candidates.length === 0) return void 0;
		let currentMeta = {};
		try {
			const entry = (await this.#catalog(resolveConfig(this.#deps.config()))).find((item) => item.id === options.model);
			if (entry !== void 0) currentMeta = {
				...entry.contextWindow === void 0 ? {} : { contextWindow: entry.contextWindow },
				...entry.efforts === void 0 ? {} : { effortCount: entry.efforts.length }
			};
		} catch {}
		const picked = pickFallbackModel({
			provider: options.provider,
			model: options.model,
			...currentMeta
		}, candidates.map((item) => ({
			provider: item.provider,
			model: item.model,
			...item.contextWindow === void 0 ? {} : { contextWindow: item.contextWindow },
			...item.effortCount === void 0 ? {} : { effortCount: item.effortCount }
		})));
		if (picked === void 0) return void 0;
		this.#deps.onModelFallback?.({
			provider: options.provider,
			model: options.model
		}, picked);
		return picked;
	}
	/**
	* 把一次尝试的异常分类成账号级拒绝；返回 `undefined` 表示这是请求级失败
	* （换账号没有意义），调用方应原样上抛。
	*/
	#classify(error) {
		if (error instanceof CommandCodeStreamFailure) {
			const rejection = classifyCommandCodeFailure(error.status, error.body);
			if (rejection === void 0) return void 0;
			return {
				rejection,
				thrown: commandCodeLlmError(rejection, error.status, error)
			};
		}
		if (error instanceof LlmError) {
			if (error.code === ABORTED_CODE) return void 0;
			if (error.code === "LLM_REQUEST_TIMEOUT" || error.code === "LLM_STREAM_IDLE_TIMEOUT") {
				const rejection = classifyCommandCodeFailure(0, { message: error.message });
				if (rejection === void 0) return void 0;
				return {
					rejection,
					thrown: error
				};
			}
			return;
		}
		const rejection = classifyCommandCodeFailure(0, { message: error instanceof Error ? error.message : String(error) });
		if (rejection === void 0) return void 0;
		return {
			rejection,
			thrown: commandCodeLlmError(rejection, void 0, error)
		};
	}
	/** 识别「调用方中止」（`transport.ts` 未导出该码，故比字面量）。 */
	#isAbort(error) {
		return error instanceof LlmError && error.code === ABORTED_CODE;
	}
	/** 消费前已中止时抛出宿主认识的中止错误。 */
	#abortError(signal) {
		return signal?.reason === void 0 ? new LlmError("the caller aborted the request", ABORTED_CODE) : new LlmError("the caller aborted the request", ABORTED_CODE, { cause: signal.reason });
	}
};
/**
* 造一个 Command Code 适配器实例（注册到宿主路由由 Task 14 完成）。
* @param deps - 配置读取、轮换引擎、端口与 I/O 注入点。
* @returns 宿主 `LlmAdapter` 子类实例。
*/
function createCommandCodeAdapter(deps) {
	return new CommandCodeAdapter(deps);
}
/** 允许向回环服务器 POST 凭据的 Studio 来源（旧插件第 8443-8447 行）。 */
const LOGIN_ALLOWED_ORIGINS = [
	"http://localhost:3000",
	"https://staging.commandcode.ai",
	"https://commandcode.ai"
];
/** Studio 页面里承担浏览器登录的路由（旧插件 `STUDIO_AUTH_PATH` 第 8449 行）。 */
const STUDIO_AUTH_PATH = "/studio/auth/cli";
/** 回环服务器唯一接受的路径。 */
const CALLBACK_PATH = "/callback";
/** 本端口所属的 provider 路由（ref 生成用的厂商段）。 */
const VENDOR = "commandcode";
/**
* 目标凭据槽已被另一个账号占用。
*
* 由装配层注入的 `storeKey` 抛出：它比本模块更清楚账号表里都有谁。本模块只负责把它翻译成一个
* **可指名**的失败原因，而不是含糊的 `unavailable` —— 用户需要知道「为什么登录完了却没生效」，
* 以及该怎么办（改名/移除那个账号，或从「添加账户」手动新建）。
*/
var CredentialSlotTakenError = class extends Error {
	ref;
	holderLabel;
	/**
	* @param ref - 被占用的凭据槽。
	* @param holderLabel - 占用者的展示名称。
	*/
	constructor(ref, holderLabel) {
		super(`credential slot "${ref}" is already used by account "${holderLabel}"`);
		this.ref = ref;
		this.holderLabel = holderLabel;
		this.name = "CredentialSlotTakenError";
	}
};
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 读一个字段的字符串值；非字符串一律当缺失。 */
function textOf(record, field) {
	const value = record[field];
	return typeof value === "string" ? value : void 0;
}
/**
* 收窄回调负载：`apiKey` 必须非空，其余字段必须是字符串（旧插件 `isCallbackCredentials`
* 第 8510-8514 行逐字对照）。
* @param value - 已解析的 JSON。
* @returns 合法负载，或 `undefined`（调用方回 400）。
*/
function parseCredentials(value) {
	if (!isRecord$1(value)) return void 0;
	const apiKey = textOf(value, "apiKey");
	const state = textOf(value, "state");
	const userId = textOf(value, "userId");
	const userName = textOf(value, "userName");
	const keyName = textOf(value, "keyName");
	if (apiKey === void 0 || apiKey === "" || state === void 0 || userId === void 0 || userName === void 0 || keyName === void 0) return;
	return {
		apiKey,
		state,
		userId,
		userName,
		keyName
	};
}
/**
* 拼出 Studio 授权网址（纯函数，旧插件 `buildCommandAuthUrl` 第 8457-8460 行）。
*
* 两处都用 `encodeURIComponent` 逐段编码：`callback` 里的 `:`、`/` 必须编码，`state` 里的
* 空格必须是 `%20`（`URLSearchParams` 会写成 `+`，与旧插件产物不一致）。回调地址用的是
* `localhost` 字面量（浏览器侧），监听本身只绑 `127.0.0.1`。
* @param options - Studio 基地址、回调端口与本次 state。
* @returns 授权网址。
*/
function buildCommandCodeAuthUrl(options) {
	const callback = `http://localhost:${options.port}${CALLBACK_PATH}`;
	return `${options.studioBase}${STUDIO_AUTH_PATH}?callback=${encodeURIComponent(callback)}&state=${encodeURIComponent(options.state)}`;
}
/**
* 按网关基地址推导 Studio 基地址（纯函数，旧插件第 8462-8466 行）。
* @param apiBase - 网关基地址。
* @returns 与之配套的 Studio 基地址。
*/
function studioBaseForApiBase(apiBase) {
	if (/^https:\/\/staging-api\.commandcode\.ai/i.test(apiBase)) return "https://staging.commandcode.ai";
	if (/^http:\/\/localhost(:\d+)?$/i.test(apiBase)) return "http://localhost:3000";
	return "https://commandcode.ai";
}
/** 只在白名单里回显 Origin，其它一律空（旧插件 `corsOrigin` 第 8922-8925 行）。 */
function corsOrigin(origin) {
	if (typeof origin !== "string") return "";
	return LOGIN_ALLOWED_ORIGINS.includes(origin) ? origin : "";
}
/** 一个候选端口现在是否空闲（旧插件第 8501-8508 行：探针绑上再放开）。 */
function checkPortAvailable(port) {
	return new Promise((resolve) => {
		const probe = createServer();
		probe.once("error", () => {
			resolve(false);
		});
		probe.once("listening", () => {
			probe.close(() => {
				resolve(true);
			});
		});
		probe.listen(port, "127.0.0.1");
	});
}
/** 关掉一个监听器，吞掉「没在监听/已经关过」这类无害错误（旧插件第 8908-8912 行）。 */
function closeQuietly(server) {
	try {
		server?.close();
	} catch {}
}
/**
* 拿交付的密钥问一次 `GET {apiBase}/alpha/whoami`（旧插件第 8472-8499 行）。
*
* 只认「能通过」与三种失败：401 → `invalid-key`（key 确实不对），其它非 OK → `error`
* （服务端问题，换把 key 也没用），传输层失败 → `network`。任何情况下都不抛：调用方
* 需要的是一个判决，而不是异常。
* @param fetchImpl - 注入的传输实现。
* @param apiBase - 网关基地址。
* @param apiKey - 待验证的密钥。
* @param signal - 尝试的中止信号（取消/超时后让在途请求尽快结束）。
* @returns 判决结果。
*/
async function validateApiKey(fetchImpl, apiBase, apiKey, signal) {
	try {
		const response = await fetchImpl(`${apiBase}/alpha/whoami`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				"accept-encoding": "identity",
				Authorization: `Bearer ${apiKey}`
			},
			...signal === void 0 ? {} : { signal }
		});
		response.body?.cancel().catch(() => void 0);
		if (response.status === 401) return {
			valid: false,
			reason: "invalid-key"
		};
		if (response.ok) return { valid: true };
		return {
			valid: false,
			reason: "error"
		};
	} catch {
		return {
			valid: false,
			reason: "network"
		};
	}
}
/** 一次决定性失败的稳定原因（`reason` 直接进状态面）。 */
var LoginSettleError = class extends Error {
	reason;
	/**
	* @param reason - 稳定文案键。
	* @param message - 供日志阅读的说明（**不进**状态面：`LoginStatus` 只有稳定的键）。
	*/
	constructor(reason, message) {
		super(message);
		this.name = "LoginSettleError";
		this.reason = reason;
	}
};
/**
* 一次网页登录尝试的状态机（单飞）：`begin()` 在等待中时返回同一次尝试，绑定还没落地时
* 返回同一个在途 promise；终态之后的下一次 `begin()` 才开新尝试。
*/
var CommandCodeLoginFlow = class {
	#deps;
	#startPort;
	#portAttempts;
	#statusValue = { state: "idle" };
	#server;
	#timer;
	#attemptAbort;
	/** 当前尝试的 settle 挂钩；收下决定性回调后失效。 */
	#settle;
	/**
	* 尝试代际。交付的密钥会在 `complete()` 里异步验证，这段窗口对取消与重新登录都是敞开的；
	* 代际让迟到的结果认出自己已经不再拥有状态面，从而不落库、不改状态。
	*/
	#attemptSeq = 0;
	/**
	* 正在绑定端口的那次 `begin()`。它落地之前状态面还说不出 `waiting`，所以后来者必须
	* 复用它：两次独立的启动会各绑一个回环服务器，而只有最后一个能被 teardown 关掉 ——
	* 孤儿服务器会在进程余生里继续应答 `/callback`，十次就能把端口窗口耗光。
	*/
	#starting;
	/** 绑定期间到达的 `cancel()`：那次启动落地后自行退场（旧插件第 8659、8611-8620 行）。 */
	#cancelPending = false;
	/**
	* @param deps - 传输、网关基地址、端口/期限覆盖与凭据落库回调。
	*/
	constructor(deps) {
		this.#deps = deps;
		this.#startPort = deps.startPort ?? 5959;
		this.#portAttempts = deps.portAttempts ?? 10;
	}
	/** @returns 等待授权时的授权网址。 */
	get authUrl() {
		return this.#statusValue.authUrl;
	}
	/** @returns 本次实例实际使用的起始端口。 */
	get startPortDefault() {
		return this.#startPort;
	}
	/** @returns 本次实例实际使用的候选端口个数。 */
	get portAttemptsDefault() {
		return this.#portAttempts;
	}
	/**
	* 开始（或接续）一次尝试，返回其最新状态。
	* @returns 最新状态（`waiting` 时带授权网址）。
	*/
	async begin() {
		if (this.#statusValue.state === "waiting" && this.#server !== void 0) return { ...this.#statusValue };
		if (this.#starting !== void 0) return { ...await this.#starting };
		this.#cancelPending = false;
		const starting = this.#startAttempt();
		this.#starting = starting;
		try {
			return { ...await starting };
		} finally {
			if (this.#starting === starting) this.#starting = void 0;
		}
	}
	/** @returns 当前尝试的状态面（副本：调用方改不动内部状态）。 */
	async status() {
		return { ...this.#statusValue };
	}
	/**
	* 取消等待中的尝试；终态不受影响。绑定还没落地时只是标记，等它落地后自行退场。
	*
	* 返回前**等服务器真正关闭**：这样调用方（与测试）看到 `cancelled` 时端口已经释放，
	* 不必靠睡眠去猜。
	*/
	async cancel() {
		if (this.#starting !== void 0) this.#cancelPending = true;
		if (this.#statusValue.state !== "waiting") return;
		await this.#settleTerminal(this.#attemptSeq, {
			state: "failed",
			reason: "cancelled"
		});
	}
	/**
	* 绑定半程：一次尝试、一个服务器、一个 `waiting` 状态。调用方只能经 `begin()` 的单飞栅栏进来。
	* @returns 尝试落地后的状态。
	*/
	async #startAttempt() {
		await this.#teardown();
		const attempt = this.#attemptSeq += 1;
		this.#attemptAbort = new AbortController();
		const port = await this.#findPort();
		const expectedState = randomBytes(32).toString("base64url");
		const settled = new Promise((resolve, reject) => {
			this.#settle = {
				attempt,
				resolve,
				reject
			};
		});
		await this.#bindServer(port, attempt, expectedState);
		if (this.#cancelPending) {
			this.#cancelPending = false;
			this.#attemptAbort?.abort();
			this.#attemptAbort = void 0;
			this.#statusValue = {
				state: "failed",
				reason: "cancelled"
			};
			await this.#closeServer(true);
			return this.#statusValue;
		}
		this.#statusValue = {
			state: "waiting",
			authUrl: buildCommandCodeAuthUrl({
				studioBase: studioBaseForApiBase(this.#deps.apiBase),
				port,
				state: expectedState
			}),
			expiresAt: Date.now() + (this.#deps.timeoutMs ?? 12e4)
		};
		this.#timer = setTimeout(() => {
			this.#settleTerminal(attempt, {
				state: "failed",
				reason: "timeout"
			});
		}, this.#deps.timeoutMs ?? 12e4);
		this.#timer.unref();
		settled.then((credentials) => {
			this.#complete(attempt, credentials);
		}, (failure) => {
			this.#failFrom(attempt, failure);
		});
		return this.#statusValue;
	}
	/**
	* 候选端口里的第一个空闲端口（旧插件 `findPort` 第 8688-8696 行）。
	* @returns 可用端口。
	*/
	async #findPort() {
		for (let index = 0; index < this.#portAttempts; index += 1) {
			const candidate = this.#startPort + index;
			if (await checkPortAvailable(candidate)) return candidate;
		}
		throw new Error(`No available port found after ${this.#portAttempts} attempts starting from port ${this.#startPort}`);
	}
	/**
	* 绑定本次尝试的回环服务器（旧插件 `bindServer` 第 8702-8726 行）。只绑 `127.0.0.1`：
	* 绑定前的失败从 `begin()` 抛出；绑定后的服务器错误结算为带标签的失败。
	*
	* 处理器**带着自己那一次尝试的代际与服务器句柄**进闭包：服务器对象会一直服务它已经接受的
	* 连接，哪怕它早已不是当前尝试的监听器，所以「这条请求属于哪一代」只能由它自己带来，不能
	* 在结算时去读实例上的当前值。服务器错误分支（下面）本来就是这个写法。
	* @param port - 已探测到的空闲端口。
	* @param attempt - 本次尝试的代际。
	* @param expectedState - 本次尝试的 state（闭包进请求处理器）。
	* @returns 监听已建立。
	*/
	#bindServer(port, attempt, expectedState) {
		return new Promise((resolve, reject) => {
			let binding = true;
			const server = createServer((request, response) => {
				this.#handleCallback(request, response, attempt, expectedState, server);
			});
			this.#server = server;
			server.once("error", (error) => {
				if (this.#server !== server) {
					closeQuietly(server);
					return;
				}
				this.#server = void 0;
				closeQuietly(server);
				const failure = new LoginSettleError("error", `Could not bind the login callback server on port ${port}: ${error.code ?? error.message}`);
				if (binding) {
					binding = false;
					reject(failure);
				} else this.#settle?.reject(failure);
			});
			server.listen(port, "127.0.0.1", () => {
				if (!binding) return;
				binding = false;
				resolve();
			});
		});
	}
	/**
	* 一个回调请求（旧插件 `handleCallback` 第 8728-8806 行）。判定顺序是契约的一部分：
	* OPTIONS → 路径 → 方法 → 体积/JSON → 字段 → state。
	*
	* 只有「决定性投递」（拒绝回执与凭据）才需要代际裁决，那两步都交给
	* {@link #settleAttempt}，并把这条请求自己的 `server` 与 `attempt` 一并交过去：本方法本身
	* 不做任何跨代际的读写，所以旧服务器上任何迟到的非决定性应答都无害。
	* @param request - 回环请求。
	* @param response - 回环响应。
	* @param attempt - 接受这条请求的那次尝试的代际。
	* @param expectedState - 那次尝试的 state。
	* @param server - 接受这条请求的那个服务器句柄。
	*/
	#handleCallback(request, response, attempt, expectedState, server) {
		response.setHeader("Connection", "close");
		response.setHeader("Access-Control-Allow-Origin", corsOrigin(request.headers.origin));
		response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
		response.setHeader("Access-Control-Allow-Headers", "Content-Type");
		response.setHeader("Content-Type", "application/json");
		const json = (code, body) => {
			response.writeHead(code);
			response.end(JSON.stringify(body));
		};
		if (request.method === "OPTIONS") {
			request.resume();
			response.writeHead(204);
			response.end();
			return;
		}
		if ((request.url?.split("?")[0] ?? "/") !== CALLBACK_PATH) {
			request.resume();
			json(404, {
				success: false,
				error: "Not found"
			});
			return;
		}
		if (request.method !== "POST") {
			request.resume();
			json(405, {
				success: false,
				error: "Method not allowed. Use POST."
			});
			return;
		}
		let bodyBytes = 0;
		let body = "";
		request.on("data", (chunk) => {
			bodyBytes += chunk.length;
			body += chunk.toString();
			if (bodyBytes > 1e4) request.destroy();
		});
		request.on("end", () => {
			if (request.destroyed) return;
			let payload;
			try {
				payload = JSON.parse(body);
			} catch {
				json(400, {
					success: false,
					error: "Invalid JSON"
				});
				return;
			}
			if (isRecord$1(payload) && "error" in payload) {
				if (textOf(payload, "state") !== expectedState) {
					json(403, {
						success: false,
						error: "Invalid state token"
					});
					return;
				}
				const description = textOf(payload, "error_description") ?? textOf(payload, "error") ?? "";
				this.#settleAttempt(server, attempt, json, 200, { success: true }, new LoginSettleError(textOf(payload, "error") === "access_denied" ? "denied" : "error", description === "" ? "Authorization failed" : description));
				return;
			}
			const credentials = parseCredentials(payload);
			if (credentials === void 0) {
				json(400, {
					success: false,
					error: "Missing required fields"
				});
				return;
			}
			if (credentials.state !== expectedState) {
				json(403, {
					success: false,
					error: "Invalid state token"
				});
				return;
			}
			this.#settleAttempt(server, attempt, json, 200, { success: true }, void 0, credentials);
		});
		request.on("error", () => {});
	}
	/**
	* 应答一次决定性回调、停止监听、结算这次尝试（旧插件 `settleAttempt` 第 8808-8816 行）。
	*
	* **代际裁决**：投递带着接受它的那个 `server` 与 `attempt` 进来，只有「还是当前的服务器 +
	* 还是当前的代际 + 还是当前这次尝试的 settle 挂钩」三者同时成立才准结算与关监听。旧服务器
	* 上一条已经建立的连接（监听器早被 `closeCallback` 优雅关闭了，连接本身还活着）可能在被
	* 替换之后才把请求体送完：若不裁决，它会拿**新尝试**的挂钩结算（于是把旧凭据写进新尝试），
	* 并且关掉新尝试正在用的监听器、偷走它的挂钩（浏览器真实投递被拒，登录一直挂到总期限）。
	* 对当前这次尝试来说，这种 state 本来就不属于它，所以按既有的拒绝形状回 403（不引入新的
	* 文案键，也不改动旧插件的拒绝词汇表）。
	* @param server - 接受这条请求的服务器句柄。
	* @param attempt - 接受这条请求的那次尝试的代际。
	* @param json - 已装配好响应头的应答函数。
	* @param code - 状态码。
	* @param body - 响应体。
	* @param failure - 带标签的失败（拒绝回执）。
	* @param credentials - 通过 state 校验的凭据。
	*/
	#settleAttempt(server, attempt, json, code, body, failure, credentials) {
		const settle = this.#settle;
		if (this.#server !== server || !this.#ownsAttempt(attempt) || settle === void 0 || settle.attempt !== attempt) {
			json(403, {
				success: false,
				error: "Invalid state token"
			});
			return;
		}
		json(code, body);
		this.#closeCallback(server);
		if (failure !== void 0) settle.reject(failure);
		else if (credentials !== void 0) settle.resolve(credentials);
	}
	/**
	* 验证后的收尾：先 `whoami`，再落库，最后推到终态（旧插件 `complete` 第 8828-8871 行）。
	*
	* 每个 await 之后都复检所有权：能在取消之后落库的唯一路径是「最后一次复检与
	* `storeKey` 调用之间没有 await」—— 这里正是如此，写已经交出去就收不回来（本模块不提供
	* 补偿）；但没交出去之前绝不交。
	* @param attempt - 尝试代际。
	* @param credentials - 通过 state 校验的凭据。
	*/
	async #complete(attempt, credentials) {
		if (!this.#ownsAttempt(attempt)) return;
		const verdict = await validateApiKey(this.#deps.fetchImpl, this.#deps.apiBase, credentials.apiKey, this.#attemptAbort?.signal);
		if (!this.#ownsAttempt(attempt)) return;
		if (!verdict.valid) {
			await this.#settleTerminal(attempt, {
				state: "failed",
				reason: verdict.reason
			});
			return;
		}
		try {
			await this.#deps.storeKey(accountRef(VENDOR, credentials.userName), credentials.apiKey, credentials.userName);
		} catch (error) {
			const reason = error instanceof CredentialSlotTakenError ? "credential-slot-taken" : "unavailable";
			await this.#settleTerminal(attempt, {
				state: "failed",
				reason
			});
			return;
		}
		await this.#settleTerminal(attempt, { state: "success" });
	}
	/**
	* 把一次带标签的失败映射到状态面（旧插件 `failFrom` 第 8877-8886 行）。
	* @param attempt - 尝试代际。
	* @param failure - settle 的拒绝原因。
	*/
	async #failFrom(attempt, failure) {
		if (!(failure instanceof LoginSettleError)) return;
		await this.#settleTerminal(attempt, {
			state: "failed",
			reason: failure.reason
		});
	}
	/**
	* 终结一次尝试：清定时器、中止在途验证、**先同步改状态**、再关服务器并等它真的关闭。
	*
	* 顺序不能变：所有权判据是「代际相等 + 状态还是 `waiting`」，先改状态是同步的失效动作；
	* 若先 await 关服务器，窗口里一次迟到的 `whoami` 成功会看到「还拥有尝试」而落库。
	* @param attempt - 尝试代际。
	* @param status - 终态状态面。
	* @returns 本次调用是否真的终结了这次尝试（不是所有者时什么都不做）。
	*/
	async #settleTerminal(attempt, status) {
		if (!this.#ownsAttempt(attempt)) return false;
		this.#clearTimer();
		this.#attemptAbort?.abort();
		this.#attemptAbort = void 0;
		this.#statusValue = status;
		await this.#closeServer(true);
		return true;
	}
	/**
	* 这次代际是否仍然拥有状态面（旧插件 `ownsAttempt` 第 8873-8875 行）：既没被取消/终结，
	* 也没被一次新的 `begin()` 顶掉。
	* @param attempt - 尝试代际。
	* @returns 是否仍拥有。
	*/
	#ownsAttempt(attempt) {
		return this.#attemptSeq === attempt && this.#statusValue.state === "waiting";
	}
	/** 清掉总期限定时器：终态之后还挂着定时器就是句柄泄漏。 */
	#clearTimer() {
		if (this.#timer === void 0) return;
		clearTimeout(this.#timer);
		this.#timer = void 0;
	}
	/**
	* 收下决定性回调后停止监听（旧插件 `closeCallback` 第 8894-8898 行）。只做优雅关闭：
	* 监听端口同步释放，但正在写出的那个 JSON 响应会正常送完；总期限**故意保留**，用它约束
	* 后续的验证与存储。
	*
	* 只关**这一条请求自己的那个服务器**：它可能早就不是当前尝试的监听器了（被替换过），
	* 那时这里什么都不做，绝不去动新尝试的监听器与挂钩。
	* @param server - 接受这条请求的服务器句柄。
	*/
	#closeCallback(server) {
		if (this.#server !== server) return;
		this.#server = void 0;
		this.#settle = void 0;
		closeQuietly(server);
	}
	/**
	* 结束上一次尝试的全部痕迹：定时器、在途验证信号、监听器。不改状态面（调用方决定去向）。
	*/
	async #teardown() {
		this.#clearTimer();
		this.#attemptAbort?.abort();
		this.#attemptAbort = void 0;
		await this.#closeServer(true);
	}
	/**
	* 关掉本次尝试的监听器，并等它**真的关闭**（`close()` 的回调）。取消/成功/超时/失败都要
	* 经过这里，否则端口与句柄会泄漏。
	* @param force - 连已建立的连接一起断掉。取消与超时时没有需要保住的响应，而优雅关闭可能被
	*   一个不守规矩的客户端拖住；收下回调时的关闭走 {@link #closeCallback}，不用这个。
	* @returns 监听器已关闭（或本来就没有）。
	*/
	async #closeServer(force) {
		const server = this.#server;
		this.#server = void 0;
		this.#settle = void 0;
		if (server === void 0) return;
		if (force) server.closeAllConnections();
		await new Promise((resolve) => {
			server.close(() => {
				resolve();
			});
		});
	}
};
/**
* 造一个 Command Code 网页登录端口（回环回调，只绑 `127.0.0.1`）。
* @param deps - 传输、网关基地址、端口/期限覆盖与凭据落库回调。
* @returns 登录端口。
*/
function createCommandCodeLogin(deps) {
	return new CommandCodeLoginFlow(deps);
}
//#endregion
//#region src/core/usage/reset-estimate.ts
/**
* 额度窗口的**重置时间估算**。
*
* ## 背景：为什么需要估算
*
* Command Code 的 `/alpha/billing/credits` 只给窗口的 `used` 与 `cap`，**不给 `resetAt`**：
*
* ```
* windowLimits = { fiveHour: { used: 0.0024, cap: 14 },
*                  weekly:   { used: 14.2285949297, cap: 35 } }
* ```
*
* 而月度窗口的重置时间来自 `/alpha/billing/subscriptions` 的 `currentPeriodEnd` ——
* 所以只有月度能显示真实的重置时刻，5 小时与周只能显示为空。
*
* ## 估算依据（唯一的可观测事实）
*
* 固定窗口（非滚动）的额度是**按时段重置**的：一个 5 小时窗口用完之后，`used` 回到 0。
* 于是「**第一次观测到 `used` 从 0 变正的时刻**」就是那个窗口的起点，加 5 小时就是重置时刻。
*
* ## 三条纪律（缺一不可）
*
* 1. **绝不把估算说成事实**：结论带 `estimated: true`，界面必须显示「约」，且要能区分
*    「厂商给的」与「我们算的」。
* 2. **没有可靠锚点就不给估算**：从未观测到 `used === 0` 的账号（例如插件刚装、窗口早就
*    开始了）只能给「未知」—— 拿安装时刻当锚点会得出一个与真实重置毫无关系的数字。
* 3. **锚点会过期**：窗口长度（5 小时 / 7 天）一到，下一次观测到的 `used` 若再次变正，
*    锚点就换成新那次；否则旧锚点必须丢弃，不能一直往后加窗口长度（那会推出一个永远在
*    未来的假时间）。
*
* @module dsh-llm-account/src/core/usage/reset-estimate
*/
/** 窗口长度（毫秒）。 */
const WINDOW_LENGTH_MS = {
	"five-hour": 18e6,
	week: 6048e5
};
/** 从窗口 key 判断是不是固定窗口（只有固定窗口才能用「起点 + 长度」估算）。 */
function fixedWindowMs(key) {
	const normalized = key.trim().toLowerCase();
	if (normalized.includes("fivehour") || normalized === "5h" || normalized.includes("five-hour")) return WINDOW_LENGTH_MS["five-hour"];
	if (normalized.includes("week")) return WINDOW_LENGTH_MS.week;
}
/**
* 用一次观测更新锚点，并给出重置时刻估算。
*
* 判定顺序（每条都对应一个真实场景）：
*
* 1. 不是固定窗口（月度等）→ 不估算（它们有自己的真实来源或本来就按自然月）；
* 2. 这次没读到 `used`（`undefined`）→ 原样返回旧锚点，**不当作 0**；
* 3. `used === 0` → 记录「窗口当前是空的」：若之前有锚点，说明已经重置过，丢弃它；
* 4. `used > 0` 且没有锚点 → **建立**锚点（这是唯一能确定起点的时刻）；
* 5. `used > 0` 且已有锚点 → 若估算的重置时刻**已经过去**，说明我们错过了重置（插件关着 /
*    没轮询），旧锚点作废、用当前时刻重新锚定；否则沿用旧锚点。
*
* @param previous - 这个窗口上次的锚点状态（没有就 `undefined`）。
* @param observation - 本次观测。
* @returns 新锚点与估算；不可估算时 `estimate` 为 `undefined`。
*/
function estimateReset(previous, observation) {
	const windowMs = fixedWindowMs(observation.key);
	if (windowMs === void 0) return {
		anchor: previous,
		estimate: void 0
	};
	if (observation.used === void 0 || !Number.isFinite(observation.used)) return {
		anchor: previous,
		estimate: previous === void 0 ? void 0 : {
			resetAt: previous.anchorAt + previous.windowMs,
			estimated: true,
			anchorAt: previous.anchorAt,
			windowMs: previous.windowMs
		}
	};
	if (observation.used === 0) return {
		anchor: void 0,
		estimate: void 0
	};
	if (previous !== void 0) {
		const resetAt = previous.anchorAt + previous.windowMs;
		if (resetAt > observation.at) return {
			anchor: previous,
			estimate: {
				resetAt,
				estimated: true,
				anchorAt: previous.anchorAt,
				windowMs: previous.windowMs
			}
		};
		return {
			anchor: {
				anchorAt: observation.at,
				windowMs
			},
			estimate: {
				resetAt: observation.at + windowMs,
				estimated: true,
				anchorAt: observation.at,
				windowMs
			}
		};
	}
	return {
		anchor: {
			anchorAt: observation.at,
			windowMs
		},
		estimate: {
			resetAt: observation.at + windowMs,
			estimated: true,
			anchorAt: observation.at,
			windowMs
		}
	};
}
//#endregion
//#region src/vendors/commandcode/plans.ts
/**
* `planId` 前缀 → 套餐。顺序不重要：{@link subscriptionPlanInfo} 取**最长**匹配，
* 所以 `individual-pro-v1` 命中 `individual-pro-v1`（80）而不是 `individual-pro`（30）
* —— 旧插件的同一处用最长前缀（第 1005-1010 行），CLI 用的是数组顺序的 `find`，
* 这里跟旧插件（它对 `-v1` 变体的额度更准）。
*/
const SUBSCRIPTION_PLANS = {
	"individual-go": {
		name: "Go",
		monthlyCredits: 10
	},
	"individual-go-v1": {
		name: "Go",
		monthlyCredits: 10
	},
	"individual-goat": {
		name: "GOAT",
		monthlyCredits: 70
	},
	"individual-pro": {
		name: "Pro",
		monthlyCredits: 30
	},
	"individual-pro-v1": {
		name: "Pro",
		monthlyCredits: 80
	},
	"individual-provider": {
		name: "Provider",
		monthlyCredits: 15
	},
	"individual-max": {
		name: "Max",
		monthlyCredits: 150
	},
	"individual-ultra": {
		name: "Ultra",
		monthlyCredits: 300
	},
	"teams-pro": {
		name: "Teams Pro",
		monthlyCredits: 40
	}
};
/** 规范化的 `planId`（小写、下划线折成连字符）与命中的前缀。 */
function longestPrefix(planId) {
	const normalized = planId.trim().toLowerCase().replace(/_/g, "-");
	if (normalized === "") return void 0;
	let hit;
	for (const prefix of Object.keys(SUBSCRIPTION_PLANS)) {
		if (!normalized.startsWith(prefix)) continue;
		if (hit === void 0 || prefix.length > hit.length) hit = prefix;
	}
	return hit;
}
/**
* 查一个 `planId` 的套餐名与每月额度。
* @param planId - 端点给的套餐标识原文。
* @returns 命中的套餐；表里没有这个前缀时为 `undefined`（界面退回标识，不猜名称与额度）。
*/
function subscriptionPlanInfo(planId) {
	const prefix = longestPrefix(planId);
	return prefix === void 0 ? void 0 : SUBSCRIPTION_PLANS[prefix];
}
//#endregion
//#region src/vendors/commandcode/quota.ts
/**
* Command Code 额度：四个 `/alpha/*` 端点 → 归一化的 {@link QuotaSnapshot}。
*
* 端点、请求头与负载字段逐条对照旧插件
* `@mars-sea/dsh-commandcode-provider/lib/index.js`：
* - 四个端点（`getUsage` 第 7246-7252 行）：`/alpha/whoami`、`/alpha/usage/summary`、
*   `/alpha/billing/credits`、`/alpha/billing/subscriptions`（带上 whoami 的 `org.id`）；
* - 请求头（`accountHeaders` 第 6994-7005 行）：`Authorization: Bearer` + 身份编码 +
*   `x-command-code-version` + `x-cli-environment` + attribution；
* - 窗口形状（`parseWindowLimit` 第 6384-6393 行）：`{ used, cap, exceeded, resetAt }`
*   位于 `billing/credits` 的 `windowLimits.fiveHour` / `windowLimits.weekly`；
* - 月度窗口（`parseUsageTotals` 第 6372 行的消耗 + 旧插件 `monthlyView` 第 5722-5750 行
*   的套餐配给）：有套餐时 `cap` = 套餐每月额度、`used` = 额度 − `billing/credits` 的
*   `monthlyCredits` **余额**、`resetAt` = 本期结束；没有套餐时退化成 usage 的
*   `totalCredits` 当期已消耗 —— 见 `monthlyCreditsWindowOf` / `planOf`；
* - 预算：与聊天请求同一档（第 7204-7207 行的说明），不用目录的 10 秒探测预算。
*
* **纪律**（设计 §12 Review Focus 4）：字段缺失就是「未知」，绝不倒成 0；缺失的窗口
* 不造出来。**单位**：{@link CommandCodeQuotaKey} 说明每个 key 的 `used`/`cap` 单位；
* `QuotaWindow.percent` 若填，取值 0–100（超出范围视为端点未报告），`resetAt` 一律是
* epoch 毫秒（端点给 ISO 字符串时在此转换）。
* @module dsh-llm-account/src/vendors/commandcode/quota
*/
/** 会产生窗口的端点窗口名（顺序即输出顺序）。 */
const WINDOW_KEYS = ["fiveHour", "weekly"];
/** whoami 端点路径（旧插件第 7246 行）。 */
const WHOAMI_PATH = "/alpha/whoami";
/** 用量汇总端点路径（旧插件第 7249 行）。 */
const USAGE_SUMMARY_PATH = "/alpha/usage/summary";
/** 额度端点路径（旧插件第 7250 行）。 */
const BILLING_CREDITS_PATH = "/alpha/billing/credits";
/** 订阅端点路径（旧插件第 7251 行；带 `orgId` 的写法见 `subscriptionsPath`）。 */
const BILLING_SUBSCRIPTIONS_PATH = "/alpha/billing/subscriptions";
/**
* `failures` 里的端点名与固定顺序。`QuotaSnapshot.failures` 是给 UI 的「哪块数据不完整」，
* 所以用短名而不是旧插件那种带 HTTP 状态的长文案；顺序固定，避免并发完成次序让读数抖动。
*/
const QUOTA_ENDPOINTS = [
	"whoami",
	"usage",
	"credits",
	"subscriptions"
];
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 读取非空字符串。 */
function stringValue(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed === "" ? void 0 : trimmed;
}
/** 读取有限数字（缺失或非数字一律 `undefined`，不倒成 0）。 */
function numberValue(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/** 读取 0–100 的百分比；超出范围视为端点未报告（契约见模块头）。 */
function percentValue(value) {
	const percent = numberValue(value);
	return percent !== void 0 && percent >= 0 && percent <= 100 ? percent : void 0;
}
/**
* 把端点的重置时刻转成 epoch 毫秒。数字按毫秒原样收下（旧插件 `parseWindowLimit`
* 第 6391 行就是这么用的），字符串按 ISO 解析；缺失或解析不了就是「未知」，不补 0、
* 不补当前时间。
* @param value - 端点给的 `resetAt`。
* @returns epoch 毫秒，或 `undefined` 表示未公布。
*/
function epochMillis(value) {
	if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
	const text = stringValue(value);
	if (text === void 0) return void 0;
	const parsed = Date.parse(text);
	return Number.isNaN(parsed) ? void 0 : parsed;
}
/**
* 归一化一个窗口块。字段逐个独立：端点没给的字段保持缺省（`undefined`），
* 而不是倒成 0 —— 缺失与「真的是 0」在 UI 上必须是两种读数。
*
* `unit: "usd"` 是**口径**而不是从负载里读出来的值：`billing/credits` 的两个窗口本来就是
* 美元额度（旧插件把这批数字一律按 `$` 排版：655 行起的窗口行与 `formatMoney` 第 1516 行），
* 所以这里给的是那个已知的单位，不是猜的。
* @param raw - 端点给的窗口块。
* @param key - 窗口 key（自带单位含义）。
* @returns 归一化窗口；端点没公布这个窗口时为 `undefined`。
*/
function windowOf(raw, key) {
	if (!isRecord(raw)) return void 0;
	const window = {
		key,
		unit: "usd"
	};
	const used = numberValue(raw.used);
	if (used !== void 0) window.used = used;
	const cap = numberValue(raw.cap);
	if (cap !== void 0) window.cap = cap;
	const percent = percentValue(raw.percent);
	if (percent !== void 0) window.percent = percent;
	const resetAt = epochMillis(raw.resetAt);
	if (resetAt !== void 0) window.resetAt = resetAt;
	if (typeof raw.exceeded === "boolean") window.exceeded = raw.exceeded;
	return window;
}
/**
* 端点窗口块所在的位置：线上是 `{ windowLimits: { fiveHour, weekly } }`；负载本身直接
* 带窗口时（浅层形状）回退到负载自己。
* @param credits - `billing/credits` 的负载。
* @returns 窗口容器的原始负载。
*/
function windowContainer(credits) {
	return isRecord(credits.windowLimits) ? credits.windowLimits : credits;
}
/**
* `billing/credits` 的额度记录：线上是 `{ credits: { monthlyCredits, ... } }`；
* 浅层形状（负载自己就是额度记录）同样接受。
* @param credits - `billing/credits` 的负载。
* @returns 额度记录，形状不认识时为 `undefined`。
*/
function creditsRecord(credits) {
	if (!isRecord(credits)) return void 0;
	return isRecord(credits.credits) ? credits.credits : credits;
}
/** 端点公布的窗口（`fiveHour` / `weekly`）。 */
function windowLimitsOf(credits) {
	if (!isRecord(credits)) return [];
	const container = windowContainer(credits);
	const unlimited = container.limited === false;
	const windows = [];
	for (const key of WINDOW_KEYS) {
		const window = windowOf(container[key], key);
		if (window !== void 0) windows.push(window);
		else if (unlimited) windows.push({
			key,
			unlimited: true
		});
	}
	return windows;
}
/**
* 月度窗口：有套餐时按**套餐表**算配给，没有套餐时退化成当期已消耗。
*
* 两种口径，都被线上数据钉住：
* 1. **有套餐**（subscriptions 报了 `planId` 且套餐表认得它、credits 报了 `monthlyCredits`
*    余额）：`cap` = 套餐每月额度，`used` = `cap − 余额`，`resetAt` = 本期结束。这是官方
*    CLI 与旧插件同一份算法（旧插件 `monthlyView` 第 5722-5750 行把
*    `credits.credits.monthlyCredits` 当**余额**、`plan.monthlyCredits` 当上限；
*    CLI `getCreditDepletionPct` 同）。线上交叉验证：GOAT（70）余额 55.7714050703 →
*    已用 14.2285949297，与该账号的 `weekly.used` 一字不差。
* 2. **没有套餐**（未订阅 / 端点没报 `planId` / 套餐表不认识 / 余额缺失）：只报
*    `usage.totalCredits` 这个**已消耗**，没有 `cap`、没有 `percent`。把余额当上限会得到
*    一个符号相反、在快用完的账号上能到百分之几百的伪读数（Review Focus 4），所以
*    余额缺失时宁可不算比例。
*
* 三者缺一不可：`cap` 要来自套餐表（不是余额）、余额要端点真的报了（缺失 ≠ 0）、
* `used` 不夹到负数下限以外（`used = max(0, cap − 余额)`，余额超过配给额时显示 0 已用）。
* @param usage - `usage/summary` 的负载。
* @param credits - `billing/credits` 的负载。
* @param plan - 已归一化的套餐（见 {@link planOf}）；没有订阅时为 `undefined`。
* @returns 月度窗口；usage 与 plan 都没给可用数字时为 `undefined`。
*/
function monthlyCreditsWindowOf(usage, credits, plan) {
	const allowance = plan?.monthlyCredits;
	const record = creditsRecord(credits);
	const remaining = record === void 0 ? void 0 : numberValue(record.monthlyCredits);
	if (allowance !== void 0 && allowance > 0 && remaining !== void 0) {
		const window = {
			key: "monthlyCredits",
			used: Math.max(0, allowance - remaining),
			cap: allowance,
			unit: "usd"
		};
		if (plan?.periodEnd !== void 0) window.resetAt = plan.periodEnd;
		return window;
	}
	const used = isRecord(usage) ? numberValue(usage.totalCredits) : void 0;
	if (used === void 0) return void 0;
	return {
		key: "monthlyCredits",
		used,
		unit: "usd"
	};
}
/**
* 归一化订阅套餐。
*
* 来源与旧插件 `getUsage` 第 7257-7261 行同一顺序：subscriptions 的 `data` 优先（带状态、
* 本期结束），`planId` 缺失时退回 credits 的 `planId`（CLI 也用它给遥测盖身份章）。名称与
* 每月额度查 {@link subscriptionPlanInfo}；**表里没有就不给名称与额度**，`id` 与 `status`
* 仍是端点给的原文。
*
* 只认 `data` 是对象的情况：`data: null` 是「这个账号没有订阅」（线上无订阅账号的形状），
* 不是「读失败」—— 读失败走 `failures`，两条路径在界面上是两种显示。
* @param subscriptions - `billing/subscriptions` 的负载。
* @param credits - `billing/credits` 的负载。
* @returns 套餐；两端都没给标识与状态时为 `undefined`。
*/
function planOf(subscriptions, credits) {
	const subscription = isRecord(subscriptions) && isRecord(subscriptions.data) ? subscriptions.data : void 0;
	const record = creditsRecord(credits);
	const id = (subscription === void 0 ? void 0 : stringValue(subscription.planId)) ?? (record === void 0 ? void 0 : stringValue(record.planId));
	const status = subscription === void 0 ? void 0 : stringValue(subscription.status);
	if (id === void 0 && status === void 0) return void 0;
	const plan = { id: id ?? "" };
	if (status !== void 0) plan.status = status;
	const info = id === void 0 ? void 0 : subscriptionPlanInfo(id);
	if (info !== void 0) {
		plan.name = info.name;
		plan.monthlyCredits = info.monthlyCredits;
	}
	const periodEnd = subscription === void 0 ? void 0 : epochMillis(subscription.currentPeriodEnd);
	if (periodEnd !== void 0) plan.periodEnd = periodEnd;
	const periodStart = subscription === void 0 ? void 0 : epochMillis(subscription.currentPeriodStart);
	if (periodStart !== void 0) plan.periodStart = periodStart;
	return plan;
}
/**
* 把四个端点的负载归一化成一次额度读数。纯函数：不做 I/O、不缓存。
* @param parts - 四个端点的负载与已记名的失败项。
* @returns 归一化读数；窗口顺序固定为 `fiveHour`、`weekly`、`monthlyCredits`。
*/
function toQuotaSnapshot(parts) {
	const plan = planOf(parts.subscriptions, parts.credits);
	const windows = [...windowLimitsOf(parts.credits)];
	const monthly = monthlyCreditsWindowOf(parts.usage, parts.credits, plan);
	if (monthly !== void 0) windows.push(monthly);
	return {
		windows,
		...plan === void 0 ? {} : { plan },
		failures: [...parts.failures]
	};
}
/** whoami 的 `org.id`（旧插件 `parseAccountIdentity` 第 6424-6435 行）。 */
function orgIdOf(whoami) {
	if (!isRecord(whoami) || !isRecord(whoami.org)) return void 0;
	return stringValue(whoami.org.id);
}
/** 去掉基地址末尾的斜杠（与 `protocol.ts` 同一归一化）。 */
function trimBase(base) {
	return base.replace(/\/+$/, "");
}
/** 订阅端点：拿到 `orgId` 时带上查询串（旧插件第 7251 行）。 */
function subscriptionsPath(orgId) {
	return orgId === void 0 ? BILLING_SUBSCRIPTIONS_PATH : `${BILLING_SUBSCRIPTIONS_PATH}?orgId=${encodeURIComponent(orgId)}`;
}
/** 一次额度读取要用的请求头（旧插件 `accountHeaders` 第 6998-7004 行）。 */
function accountHeaders(key) {
	return {
		Authorization: `Bearer ${key}`,
		...IDENTITY_ENCODING_HEADER,
		"x-command-code-version": COMMAND_CODE_CLI_VERSION,
		"x-cli-environment": "production",
		...attributionHeaders()
	};
}
/**
* Command Code 的额度端口。`snapshot()` 的顺序：解析当前账号密钥 → `whoami` 拿 `orgId`
* → 并行拉另外三个端点；**每个端点各自 try/catch**，失败只把短名记进 `failures`，其余
* 照常返回（设计 §7.1、§10）。没有可用密钥时抛 `MISSING_CREDENTIAL`（旧插件
* `getUsage` 第 7216-7221 行的同一语义），一个端点都不请求。
* @param deps - 账号 ref、密钥解析、`fetch` 与基地址/预算。
* @returns 额度端口。
*/
function createCommandCodeQuota(deps) {
	const base = trimBase(deps.apiBase === void 0 || deps.apiBase.trim() === "" ? DEFAULT_API_BASE : deps.apiBase);
	const timeoutMs = deps.timeoutMs !== void 0 && Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0 ? deps.timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
	/**
	* 重置时间的**估算锚点**，按「账号 ref × 窗口 key」保存（跨轮询保持）。
	*
	* 为什么需要跨调用状态：估算的依据是「`used` 从 0 变正的那一刻」，而单次读数无法知道
	* 那一刻是什么时候 —— 必须与上一次观测比较。
	*
	* **有上限**：宿主是常驻进程，账号可能被反复增删（每次 `removeAccount` 之后旧 ref 不会
	* 再出现）。不设上限的 Map 会一直长。上限按「账号数 × 窗口种类」量级给足（64），
	* 超了丢最旧的那条 —— 丢掉的代价只是那个窗口的估算重新从这一刻开始。
	*/
	const resetAnchors = /* @__PURE__ */ new Map();
	/** 锚点表的上限（见 {@link resetAnchors} 的说明）。 */
	const RESET_ANCHOR_LIMIT = 64;
	/** 写一个锚点；超过上限时淘汰最早插入的那条（Map 保持插入顺序）。 */
	function rememberAnchor(storageKey, anchor) {
		resetAnchors.delete(storageKey);
		resetAnchors.set(storageKey, anchor);
		while (resetAnchors.size > RESET_ANCHOR_LIMIT) {
			const oldest = resetAnchors.keys().next().value;
			if (oldest === void 0) break;
			resetAnchors.delete(oldest);
		}
	}
	/**
	* 给缺少 `resetAt` 的固定窗口补上估算值。
	*
	* 只补**端点确实没给**的那些（月度有自己的 `currentPeriodEnd`，不动它）。估算结论写进
	* 同一个 `resetAt` 字段，并由 {@link QuotaWindow.resetEstimated} 标记「这是算出来的」，
	* 界面据此显示「约」—— 绝不把估算伪装成厂商事实。
	* @param ref - 账号 ref（锚点按账号分开）。
	* @param windows - 归一化窗口。
	* @returns 新的窗口数组（不修改入参）。
	*/
	function withEstimatedResets(ref, windows) {
		const now = deps.now?.() ?? Date.now();
		const account = ref ?? "(none)";
		return windows.map((window) => {
			if (window.resetAt !== void 0) return window;
			const storageKey = `${account}\u0000${window.key}`;
			const { anchor, estimate } = estimateReset(resetAnchors.get(storageKey), {
				key: window.key,
				used: window.used,
				at: now
			});
			if (anchor === void 0) resetAnchors.delete(storageKey);
			else rememberAnchor(storageKey, anchor);
			return estimate === void 0 ? window : {
				...window,
				resetAt: estimate.resetAt,
				resetEstimated: true
			};
		});
	}
	/** 拉一个端点；任何失败（状态、正文、传输）都只把端点名记进 `failed`。 */
	async function getJson(path, name, headers, failed) {
		try {
			const response = await deps.fetchImpl(`${base}${path}`, {
				headers,
				signal: AbortSignal.timeout(timeoutMs)
			});
			if (!response.ok) {
				failed.add(name);
				return;
			}
			const payload = await response.json();
			if (!isRecord(payload)) {
				failed.add(name);
				return;
			}
			return payload;
		} catch {
			failed.add(name);
			return;
		}
	}
	return { async snapshot(accountRef) {
		const ref = accountRef ?? deps.ref();
		const key = ref === void 0 ? void 0 : normalizeKey(await deps.resolveKey(ref));
		if (key === void 0) {
			const account = ref === void 0 ? "(none selected)" : `"${ref}"`;
			throw new LlmError(`llm-commandcode: no usable API key for Command Code account ${account}; store it through the credentials service, export it in the launching environment, or run \`command-code login\``, "MISSING_CREDENTIAL");
		}
		const headers = accountHeaders(key);
		const failed = /* @__PURE__ */ new Set();
		const whoami = await getJson(WHOAMI_PATH, "whoami", headers, failed);
		const [usage, credits, subscriptions] = await Promise.all([
			getJson(USAGE_SUMMARY_PATH, "usage", headers, failed),
			getJson(BILLING_CREDITS_PATH, "credits", headers, failed),
			getJson(subscriptionsPath(orgIdOf(whoami)), "subscriptions", headers, failed)
		]);
		const snapshot = toQuotaSnapshot({
			...whoami === void 0 ? {} : { whoami },
			...usage === void 0 ? {} : { usage },
			...credits === void 0 ? {} : { credits },
			...subscriptions === void 0 ? {} : { subscriptions },
			failures: QUOTA_ENDPOINTS.filter((name) => failed.has(name))
		});
		return {
			...snapshot,
			windows: withEstimatedResets(ref, snapshot.windows)
		};
	} };
}
//#endregion
//#region src/core/switching/auto-continue.ts
/**
* 可以安全重试的**瞬时**失败码。
*
* 这份白名单而不是黑名单，理由是错了代价不对称：
* - 漏掉一个瞬时码 → 用户手动再发一次，损失很小；
* - 把确定性失败当成瞬时 → 重试 N 次都必然失败，白烧额度、还把一次明确的错误拖成 N 倍延迟。
*
* `TRANSPORT` / `SERVER` / `TIMEOUT` / `EMPTY_RESPONSE` / `RATE_LIMIT` / `THROTTLED`
* 都来自宿主的 `DEFAULT_RETRYABLE_CODES` 与本插件的两个超时码。
*/
const TRANSIENT_CODES = /* @__PURE__ */ new Set([
	"TRANSPORT",
	"SERVER",
	"TIMEOUT",
	"EMPTY_RESPONSE",
	"RATE_LIMIT",
	"THROTTLED",
	"LLM_REQUEST_TIMEOUT",
	"LLM_STREAM_IDLE_TIMEOUT"
]);
/**
* 一个失败码是否属于「中断」这一类（值得重试）。
*
* **用户主动中止永远不算** —— 他按了停止，我们就必须停；把它当成中断去重试，
* 等于把用户的意图覆盖掉。
* 未知码按**不重试**处理（见 `TRANSIENT_CODES` 的说明）。
* @param code - 宿主的失败码（形状不可信）。
* @returns 是否瞬时失败。
*/
function isTransientFailure(code) {
	if (code === void 0) return false;
	if (code === "ABORTED") return false;
	return TRANSIENT_CODES.has(code);
}
/**
* 请求失败时该不该重试。
* @param settings - 当前开关与次数。
* @param code - 失败码。
* @param attempts - 本**轮次**内已经自动继续过几次。
* @returns 是否重试。
*/
function shouldRetryFailure(settings, code, attempts) {
	if (!settings.onError) return false;
	if (attempts >= settings.maxAttempts) return false;
	return isTransientFailure(code);
}
/**
* 回答被截断时该不该续写。
*
* 只认 `finish.reason === "length"`：那是「模型被输出上限截断」的唯一信号。
* `stop`（正常结束）与 `tool-call`（交给工具）都是**正常**完成，续写它们会破坏对话。
* @param settings - 当前开关与次数。
* @param finishReason - 本轮的结束原因（形状不可信）。
* @param attempts - 本轮已自动继续次数。
* @returns 是否续写。
*/
function shouldContinueOnTruncate(settings, finishReason, attempts) {
	if (!settings.onTruncate) return false;
	if (attempts >= settings.maxAttempts) return false;
	return finishReason === "length";
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
* **关掉即静默**：两个开关都不开时本模块不注册任何事件（与项目里其它后台能力的纪律一致）。
* @module dsh-llm-account/src/vendors/auto-continue
*/
/** 续写时发给模型的用户消息（用户可读，也是模型能理解的指令）。 */
const CONTINUE_PROMPT = "继续";
/**
* 注册自动继续的两个事件。
* @param ctx - 宿主 context（只用 `on`）。
* @param settings - 开关与次数上限。
* @param probe - 截断路径所需的最小宿主探针（缺省则不启用续写）。
* @returns 注销函数（把注册的事件都摘掉）。
*/
function applyAutoContinue(ctx, settings, probe) {
	const disposers = [];
	/** 每**轮次**的已自动继续次数：`turn` 变了就重新计数。 */
	const attemptsByTurn = /* @__PURE__ */ new Map();
	const attemptsOf = (turn) => attemptsByTurn.get(turn) ?? 0;
	const bump = (turn) => {
		attemptsByTurn.set(turn, attemptsOf(turn) + 1);
		if (attemptsByTurn.size > 32) {
			const oldest = [...attemptsByTurn.keys()].sort((left, right) => left - right)[0];
			if (oldest !== void 0) attemptsByTurn.delete(oldest);
		}
	};
	if (settings.onError) {
		const off = ctx.on("agent/request-error", async (payload) => {
			const record = typeof payload === "object" && payload !== null ? payload : {};
			const turn = typeof record.turn === "number" ? record.turn : 0;
			const failure = typeof record.failure === "object" && record.failure !== null ? record.failure : {};
			if (!shouldRetryFailure(settings, typeof failure.code === "string" ? failure.code : void 0, attemptsOf(turn))) return;
			bump(turn);
			return { kind: "retry" };
		});
		if (typeof off === "function") disposers.push(off);
	}
	if (settings.onTruncate && probe !== void 0) {
		const off = ctx.on("agent/turn-stopping", async (payload) => {
			const record = typeof payload === "object" && payload !== null ? payload : {};
			const turn = typeof record.turn === "number" ? record.turn : 0;
			const reason = probe.lastFinishReason?.();
			if (!shouldContinueOnTruncate(settings, reason, attemptsOf(turn))) return void 0;
			bump(turn);
			probe.inbox.append({
				role: "user",
				content: CONTINUE_PROMPT
			});
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
//#region src/vendors/search.ts
/**
* 把搜索 provider 注册进宿主。
*
* 宿主没有 `web` 服务（没装 `dsh-web`）时**静默跳过**并留一条警告：那是部署选择，
* 不是本插件的错误；也不能因此把整行弄崩。
* @param ctx - 宿主 context。
* @param deps - 启用判定与注册逻辑。
*/
function applySearch(ctx, deps) {
	if (!deps.enabled()) return;
	if (typeof ctx.inject !== "function") return;
	ctx.inject(["web"], (webCtx) => {
		if (webCtx.web === void 0) return;
		deps.register(webCtx);
	});
}
//#endregion
//#region src/core/switching/search-route.ts
/** 全部策略（渲染下拉与校验都用这一份，避免两处各写一遍）。 */
const SEARCH_STRATEGIES = [
	"gateway-first",
	"api-first",
	"gateway-only",
	"api-only",
	"off"
];
/** 缺省策略：网关优先 —— 用订阅额度，不额外花钱。 */
const DEFAULT_SEARCH_STRATEGY = "gateway-first";
/**
* 用户是否**关掉了**网页搜索。
*
* 只在显式选 `off` 时为真：缺失、空串、其它值一律算启用 —— 线上值形状不可信，
* 把「没配过」当成关闭会让搜索莫名其妙不可用。
* @param strategy - 设置文档里的策略值。
* @returns 是否关闭。
*/
function isSearchDisabled(strategy) {
	return typeof strategy === "string" && strategy.trim().toLowerCase() === "off";
}
/** 支持服务端搜索的网关（实测只有这家）。 */
const SEARCH_CAPABLE_GATEWAY = "opendesign";
/**
* 一个模型 id 是否属于 DeepSeek 系。
*
* 用「段边界」匹配而不是裸 `includes`：`my-deepseek-fork` 不该被当成 DeepSeek，
* 而 `deepseek/...` 与 `DeepSeek-V4-Pro` 都该算。
* @param model - 模型 id（形状不可信）。
* @returns 是否 DeepSeek 系。
*/
function isDeepSeekModel(model) {
	if (model === void 0) return false;
	const value = model.trim().toLowerCase();
	if (value === "") return false;
	return /(?:^|[/_-])deepseek(?:[/_.-]|$)/.test(value);
}
/**
* 判定一次搜索该走哪条路。
* @param input - 会话路由、策略与两条路各自是否可用。
* @returns 选路结果。
*/
function chooseSearchRoute(input) {
	const gatewayReady = input.hasGateway && input.provider === SEARCH_CAPABLE_GATEWAY && isDeepSeekModel(input.model);
	const apiReady = input.hasApiKey;
	switch (SEARCH_STRATEGIES.includes(input.strategy) ? input.strategy : DEFAULT_SEARCH_STRATEGY) {
		case "off": return { kind: "unavailable" };
		case "gateway-only": return gatewayReady ? {
			kind: "gateway",
			provider: SEARCH_CAPABLE_GATEWAY
		} : { kind: "unavailable" };
		case "api-only": return apiReady ? { kind: "api" } : { kind: "unavailable" };
		case "api-first":
			if (apiReady) return { kind: "api" };
			return gatewayReady ? {
				kind: "gateway",
				provider: SEARCH_CAPABLE_GATEWAY
			} : { kind: "unavailable" };
		default:
			if (gatewayReady) return {
				kind: "gateway",
				provider: SEARCH_CAPABLE_GATEWAY
			};
			return apiReady ? { kind: "api" } : { kind: "unavailable" };
	}
}
//#endregion
//#region src/vendors/search-api.ts
/**
* DeepSeek **Search API** 直连（`POST /v1/tools/search`）。
*
* ## 为什么需要这条路（与网关路并存）
*
* | | 网关路（服务端工具） | API 路（本模块） |
* | --- | --- | --- |
* | 端点 | 对话端点 + `tools: web_search_20250305` | `POST /v1/tools/search` |
* | 计费 | 按 **token**（一次搜索 = 一次完整模型调用） | 每 **1000 次成功请求 5 元** |
* | 结果 | 夹在对话流里的 `web_search_tool_result` 块 | 干净的结构化 `results[]` |
* | 依赖 | 必须是 opendesign + DeepSeek 模型 | 任何 DeepSeek API key |
*
* 需求两条都保留、可切优先策略（见 `core/switching/search-route`）。
*
* ## 文档要点（api-docs.deepseek.com/zh-cn/guides/search）
*
* - 请求：`{ query, count?, ori_question?, localization?, need_content? }`，`count` 1–50；
* - 响应：`{ results: [{ title, url, snippet, summary, content, site_name, date, authority,
*   rerank_score }] }`；**空 results 是合法结果**（真的没匹配到）；
* - 计费：只有「HTTP 200 且 results 非空」才计费 —— 失败与空结果都不花钱；
* - 失败码：400 参数错 / 401 key 无效 / 402 余额不足 / 429 限流 / 5xx 服务端。
*
* @module dsh-llm-account/src/vendors/search-api
*/
/** Search API 的路径（基地址固定是 `https://api.deepseek.com`）。 */
const SEARCH_API_PATH = "/v1/tools/search";
/** Search API 的基地址（官方文档只有这一个，没有地区变体）。 */
const SEARCH_API_BASE = "https://api.deepseek.com";
/** `count` 的官方范围。 */
const MIN_COUNT = 1;
const MAX_COUNT = 50;
/** 搜索失败（带上 HTTP 状态码，供调用方区分）。 */
var SearchApiError = class extends Error {
	status;
	constructor(message, status) {
		super(message);
		this.name = "SearchApiError";
		this.status = status;
	}
};
/**
* 把 HTTP 状态码翻成人话。
*
* 分开说是因为处理方式完全不同：401 要换 key、402 要充值、429 等一会再来、
* 5xx 可以重试 —— 统一一句「搜索失败」会让用户无从下手。
* @param status - HTTP 状态码。
* @returns 可读原因。
*/
function reasonOf(status) {
	if (status === 401) return "API key 无效或缺失（401）";
	if (status === 402) return "DeepSeek 账户余额不足（402），请先充值";
	if (status === 403) return "请求被安全策略拒绝（403）";
	if (status === 429) return "触发限流（429），请稍后重试";
	if (status >= 500) return `DeepSeek 服务端错误（${status}），可稍后重试`;
	return `搜索请求失败（HTTP ${status}）`;
}
/** 从错误正文里读出服务端的 message（诊断信息不该被吞掉）。 */
function messageOf(payload) {
	if (typeof payload !== "object" || payload === null) return void 0;
	const error = payload.error;
	if (typeof error !== "object" || error === null) return void 0;
	const message = error.message;
	return typeof message === "string" && message !== "" ? message : void 0;
}
/**
* 把一个实测失败**分档**：这把 key 是「确定不能用」还是「只是这次没测出来」。
*
* 为什么必须分开：只有 401/402/403 是服务端在**说这把密钥有问题**；网络错误、超时、5xx
* 都可能是此刻的抖动 —— 把它们报成「密钥无效」会让用户去换一把其实没问题的密钥，
* 而那正是最难自查的误导。
* @param error - 实测时捕获的错误。
* @returns `invalid`（确定不能用）或 `unknown`（没能判定）。
*/
function probeVerdictOf(error) {
	const status = error instanceof SearchApiError ? error.status : void 0;
	if (status === 401 || status === 402 || status === 403) return "invalid";
	return "unknown";
}
/**
* 实测一把搜索密钥：发一次**最小**请求，回答它到底能不能用。
*
* 与正式搜索的区别只有两点，都是为了「小」：
* 1. `query` 固定成一个短词、`count: 1` —— 计费按请求次数，最小化请求即最小化开销；
* 2. **空结果算成功**（`ok`）：那说明鉴权与配额都通过了，只是这个词没搜到东西。
*    这正是「密钥能用」要证明的事，不该误报成不可用。
*
* 早期版本还会在本地先挡掉含非 ASCII 的密钥（那种值会在构造请求头时就抛
* `Cannot convert argument to a ByteString`），现在交给 `probeVerdictOf` 归到 `unknown`
* 之外的 `invalid` 更准确 —— 见下面的显式判断。
* @param input - 密钥与注入的 fetch。
* @returns 结论与可读原因。
*/
async function probeSearchKey(input) {
	if (/[^\x20-\x7E]/.test(input.key)) return {
		state: "invalid",
		reason: "密钥里含非 ASCII 字符（多半是粘贴错了，把中文或空格存进来了）"
	};
	try {
		await searchViaApi({
			query: "deepseek",
			key: input.key,
			maxResults: 1,
			fetchImpl: input.fetchImpl,
			...input.signal === void 0 ? {} : { signal: input.signal }
		});
		return { state: "ok" };
	} catch (error) {
		return {
			state: probeVerdictOf(error),
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}
/**
* 发一次 Search API 请求。
* @param input - 查询、密钥与注入的 fetch。
* @returns 来源列表（可能为空 —— 空结果是合法结果）。
* @throws {SearchApiError} HTTP 失败或响应形状不认识。
*/
async function searchViaApi(input) {
	const body = { query: input.query };
	if (input.maxResults !== void 0 && Number.isFinite(input.maxResults)) body.count = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(input.maxResults)));
	const response = await input.fetchImpl(`${SEARCH_API_BASE}${SEARCH_API_PATH}`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${input.key}`,
			"content-type": "application/json"
		},
		body: JSON.stringify(body),
		...input.signal === void 0 ? {} : { signal: input.signal }
	});
	if (!response.ok) {
		let detail;
		try {
			detail = messageOf(await response.json());
		} catch {
			detail = void 0;
		}
		const reason = reasonOf(response.status);
		throw new SearchApiError(detail === void 0 ? reason : `${reason}：${detail}`, response.status);
	}
	const payload = await response.json();
	const results = typeof payload === "object" && payload !== null ? payload.results : void 0;
	if (!Array.isArray(results)) throw new SearchApiError("Search API 响应里没有 results 数组");
	const sources = [];
	for (const item of results) {
		if (typeof item !== "object" || item === null) continue;
		const record = item;
		const url = typeof record.url === "string" && record.url !== "" ? record.url : void 0;
		if (url === void 0) continue;
		const title = typeof record.title === "string" && record.title !== "" ? record.title : url;
		sources.push({
			url,
			title
		});
	}
	return { sources };
}
//#endregion
//#region src/vendors/search-provider.ts
/**
* 统一搜索提供方：把「网关额度优先、API key 兜底」接到宿主的 `ctx.web` 上。
*
* ## 为什么插件要自己注册一个 provider
*
* 宿主自带的 `dsh-web-search-deepseek` 只做「DeepSeek 账号 token → DEEPSEEK_API_KEY」，
* 不会用**网关订阅额度**。用户的诉求是「优先用登录的供应商账号额度」，所以本插件在旁边注册
* 自己的 provider：能用网关就用网关，否则回退 API key。
*
* ## 接口形状（读自 `dsh-web-search-deepseek/lib/index.js`）
*
* ```js
* { id, available(), async search(request, signal) }
* ```
*
* `available()` 是**廉价的本地检查**（宿主在选路时会调它，不能发网络请求）；
* `search()` 返回 `{ sources: [{ url, title, snippet? }], truncated: boolean }`。
*
* **`truncated` 是必填的**（2026-10-23 收紧）：宿主的 `web_search` 工具把返回值按一份
* JSON schema 校验，其中它是 `required: true`。漏传会让整个返回值过不了校验，宿主报
* `value is not lossless JSON` —— 那句话听起来像编码问题，实际是 schema 失败。
*
* ## 三条硬规矩
*
* 1. **没有 `web_search_tool_result` 就是失败**。实测网关走错协议时会回 200、模型只输出
*    「web_search query: …」文本 —— 把那种文本当成结果，等于让模型胡编一个答案。
* 2. `available()` 不发网络请求（宿主拿它做选路，慢一次就拖慢每次搜索）。
* 3. 两条路都不可用时**明确抛错**，不返回空 sources 冒充成功。
* @module dsh-llm-account/src/vendors/search-provider
*/
/** 本 provider 的稳定 id（宿主注册表的键）。 */
const SEARCH_PROVIDER_ID$1 = "llm-account-deepseek";
/** 辅助搜索请求的模型（与宿主同一档）。 */
const SEARCH_MODEL = "deepseek-v4-flash";
/** Anthropic 版本头（与宿主同一条）。 */
const API_VERSION = "2023-06-01";
/**
* 从一次 Messages 响应里抽出搜索结果。
*
* **没有 `web_search_tool_result` 就是失败**：这是本模块最重要的一条。
* 实测踩到过 —— 网关走错协议时回 200，模型只输出「web_search query: xxx」这段文本，
* 一条结果都没有。把那种文本当结果，等于让模型对着空气编答案。
* @param payload - 已解析的响应正文（形状不可信）。
* @returns 来源列表；截断标记。
* @throws 当响应里没有任何搜索结果块时。
*/
function sourcesOf(payload) {
	const content = typeof payload === "object" && payload !== null ? payload.content : void 0;
	if (!Array.isArray(content)) throw new SearchUnavailableError("搜索响应里没有 content 块");
	const sources = [];
	let sawResultBlock = false;
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const record = block;
		if (record.type !== "web_search_tool_result") continue;
		sawResultBlock = true;
		const items = record.content;
		if (!Array.isArray(items)) continue;
		for (const item of items) {
			if (typeof item !== "object" || item === null) continue;
			const entry = item;
			if (typeof entry.url !== "string" || entry.url === "") continue;
			const title = typeof entry.title === "string" && entry.title !== "" ? entry.title : entry.url;
			sources.push({
				url: entry.url,
				title
			});
		}
	}
	if (!sawResultBlock) throw new SearchUnavailableError("网关没有执行服务端搜索（响应里没有 web_search_tool_result）—— 多半是模型或协议不支持");
	return {
		sources,
		truncated: false
	};
}
/** 搜索不可用（宿主会把消息呈现给用户）。 */
var SearchUnavailableError = class extends Error {
	code = "WEB_PROVIDER_UNAVAILABLE";
	constructor(message) {
		super(message);
		this.name = "SearchUnavailableError";
	}
};
/**
* 这个策略失败后**允许**回退到另一条路吗。
*
* 与 `chooseSearchRoute` 里的语义严格对齐：`*-first` 是「优先但可回退」，`*-only` 与 `off`
* 是「不许偷偷换路」（用户明确要求只用某一条，换过去会违背他的意图 —— 也可能烧他的余额）。
* @param strategy - 设置文档里的策略值。
* @returns 失败后是否还可以试另一条路。
*/
function strategyCanFallBack(strategy) {
	if (typeof strategy !== "string") return true;
	const value = strategy.trim().toLowerCase();
	return value.endsWith("-first") || value === "";
}
/**
* 用一组 key 依次尝试 Search API（多 key 轮替）。
*
* 与旧实现的差别：旧版只在「HTTP 401/402」时换下一把，而没有状态码的失败（请求根本没发出去）
* 直接终止 —— 实测最典型的就是密钥里混进中文导致的 `ByteString` 错误。那把 key 永远用不了，
* 但**别的 key 可能是好的**，所以现在也换。
* 每一把的失败原因都会累积进最终消息，用户不必靠猜。
* @param apiKeys - 按优先级排列的 key。
* @param request - 搜索请求。
* @param signal - 取消信号。
* @returns 成功的结果或失败原因。
*/
async function searchWithApiKeys(apiKeys, request, fetchImpl, signal) {
	const reasons = [];
	for (const item of apiKeys) try {
		return {
			kind: "ok",
			sources: (await searchViaApi({
				query: request.query,
				key: item.key,
				...request.maxResults === void 0 ? {} : { maxResults: request.maxResults },
				fetchImpl,
				...signal === void 0 ? {} : { signal }
			})).sources
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		reasons.push(`${item.ref}: ${message}`);
		if (!worthAnotherKey(error)) break;
	}
	return {
		kind: "failed",
		reason: `搜索失败（已尝试 ${reasons.length} 个密钥）—— ${reasons.join("；")}`
	};
}
/**
* 把一个 provider 注册进宿主的 `ctx.web`，并返回注销函数。
*
* 宿主的 `registerSearchProvider` 返回它自己的 disposer（随调用方 fiber 释放）；
* 这里只做形状适配，让装配层不必认识 provider 的具体类型。
* @param webCtx - 已注入 `web` 的宿主上下文。
* @param deps - 传输与凭据解析。
* @returns 注销函数。
*/
function registerSearchProvider(webCtx, deps) {
	const web = webCtx.web;
	if (web === void 0) return () => void 0;
	const provider = createSearchProvider(deps);
	const dispose = web.registerSearchProvider(provider);
	return typeof dispose === "function" ? dispose : () => void 0;
}
/**
* 从一个错误里取出 HTTP 状态码（轮替判定要用）。
* @param error - 捕获到的错误。
* @returns 状态码；不是 `SearchApiError` 时为 `undefined`。
*/
function statusOf(error) {
	return error instanceof SearchApiError ? error.status : void 0;
}
/**
* 这个错误是「用户取消」吗。
*
* `fetch` 遇到 abort 抛的是 `DOMException`（`name: "AbortError"`），不是 `SearchApiError` ——
* 所以轮替判定必须单独认出它，否则取消会被当成「这把 key 有问题」。
* @param error - 捕获到的错误。
* @returns 是否是取消。
*/
function isAbortError(error) {
	if (typeof error !== "object" || error === null) return false;
	return error.name === "AbortError";
}
/**
* 这个失败是否「换一把 key 就有可能好」。
*
* 三类属于：
* 1. **401/402**：这把 key 无效或余额不足（原本就有的判定）；
* 2. **压根没发出请求**（没有状态码）：实测最典型的是密钥里混进了中文 —— fetch 在构造请求头时
*    就抛 `Cannot convert argument to a ByteString`。这把 key 永远用不了，但**别的 key 可能好好
*    的**，所以必须换下一条；
* 3. **429/5xx**：按厂商限流/服务端错误，换了也一样 —— **不换**。
*
* 这条判据来自 2026-10-20 的真机数据：用户把一段中文误存成 `DEEPSEEK_API_KEY`，而真正能用的
* `DEEPSEEK_API_KEY_2` 排在后面；旧逻辑因为「没有状态码 → 不换 key」既没试到好 key，
* 也没回退网关，搜索直接不可用。
*
* **取消是第四类，且优先级最高**：用户按了停止，就该立刻停。旧代码把 `AbortError` 归进
* 「没有状态码」那一类，于是拿着同一个已 abort 的信号把剩下每把 key 都试一遍（每把都瞬间失败），
* 最后还给用户一句「已尝试 N 个密钥」—— 取消压根不是密钥的问题。
* @param error - 捕获到的错误。
* @returns 是否该换下一把 key。
*/
function worthAnotherKey(error) {
	if (isAbortError(error)) return false;
	const status = statusOf(error);
	if (status === void 0) return true;
	return status === 401 || status === 402;
}
/**
* 造一个搜索 provider（注册到 `ctx.web.registerSearchProvider`）。
* @param deps - 传输、会话路由与凭据解析。
* @returns 宿主形状的 provider。
*/
function createSearchProvider(deps) {
	/** 网关路是否可用（异步：要解析那家的密钥）。 */
	const gatewayReady = async (provider) => {
		if (provider !== "opendesign") return void 0;
		return await deps.gatewayAccess(provider);
	};
	/** 当前该走哪条路（只解析凭据，不发搜索请求）。 */
	const route = async () => {
		const { provider, model } = deps.sessionRoute();
		const apiKeys = await deps.resolveApiKeys();
		const access = await gatewayReady(provider);
		return {
			chosen: chooseSearchRoute({
				provider,
				model,
				strategy: deps.strategy(),
				hasApiKey: apiKeys.length > 0,
				hasGateway: access !== void 0
			}),
			apiKeys,
			...access === void 0 ? {} : { access }
		};
	};
	return {
		id: SEARCH_PROVIDER_ID$1,
		/**
		* 宿主拿它做选路。**必须廉价**：不发网络请求。
		*
		* ## 为什么现在要判 `off`（2026-10-23）
		*
		* 原来恒返回 `true`。后果是：用户把搜索方式选成「不启用」之后，宿主仍然认为
		* 本 provider **可用** —— 它继续把每次搜索都交给这里，而这里必然抛「网页搜索
		* 已被关闭」。别的搜索插件即使装了也排不上队。
		*
		* 更糟的是 `WEB_PROVIDER_AMBIGUOUS`：配置里不写 `searchProvider` 时，宿主收集
		* 所有 `available()` 为真的 provider，**两个以上直接报错**，两个都用不了。
		* 恒 `true` 让本插件成为那个「永远占着名额却不干活」的条目。
		*
		* 现在：明确选了 `off` 就报 `false`，把名额让出来。
		*
		* 注意宿主的行为（实测 `dsh-web` 源码）：配置的 id **已注册但 unavailable** 时
		* 报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`，**不会回退**到别的 provider。所以
		* 光靠这里返回 `false` 会让搜索直接报错 —— 配套动作是 `search-release.ts`：
		* 切到 `off` 的那一刻把 `web.searchProvider` 置空，让宿主走「未指定 id」的选路。
		*
		* 仍然不做完整判定（那要解析凭据，是异步的）：只要**没有被明确关闭**就报告可用，
		* 真正的失败在 `search()` 里给出可读原因。
		*/
		available() {
			return !isSearchDisabled(deps.strategy());
		},
		async search(request, signal) {
			const { chosen, apiKeys, access } = await route();
			if (chosen.kind === "unavailable") {
				if (isSearchDisabled(deps.strategy())) throw new SearchUnavailableError("网页搜索已被关闭（搜索方式选了「不启用」）");
				throw new SearchUnavailableError("没有可用的搜索凭据：当前策略下两条路都不可用。请在功能页选择搜索方式，并配好 DeepSeek API key（或 opendesign 账号）");
			}
			if (chosen.kind === "api") {
				if (apiKeys.length === 0) throw new SearchUnavailableError("没有解析到 DeepSeek API key");
				const failure = await searchWithApiKeys(apiKeys, request, deps.fetchImpl, signal);
				if (failure.kind === "ok") return {
					sources: failure.sources,
					truncated: false
				};
				if (signal?.aborted === true) throw new SearchUnavailableError("搜索已取消");
				if (!strategyCanFallBack(deps.strategy()) || access === void 0) throw new SearchUnavailableError(failure.reason);
			}
			if (access === void 0) throw new SearchUnavailableError("网关联署密钥不可用，搜索无法走订阅额度");
			const { baseURL, key } = access;
			const body = {
				model: SEARCH_MODEL,
				max_tokens: 4096,
				messages: [{
					role: "user",
					content: request.query
				}],
				tools: [{
					type: "web_search_20250305",
					name: "web_search",
					max_uses: 3
				}]
			};
			let response;
			try {
				response = await deps.fetchImpl(`${baseURL.replace(/\/$/, "")}/messages`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-api-key": key,
						authorization: `Bearer ${key}`,
						"anthropic-version": API_VERSION
					},
					body: JSON.stringify(body),
					...signal === void 0 ? {} : { signal }
				});
			} catch (error) {
				if (isAbortError(error)) throw new SearchUnavailableError("搜索已取消");
				throw new SearchUnavailableError(`搜索请求没能发出：${error instanceof Error ? error.message : String(error)}`);
			}
			if (!response.ok) throw new SearchUnavailableError(`搜索请求失败：HTTP ${response.status}`);
			const result = sourcesOf(await response.json());
			const max = request.maxResults;
			if (typeof max === "number" && max > 0 && result.sources.length > max) return {
				sources: result.sources.slice(0, max),
				truncated: true
			};
			return result;
		}
	};
}
//#endregion
//#region src/vendors/search-release.ts
/**
* 搜索关闭时**让出**宿主的 `web.searchProvider` 槽位（2026-10-23）。
*
* ## 为什么需要（实际情况的场景）
*
* 用户的 profile 里显式写着：
*
* ```yaml
* - id: web
*   config:
*     searchProvider: llm-account-deepseek
* ```
*
* 宿主的选路是「按 id 精确匹配，命中就用」：
*
* ```js
* if (configuredId !== undefined) {
*   const provider = providers.get(configuredId);
*   if (!provider) throw new WebError("not registered");
*   if (!provider.available()) throw new WebError("registered but unavailable");
*   return provider;
* }
* ```
*
* 于是三种坏结果：
*
* 1. 用户在本插件里选了 `off`（不启用网页搜索）→ `search()` 抛
*    「网页搜索已被关闭」，**但宿主仍然把请求交给本插件**，别的搜索插件排不上队；
* 2. 用户装了第二个搜索插件、又删掉 `searchProvider` 行 → 本插件
*    `available()` 恒为 `true`，两个都「可用」→ 宿主报
*    `WEB_PROVIDER_AMBIGUOUS`，**两个都用不了**；
* 3. 用户既选 `off` 又装别的插件 → 组合了上面两条。
*
* ## 做法
*
* **只在用户切到 `off` 的那一刻改一次配置**，把
* `web` 行的 `searchProvider` 置空 —— 于是宿主走「未指定 id」的选路：
*
* - 只注册了一个 provider → 用它（这时可能是别的插件，正是用户想要的）；
* - 一个都没有 → 报 `no usable web provider`（诚实，不是静默失败）。
*
* 切回任何启用态时再把值写回本插件的 id，恢复原来的绑定。
*
* ## 为什么不在启动时校准（有意为之）
*
* 启动时改配置意味着「每次开 DSH 都可能写一次 profile」，而用户看配置文件时
* 会以为那是自己写的。只在**用户动作**的瞬间改，因果关系清楚。
*
* @module dsh-llm-account/src/vendors/search-release
*/
/** 本插件注册的搜索 provider id（宿主注册表的键）。 */
const SEARCH_PROVIDER_ID = "llm-account-deepseek";
/** `web` 行配置里我们关心的那一个字段。 */
const FIELD = "searchProvider";
/**
* 从 `describe` 的返回值里读出 `searchProvider` 的现值。
* @param value - `web` 行的配置对象（形状不可信）。
* @returns 现值；缺失或不是字符串时为 `undefined`。
*/
function configuredProviderOf(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const raw = value[FIELD];
	return typeof raw === "string" ? raw : void 0;
}
/**
* 按当前策略校准 `web.searchProvider`。
*
* - 策略是 `off` 且当前值指向本插件 → 置空（让出槽位）；
* - 策略不是 `off` 且当前值为空 → 写回本插件 id（恢复绑定）；
* - 其它组合一律**不动**（用户显式指向别的插件时，绝不抢）。
*
* @param input - 设置端口、策略读取器与可选的日志函数。
* @returns 是否真的改了配置（测试与调用方据此决定是否提示用户）。
*/
async function syncSearchProviderSlot(input) {
	const { settings, strategy } = input;
	const warn = input.warn ?? ((message) => console.warn(message));
	let snapshot;
	try {
		snapshot = await settings.describe("web");
	} catch {
		return false;
	}
	const current = configuredProviderOf(snapshot.value);
	if (typeof strategy() === "string" && strategy().trim().toLowerCase() === "off") {
		if (current === void 0 || current === "") return false;
		if (current !== "llm-account-deepseek") return false;
		try {
			await settings.mutate("web", [{
				op: "set",
				path: [FIELD],
				value: ""
			}], snapshot.revision);
			return true;
		} catch (error) {
			warn(`[dsh-llm-account] 未能让出 web.searchProvider（搜索已关闭，但宿主仍会把它交给我们）：${String(error)}`);
			return false;
		}
	}
	if (current === void 0 || current === "") try {
		await settings.mutate("web", [{
			op: "set",
			path: [FIELD],
			value: SEARCH_PROVIDER_ID
		}], snapshot.revision);
		return true;
	} catch (error) {
		warn(`[dsh-llm-account] 未能恢复 web.searchProvider 绑定：${String(error)}`);
		return false;
	}
	return false;
}
//#endregion
//#region src/core/switching/search-keys.ts
/**
* 搜索 key 的**引用名列表**与轮替规则（纯函数）。
*
* ## 为什么是「多引用名」而不是「多把明文 key」
*
* 密钥只经凭据服务进出，设置文档里**永远不落明文**（项目全局约束）。所以「多个 key」
* 的实现方式是：设置里存**多个引用名**，每个引用名在凭据库里对应一把真 key。
*
* ## 轮替规则（为什么只对 401/402 换 key）
*
* - **401 无效 / 402 余额不足**：换下一条，那条可能还能用 —— 这是多 key 的**唯一目的**；
* - **429 限流 / 5xx**：换 key 也一样（限速按账号、服务端错误与 key 无关），白折腾还多花钱；
* - **400 参数错**：请求本身有问题，换谁都一样。
*
* @module dsh-llm-account/src/core/switching/search-keys
*/
/**
* 清洗一份 key 引用名列表。
*
* 设置文档的形状不可信：可能是 `undefined`、字符串、含非字符串元素的数组。
* 空串/纯空白一律丢掉（空引用名会解析到不存在的凭据），重复项去重但**保留首次出现的顺序**
* —— 那个顺序就是用户的优先级。
* @param raw - 设置文档里的原始值。
* @returns 清洗后的引用名列表。
*/
function normalizeSearchKeyRefs(raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	for (const item of raw) {
		if (typeof item !== "string") continue;
		const trimmed = item.trim();
		if (trimmed === "") continue;
		if (!out.includes(trimmed)) out.push(trimmed);
	}
	return out;
}
//#endregion
//#region src/vendors/commandcode/index.ts
/**
* Command Code 入口：一行装配（设计 §5.1；profile 行 id 与设置命名空间都是 `llm-commandcode`）。
*
* 宿主把这一行的 `config` 按本模块导出的 `Config` 解析后交给 {@link apply}；字段全部
* volatile，所以每次读取都拿最新值（改完立即生效）。`Config` 同时是**账号文档**的形状：
* `accounts` / `activeAccount` / `modelAccountRules` / `credentialCleanupRefs` 就是用户
* profile patch 里已有的那些字段，账号端口经 `ctx.settings.describe/mutate` 原样读写它 ——
* 用户现有的两行配置**一字不改**即可继续用（零迁移，设计 §5.1）。
*
* 装配产物：
* - 轮换引擎（顺序 = 顶层默认账号 + `accounts` 列表，固定 = `activeAccount`，规则 =
*   `modelAccountRules`，自动切换 = `autoSwitch`）—— 状态一变即重建，拒绝记忆随之搬迁；
* - 意图日志（存储 = 设置文档的隐藏字段 `accountIntents`，**每个命名空间唯一一个实例**）；
* - 账号端口（Task 10）、额度端口（Task 10）、登录端口（Task 11，本期只构造并挂在返回的
*   装配产物上，远程暴露留给计划 1b）；
* - `ctx.llm.registerAdapter(["commandcode"], adapter)` 注册路由。
*
* 本期**不**做：客户端页面与统一账号中心（1b）、真机安装与旧插件切换（1c）、客户端
* bundle、第 2/3 期功能（额度卡片、套餐过滤、费用估算、联网搜索、ZDR、代理等）。
* @module dsh-llm-account/src/vendors/commandcode/index
*/
/** 插件名（fiber 名与日志前缀；行 id 由 patch 层给定，两者同名）。 */
const name = "llm-commandcode";
/** 本行需要的宿主服务：只声明 `llm`（设置与凭据按需现取，缺席时各自报错/降级）。 */
const inject = ["llm"];
/** provider 路由 id（全局约束，不得更改）。 */
const PROVIDER_ID = "commandcode";
/** 意图日志在设置文档里的隐藏字段（本项目自己的持久化字段，旧插件没有）。 */
const INTENTS_FIELD = "accountIntents";
/** 设置行候选名：本行的行 id 与命名空间同名。 */
const SETTINGS_ROWS = [COMMAND_CODE_SETTINGS_NS];
/**
* 这一行的 Config：全部字段 volatile（改完立即生效、可经设置表单逐路径写入），
* 只有 `apiKey` 例外 —— 它是组合配置里的非持久化秘密字面量，没有任何设置界面写它。
*
* 声明的是**用户现有的字段名**（旧插件 Config schema 第 10044-10083 行的子集）：
* `apiKeyEnv` / `accounts` / `activeAccount` / `modelAccountRules` / `credentialCleanupRefs`
* 是账号文档，其余是路由连接事实。旧插件里本期的非目标字段（`webSearch`、`zdr`、
* `filterModelsByPlan`、`modelsCachePath`、`accountEnrollmentTasks` 等）没有声明：
* schemastery 的 object 解析会把未声明字段原样带过，所以它们仍然留在文档里，只是本期
* 不读也不改（第 2/3 期再接）。
*
* 类型上显式标成「宿主要求的最小 Config 面」（{@link PluginConfigSchema}）：schemastery 的
* 推断类型会展开出 cosmokit 的 `Dict`，dts 生成器无法为它写出可移植的引用（TS2883）；入口
* 本来就把配置读成 `Record<string, unknown>`，这个注解只影响声明文件，不影响运行时的
* schema 对象。
*/
const Config = z.object(markVolatileFields({
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	apiKey: z.string().role("secret"),
	apiBase: z.string(),
	workingDir: z.string(),
	protocol: z.union([
		"openai",
		"messages",
		"cli"
	]),
	/**
	* 是否注册这条 provider 路由。
	*
	* **三行对称**（2026-10-20 复审发现）：opencode 与 opendesign 早就有这个字段并据此
	* 决定是否 `registerAdapter`，唯独 commandcode 没有 —— 于是用户手改 profile 把它配成
	* `enabled: false` **不会生效**（另外两家会）。字段缺省读作启用；只有显式 `false` 才撤下。
	*/
	enabled: z.boolean().default(true),
	requestTimeoutMs: z.number(),
	streamIdleTimeoutMs: z.number(),
	defaultMaxTokens: z.number(),
	visibleModels: z.array(z.string()),
	modelVisibility: z.dict(z.boolean()),
	removedModels: z.array(z.string()),
	showSidebarQuota: z.boolean().default(false),
	/**
	* 侧边栏额度卡片的刷新间隔（分钟），与 opencode 对称。缺省 1 分钟、上限 120 分钟，
	* 见 opencode 入口的同名字段说明。
	*/
	quotaRefreshMinutes: z.number().step(1).min(1).max(120).default(1),
	/**
	* **额度用尽后是否自动切换模型**。
	*
	* 关着时：账号全被限额拒绝就直接报错，不替用户换模型。
	* 打开后按四级优先（同网关同名 → 跨网关同名 → 同网关异名 → 跨网关异名）随机挑一个，
	* 且**只在该账号已勾选的模型里**。
	*/
	autoSwitchModelOnQuota: z.boolean().default(false),
	/**
	* **自动继续**：会话非人为中断后自动接着跑。
	*
	* 两台开关都默认关闭：自动续写会改变对话内容、也可能烧额度，与
	* `autoSwitchModelOnQuota` 同一条「危险能力默认关」原则。
	*
	* 这些字段挂在**这一行**不是因为它属于 commandcode，而是因为功能页是跨厂商的，
	* 需要一个固定的承载行（详见设计文档 §4.2）。三家 schema 都声明它们，
	* 谁先加载都能读到同一个值。
	*/
	autoContinueOnError: z.boolean().default(false),
	autoContinueOnTruncate: z.boolean().default(false),
	autoContinueMaxAttempts: z.number().default(3),
	/** 功能页的两台开关：关掉只隐藏界面那一块，不影响已配置的能力。 */
	/** 搜索：是否优先用网关订阅额度（默认是；没有可用网关时回退 API key）。 */
	searchStrategy: z.union([
		"gateway-first",
		"api-first",
		"gateway-only",
		"api-only",
		"off"
	]).default("gateway-first"),
	/** 搜索用的 API key 凭据引用名（配在凭据服务里，不是明文）。 */
	searchApiKeyRefs: z.array(z.string().role("credential-ref")).default(["DEEPSEEK_API_KEY"]),
	accounts: z.array(z.object({
		label: z.string(),
		apiKeyEnv: z.string().role("credential-ref"),
		/** 旧插件允许的内联密钥；本包不读它（密钥只走凭据服务），但写回时原样保留。 */
		apiKey: z.string().role("secret")
	})),
	activeAccount: z.string(),
	/** 手动排序覆盖；缺省时沿用派生顺序（顶层默认账号 + `accounts[]`）。 */
	accountOrder: z.array(z.string()),
	/**
	* 自动切换开关（设计 §6.4.5：`autoSwitch` 落库是两家共用的可靠性机制；2026-10-17 按
	* 交接文件 §4.2 的 C 项从 opencode 对齐过来）。关闭后轮换只试当前账号（固定账号；
	* 未固定时是顶层默认账号），门见 `accountStateOf`。
	*
	* 默认 `true`（与 opencode 的 `false` 不同）：旧插件一直允许额度耗尽时回落到备用账号，
	* 零迁移要求默认保持这个行为 —— 用户文档里没有这个字段时行为一字不变。
	*/
	autoSwitch: z.boolean().default(true),
	/** 切换策略：手动顺序（只在耗尽时切）或额度优先。 */
	switchStrategy: z.union([
		"order",
		"best-quota",
		"scheduled"
	]).default("best-quota"),
	/** 额度优先模式的评估间隔（分钟）；`0` 表示只在当前耗尽时评估。 */
	switchIntervalMinutes: z.number().default(60),
	/** 是否等回合结束再切（默认 `true`，任务进行中不换号）。 */
	switchAtTurnEnd: z.boolean().default(true),
	modelAccountRules: z.array(z.object({
		models: z.array(z.string()),
		account: z.string()
	})),
	credentialCleanupRefs: z.array(z.string().role("credential-ref")),
	accountIntents: z.array(z.any()).hidden()
}, ["apiKey"]));
/**
* 装一行 Command Code。
*
* 只做装配与注册，不做 I/O：请求路径上的读取（配置、凭据、环境）都是按需现取的函数。
* @param ctx - 宿主插件上下文。
* @param config - 宿主解析过的 Config，或程序化构造的原始配置（本函数自己过一遍 `Config`）。
* @returns 装配产物（宿主忽略；装配测试与 1b 使用）。
*/
function apply(ctx, config) {
	const parsed = parseConfig(config);
	const document = () => unwrapVolatileConfig(parsed);
	const warn = (message) => {
		ctx.logger.warn(message);
	};
	const settings = createSettingsPort(ctx, COMMAND_CODE_SETTINGS_NS, SETTINGS_ROWS);
	const credentials = createCredentialsPort(ctx);
	const intents = intentLogFor(COMMAND_CODE_SETTINGS_NS, createSettingsIntentStore(settings, COMMAND_CODE_SETTINGS_NS, INTENTS_FIELD, warn));
	const accounts = createCommandCodeAccounts({
		settings,
		credentials,
		intents
	});
	const rotation = createRotationAccess(() => accountStateOf(document()));
	warnAboutActiveAccount(document(), warn);
	/**
	* 能力声明（规格 §7.3 的矩阵）：UI 据此隐藏或置灰控件。**唯一来源在宿主侧**，
	* 经远程 `status()` 发布给页面（客户端不各写一份，否则两边迟早不一致）。
	*/
	const capabilities = {
		reorder: true,
		pin: true,
		browserLogin: true,
		modelAccountRules: true,
		quotaShape: "windows",
		modelVisibilityWrite: "onSave",
		automaticSwitch: true
	};
	/** 额度端口：每次读数都用当时的配置；`snapshot(ref)` 可读指定账号（切换策略用）。 */
	const quota = { async snapshot(accountRef) {
		const apiBase = normalizeKey(document().apiBase) ?? "https://api.commandcode.ai";
		const ref = accountRef ?? selectedRefOf(document());
		return createCommandCodeQuota({
			ref: () => ref,
			resolveKey: (candidate) => resolveAccountKey(ctx, document(), credentials, candidate),
			fetchImpl: fetch,
			apiBase
		}).snapshot();
	} };
	const switching = new SwitchingController({
		accounts,
		quota,
		rotation,
		document,
		pinnedRef: () => pinnedRefOf(document()),
		warn
	});
	const adapter = createCommandCodeAdapter({
		config: () => adapterConfigOf(document()),
		get rotation() {
			return rotation.current();
		},
		quota,
		accounts,
		fetchImpl: fetch,
		resolveStored: (ref) => credentials.resolve(ref),
		resolveEnvironment: (ref) => environmentValue(ctx, ref),
		authFileFallback: authKeyFromAuthFile,
		beforeRequest: (input) => switching.beforeRequest(input),
		usage: createUsagePort(),
		fallbackCandidates: () => modelCandidates(),
		autoSwitchModel: () => document()["autoSwitchModelOnQuota"] === true
	});
	registerCatalogSource({
		provider: "commandcode",
		models: () => adapter.listModels(PROVIDER_ID).then(async (rows) => Promise.all(rows.map(async (row) => {
			const meta = await adapter.resolveModel(PROVIDER_ID, row.id).then((info) => ({
				...info.context?.contextWindow === void 0 ? {} : { contextWindow: info.context.contextWindow },
				...info.reasoning?.efforts === void 0 ? {} : { effortCount: info.reasoning.efforts.length }
			})).catch(() => ({}));
			return {
				id: row.id,
				...meta
			};
		}))),
		stream: (options) => adapter.stream(options)
	});
	const login = createCommandCodeLogin({
		fetchImpl: fetch,
		apiBase: normalizeKey(document().apiBase) ?? "https://api.commandcode.ai",
		storeKey: async (ref, key, userName) => {
			const views = await accounts.list();
			const existing = views.find((view) => view.ref === ref) ?? views.find((view) => view.label === userName);
			if (existing !== void 0) {
				await credentials.set(existing.ref, key);
				return;
			}
			await accounts.add({
				label: userName,
				key
			});
		}
	});
	ctx.effect(() => () => {
		login.cancel();
	}, "dsh-llm-account: commandcode login port");
	/**
	* 当前这条路由注册的句柄；`enabled: false` 时是 `undefined`（行仍然挂载）。
	*
	* 三行对称（2026-10-20 复审）：opencode / opendesign 早就是这个形状，commandcode 原先
	* **无条件注册** —— 用户把它配成 `enabled: false` 不会生效。用「释放 + 重新注册」而不是
	* `handle.replace([])`：与另两行同一形状，也让撤下与 `ctx.effect` 的释放路径共用句柄。
	*/
	let registration;
	/** 按**现读**的 `enabled` 校准路由：缺省（含非布尔值）读作启用，只有显式的 `false` 撤下。 */
	const applyRoute = () => {
		const enabled = document().enabled !== false;
		if (enabled && registration === void 0) registration = ctx.llm.registerAdapter([PROVIDER_ID], adapter);
		else if (!enabled && registration !== void 0) {
			registration();
			registration = void 0;
		}
	};
	applyRoute();
	ctx.effect(() => () => {
		if (registration !== void 0) {
			registration();
			registration = void 0;
		}
	}, "dsh-llm-account: commandcode provider route");
	ctx.on("loader/volatile-update", () => {
		applyRoute();
		/**
		* 设定变了 → 如果搜索被关掉（或重新打开），把宿主 `web` 行的 `searchProvider`
		* 槽位让出 / 收回（2026-10-23，见 `search-release.ts` 的完整理由）。
		*
		* 为什么在这里做而不是每次启动：只在**用户动作**的瞬间改配置，因果关系清楚；
		* 启动时改会让人以为自己从没写过那一行。失败只记一条 warning —— 改不动配置
		* 不该让整行挂掉（搜索仍按 `available()` 的意见工作）。
		*/
		syncSearchProviderSlot({
			settings,
			strategy: () => document()["searchStrategy"],
			warn
		}).catch((error) => {
			warn(`[dsh-llm-account] 搜索 provider 槽位同步失败：${String(error)}`);
		});
	});
	ctx.on("session/event", (...args) => switching.noteHostEvent(...args));
	ctx.on("credentials/reference-updated", (ref) => {
		rotation.clearCredentialRejection(ref);
	});
	applyAutoContinue(ctx, {
		onError: document()["autoContinueOnError"] === true,
		onTruncate: document()["autoContinueOnTruncate"] === true,
		maxAttempts: typeof document()["autoContinueMaxAttempts"] === "number" ? document()["autoContinueMaxAttempts"] : 3
	});
	applySearch(ctx, {
		enabled: () => true,
		register: (webCtx) => registerSearchProvider(webCtx, {
			fetchImpl: globalThis.fetch.bind(globalThis),
			sessionRoute: () => {
				const context = (ctx.get?.("agents"))?.currentInitiator?.()?.session?.requestContext?.();
				const record = typeof context === "object" && context !== null ? context : {};
				return {
					provider: typeof record.provider === "string" ? record.provider : void 0,
					model: typeof record.model === "string" ? record.model : void 0
				};
			},
			strategy: () => {
				const value = document()["searchStrategy"];
				return typeof value === "string" && value !== "" ? value : "gateway-first";
			},
			gatewayAccess: (provider) => gatewayAccessOf(provider),
			resolveApiKeys: async () => {
				const refs = normalizeSearchKeyRefs(document()["searchApiKeyRefs"]);
				const out = [];
				for (const ref of refs) {
					const key = await credentials.resolve(ref);
					if (key !== void 0) out.push({
						ref,
						key
					});
				}
				return out;
			}
		})
	});
	applyUsageRemote(ctx, {
		vendor: PROVIDER_ID,
		credentials,
		probeSearchKey: async (ref) => {
			const key = await credentials.resolve(ref);
			if (key === void 0) return {
				state: "invalid",
				reason: "凭据库里找不到这把密钥（可能已被删除）"
			};
			return await probeSearchKey({
				key,
				fetchImpl: fetch
			});
		},
		rotation,
		accounts,
		quota,
		pinnedRef: () => pinnedRefOf(document()),
		quotaRef: () => selectedRefOf(document()),
		capabilities,
		login,
		models: () => adapter.catalogModels(true),
		switchState: () => switching.snapshot(),
		switchNow: () => switching.switchNow(),
		accountOrder: () => {
			const order = document().accountOrder;
			return Array.isArray(order) ? order.filter((key) => typeof key === "string") : [];
		},
		setAccountOrder: async (order) => {
			await accounts.setOrder?.(order);
		},
		setSwitchSettings: (input) => writeSwitchSettings(settings, COMMAND_CODE_SETTINGS_NS, input),
		modelRules: () => rulesOf(document()),
		setAccountModels: (ref, models) => writeModelRules(settings, COMMAND_CODE_SETTINGS_NS, assignModelsToAccount(rulesOf(document()), ref, models))
	});
	disableSettingsAutoForm(ctx, COMMAND_CODE_SETTINGS_NS);
	return {
		providerId: PROVIDER_ID,
		settingsNs: COMMAND_CODE_SETTINGS_NS,
		capabilities,
		adapter,
		rotation,
		intents,
		accounts,
		credentials,
		quota,
		login
	};
}
/**
* 解析入口收到的配置。
*
* 宿主交给 `apply` 的是**已解析**的 Config（volatile 引用就是解析产物），重复解析会把活引用
* 当成普通值；程序化构造（装配测试、将来的远程页）是普通值，必须自己过一遍 `Config`。
* @param config - `apply` 收到的原始配置。
* @returns 字段表（可能是 volatile 引用，也可能是普通值）。
*/
function parseConfig(config) {
	if (isParsedConfig(config)) return config;
	const parsed = Config(config);
	return isRecord$6(parsed) ? parsed : {};
}
/** 入口配置 → 适配器配置：只搬适配器认识的字段。 */
function adapterConfigOf(document) {
	const apiBase = normalizeKey(document.apiBase);
	const apiKey = normalizeKey(document.apiKey);
	const workingDir = normalizeKey(document.workingDir);
	const protocol = protocolOf(document.protocol);
	const requestTimeoutMs = positiveNumber(document.requestTimeoutMs);
	const streamIdleTimeoutMs = positiveNumber(document.streamIdleTimeoutMs);
	const defaultMaxTokens = positiveNumber(document.defaultMaxTokens);
	const visibleModels = stringList(document.visibleModels);
	const modelVisibility = booleanMap(document.modelVisibility);
	const removedModels = stringList(document.removedModels);
	return {
		...apiBase === void 0 ? {} : { apiBase },
		...apiKey === void 0 ? {} : { apiKey },
		...workingDir === void 0 ? {} : { workingDir },
		...protocol === void 0 ? {} : { protocol },
		...requestTimeoutMs === void 0 ? {} : { requestTimeoutMs },
		...streamIdleTimeoutMs === void 0 ? {} : { streamIdleTimeoutMs },
		...defaultMaxTokens === void 0 ? {} : { defaultMaxTokens },
		...visibleModels === void 0 ? {} : { visibleModels },
		...modelVisibility === void 0 ? {} : { modelVisibility },
		...removedModels === void 0 ? {} : { removedModels }
	};
}
/** 读线协议；认不出的值读作「按模型自动选择」。 */
function protocolOf(value) {
	return value === "openai" || value === "messages" || value === "cli" ? value : void 0;
}
/** 读一个正有限数（缺省/0/负数/NaN 读作缺省，避免把坏配置变成「立即超时」）。 */
function positiveNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
/** 读一个字符串数组（丢掉非字符串与空白项）；非数组读作缺省。 */
function stringList(value) {
	if (!Array.isArray(value)) return void 0;
	return value.filter((item) => typeof item === "string" && item.trim() !== "");
}
/** 读一个 id → 布尔 的映射；非对象读作缺省，一个合法项都没有时也读作缺省。 */
function booleanMap(value) {
	if (!isRecord$6(value)) return void 0;
	const map = {};
	for (const [key, flag] of Object.entries(value)) if (typeof flag === "boolean") map[key] = flag;
	return Object.keys(map).length === 0 ? void 0 : map;
}
/**
* 账号库状态：顺序、按模型规则与固定账号（`core` 的 `RotationEngine` 输入）。
*
* **`autoSwitch` 门**（设计 §6.4.5：落库的自动切换开关改为两家共用）：显式 `false` 时
* 候选顺序收窄成**只当前账号** —— 固定账号；未固定时是轮换顺序的首项（顶层默认账号）——
* 一次额度拒绝不会把请求打到用户没允许的第二个账号上（与 opencode 的门同义）。默认 `true`
* 保持旧插件「额度耗尽总是回落」的行为；只有**显式** `false` 才收窄：程序化构造的文档
* 没有这个字段时保持完整顺序（两侧都有测试锁死）。
*/
function accountStateOf(document) {
	const pinned = pinnedRefOf(document);
	return {
		order: document.autoSwitch === false ? [pinned ?? defaultRefOf(document)] : orderOf(document),
		rules: rulesOf(document),
		pinned
	};
}
/** 顶层默认账号的 ref：`apiKeyEnv`；缺省或非法时回落到内置默认名（与账号端口同一份读法）。 */
function defaultRefOf(document) {
	return commandCodeDefaultRef(document);
}
/** `accounts[].apiKeyEnv` 里合法的凭据引用名（合法名才可能是凭据槽；其余条目本期不支持）。 */
function accountRefsOf(document) {
	const accounts = document.accounts;
	if (!Array.isArray(accounts)) return [];
	const refs = [];
	for (const item of accounts) {
		if (!isRecord$6(item)) continue;
		const ref = normalizeKey(item.apiKeyEnv);
		if (ref !== void 0 && CREDENTIAL_REF_PATTERN.test(ref)) refs.push(ref);
	}
	return refs;
}
/**
* 轮换顺序 = 顶层默认账号 + `accounts` 条目（按文档顺序，去重保留第一次出现）。
*
* 顶层 `apiKeyEnv` **必须**进顺序：旧插件把它渲染成第一个槽（Default / legacy），而
* `AccountPort.list()` 在它缺席 `accounts[]` 时合成同一行；顺序里少了它，只配了顶层密钥的
* 存量用户会让 `RotationEngine.pick` 返回 `undefined`，适配器直接报 MISSING_CREDENTIAL。
*/
function orderOf(document) {
	const derived = [];
	const seen = /* @__PURE__ */ new Set();
	for (const ref of [defaultRefOf(document), ...accountRefsOf(document)]) {
		if (seen.has(ref)) continue;
		seen.add(ref);
		derived.push(ref);
	}
	return globalOrderOfVendor(derived, document.accountOrder, "commandcode");
}
/** 按模型绑定账号：只收形状完整的规则（模型列表非空、`account` 是合法 ref）。 */
function rulesOf(document) {
	const raw = document.modelAccountRules;
	if (!Array.isArray(raw)) return [];
	const rules = [];
	for (const item of raw) {
		if (!isRecord$6(item)) continue;
		const models = stringList(item.models);
		const account = normalizeKey(item.account);
		if (models === void 0 || models.length === 0 || account === void 0) continue;
		rules.push({
			models,
			account
		});
	}
	return rules;
}
/**
* 固定账号。`activeAccount` 是**旧的槽 id 空间**：`default`（顶层默认账号）、`auto`/空
* （自动轮换），或者账号条目自己的 ref；认不出的值（旧插件的 `account-N` 内联密钥槽，
* 本期不支持）读作自动轮换 —— 宁可轮换，也不能把请求指到一个不存在的凭据槽上。
*
* 判定本身在账号端口里（`commandCodeAccountSlot`）：端口的 `list()`/`select()`/`remove()` 与
* 这里必须对同一份文档给出同一个答案，否则又会出现「服务请求的账号没有行」那种裂缝。
* @param document - 现读的设置文档。
* @returns 固定账号的 ref，或 `null`（自动轮换）。
*/
function pinnedRefOf(document) {
	return commandCodeAccountSlot(document).pinned;
}
/** 额度读数报告的账号：固定账号优先，否则顺序里的第一个（下一个请求会用的那个）。 */
function selectedRefOf(document) {
	return pinnedRefOf(document) ?? orderOf(document)[0];
}
/**
* 登录落库前判定：这个 ref 是否已经被**另一个**账号占用？
*
* 抽成导出函数是为了能被单测：它是「不得静默覆盖别人的凭据槽」（Task 5 Step 7）的判定本身，
* 而它平时藏在一个闭包里、只有跑完整的浏览器登录流程才会执行到。
* @param views - 当前账号表（`AccountPort.list()` 的视图，含合成的默认槽）。
* @param ref - 登录将要写入的凭据槽。
* @param userName - 登录返回的用户名。
* @returns 占用者；空闲、或占用者就是同一账号时为 `undefined`。
*/
function loginSlotHolder(views, ref, userName) {
	const holder = views.find((view) => view.ref === ref);
	if (holder === void 0) return void 0;
	return sameAccountName(holder.label, userName) ? void 0 : holder;
}
/**
* 「这个名字属于同一个账号吗」：忽略大小写与首尾空白。
*
* 判定刻意**保守**：只有明显同名才允许覆盖凭据槽（同名 = 同一个 Command Code 账号的重新登录）；
* 名字不同的都拒绝。拒绝的代价是用户手动处置一次；静默覆盖的代价是把别人的密钥冲掉，
* 而密钥冲掉是找不回来的。
* @param label - 账号表里那一行的展示名称。
* @param userName - 登录流程返回的用户名。
* @returns 是否视为同一账号。
*/
function sameAccountName(label, userName) {
	return label.trim().toLowerCase() === userName.trim().toLowerCase();
}
/** 应用期诊断：认不出的 `activeAccount` 只在这里说一次（现读路径按自动轮换处理）。 */
function warnAboutActiveAccount(document, warn) {
	if (!commandCodeAccountSlot(document).invalid) return;
	warn(`llm-commandcode: activeAccount "${normalizeKey(document.activeAccount) ?? ""}" is not a credential reference; automatic rotation is used instead`);
}
/**
* 解析某个账号这一读要用的密钥：按 `literal → stored → environment → authFile` 挑第一把
* （与适配器同一优先级；组合配置里的 `apiKey` 是路由级字面量，对每个账号都生效）。
* @param ctx - 插件上下文（读启动环境）。
* @param document - 现读的设置文档。
* @param credentials - 凭据端口。
* @param ref - 目标账号 ref。
* @returns 可用的密钥，或 `undefined`。
*/
async function resolveAccountKey(ctx, document, credentials, ref) {
	const literal = normalizeKey(document.apiKey);
	const stored = await credentials.resolve(ref);
	const environment = environmentValue(ctx, ref);
	const authFile = await authKeyFromAuthFile();
	return pickApiKey({
		...literal === void 0 ? {} : { literal },
		...stored === void 0 ? {} : { stored },
		...environment === void 0 ? {} : { environment },
		...authFile === void 0 ? {} : { authFile }
	}).key;
}
/**
* 只读兜底：官方 CLI 的 `~/.commandcode/auth.json`。
*
* 形状与旧插件 `resolveAuthFileApiKey` 第 5719-5737 行一致：先看顶层 `apiKey` /
* `commandcode` 字符串，再看 `commandcode` / `command-code` 下的 `{ type }` 记录。任何
* 读取或解析失败都读作「没有兜底」（文件不存在是常态），绝不因此让请求失败。
* @returns 兜底密钥，或 `undefined`。
*/
async function authKeyFromAuthFile() {
	try {
		const path = join(homedir(), ".commandcode", "auth.json");
		if (!existsSync(path)) return void 0;
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord$6(parsed)) return void 0;
		return normalizeKey(parsed.apiKey) ?? normalizeKey(parsed.commandcode) ?? recordKey(parsed.commandcode) ?? recordKey(parsed["command-code"]);
	} catch {
		return;
	}
}
/** 从 CLI 的嵌套凭据记录里取密钥（`type: "api"` 用 `key`，`oauth` 用 `access`）。 */
function recordKey(value) {
	if (!isRecord$6(value)) return void 0;
	const type = normalizeKey(value.type);
	if (type === "api") return normalizeKey(value.key);
	if (type === "oauth") return normalizeKey(value.access);
	return normalizeKey(value.key) ?? normalizeKey(value.access);
}
//#endregion
export { Config, PROVIDER_ID, apply, inject, loginSlotHolder, name };
