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
export { registerGatewayAccess as n, gatewayAccessOf as t };
