/**
 * 跨行网关访问注册表（2026-10-20 审计：修掉「搜索网关路拿 commandcode 的密钥打
 * commandcode 的端点」那个真 bug 后新增）。
 *
 * 钉住三件事：
 * 1. 登记后能按 provider 取回，且是**用时现取**（不是登记时拷一份）；
 * 2. 没登记的 provider 读作「不可用」而不是抛；
 * 3. 访问器自己抛错也读作「不可用」—— 一家装配故障不该让搜索整块不可用。
 */
import { describe, expect, it } from "vitest";

import { gatewayAccessOf, registerGatewayAccess } from "../../src/vendors/gateway-access";

describe("gateway-access 注册表", () => {
  it("登记后按 provider 取回；每次调用都现取（设置改了立刻反映）", async () => {
    let current = { baseURL: "https://a.example/v1", key: "sk-1" };
    registerGatewayAccess("opendesign", async () => current);
    expect(await gatewayAccessOf("opendesign")).toEqual({ baseURL: "https://a.example/v1", key: "sk-1" });
    // 用户换了账号/密钥：下一次取用必须看到新值（快照式注册表会在这里失效）。
    current = { baseURL: "https://b.example/v1", key: "sk-2" };
    expect(await gatewayAccessOf("opendesign")).toEqual({ baseURL: "https://b.example/v1", key: "sk-2" });
  });

  it("没登记这家 → undefined（不抛）；访问器抛错 → 同样 undefined", async () => {
    expect(await gatewayAccessOf("never-registered")).toBeUndefined();
    registerGatewayAccess("boom", async () => {
      throw new Error("装配故障");
    });
    expect(await gatewayAccessOf("boom")).toBeUndefined();
  });

  it("重复登记覆盖：同一行重载（配置热重载）不该留下两份", async () => {
    registerGatewayAccess("dup", async () => ({ baseURL: "https://old.example/v1", key: "sk-old" }));
    registerGatewayAccess("dup", async () => ({ baseURL: "https://new.example/v1", key: "sk-new" }));
    expect(await gatewayAccessOf("dup")).toEqual({ baseURL: "https://new.example/v1", key: "sk-new" });
  });

  it("不同 provider 互不覆盖", async () => {
    registerGatewayAccess("left", async () => ({ baseURL: "https://left.example/v1", key: "sk-l" }));
    registerGatewayAccess("right", async () => ({ baseURL: "https://right.example/v1", key: "sk-r" }));
    expect((await gatewayAccessOf("left"))?.baseURL).toBe("https://left.example/v1");
    expect((await gatewayAccessOf("right"))?.baseURL).toBe("https://right.example/v1");
  });
});
