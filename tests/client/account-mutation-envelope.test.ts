/**
 * 账户直接写操作的线上信封契约。
 *
 * 这些方法没有编辑器草稿，因此容器不能靠「关表单 / 保留表单」判断成功；必须在解包后
 * 才刷新目标厂商。类型层同样不能把它们写成 Promise<void>：宿主失败是 resolve 的
 * `{ ok: false, error }`，不是 reject。
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { dispatchAccountAction } from "../../src/client/seams";
import type { UsageNamespace } from "../../src/client/usage-contract";

/** 只覆盖本任务中的四个直接账户写方法；返回类型必须是信封可落地的未知值。 */
describe("账户写方法的 Promise<unknown> 契约", () => {
  it("select/remove/move/setAccountModels 不把 RemoteResult 谎报成 void", () => {
    expectTypeOf<Awaited<ReturnType<UsageNamespace["selectAccount"]>>>().toEqualTypeOf<unknown>();
    expectTypeOf<Awaited<ReturnType<UsageNamespace["removeAccount"]>>>().toEqualTypeOf<unknown>();
    expectTypeOf<Awaited<ReturnType<UsageNamespace["moveAccount"]>>>().toEqualTypeOf<unknown>();
    expectTypeOf<Awaited<ReturnType<NonNullable<UsageNamespace["setAccountModels"]>>>>().toEqualTypeOf<unknown>();
  });
});

describe("selectAccount 的信封兼容性", () => {
  const namespace = (result: unknown): UsageNamespace => ({
    selectAccount: async () => result,
  } as unknown as UsageNamespace);

  it("ok:false 保留宿主 code 与 message", async () => {
    const result = await dispatchAccountAction(
      namespace({ ok: false, error: { code: "gateway/internal", message: "select refused" } }),
      "dsh-opencode-go",
      { kind: "select", ref: "oc-1", label: "", key: "" },
    );
    expect(result).toEqual({ ok: false, problem: "gateway/internal: select refused" });
  });

  it("ok:true 与旧裸 undefined 都保持成功", async () => {
    const action = { kind: "select", ref: null, label: "", key: "" } as const;
    await expect(dispatchAccountAction(namespace({ ok: true, value: undefined }), "dsh-opencode-go", action))
      .resolves.toEqual({ ok: true, value: undefined });
    await expect(dispatchAccountAction(namespace(undefined), "dsh-opencode-go", action))
      .resolves.toEqual({ ok: true, value: undefined });
  });
});
