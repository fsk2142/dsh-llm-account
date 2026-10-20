/**
 * 目录读不到时，`resolveModel` 的名字也必须走**统一展示名**（2026-10-20）。
 *
 * 这是「模型名称不一致」的第二条路径，与前两条不同：
 * - 前两条是「目录读到了，但各家用各自的 name」；
 * - 这一条是**目录没读到**：`resolveModel` 退化成 `name: entry?.name ?? model`，于是
 *   `deepseek/deepseek-v4.1-flash` 直接印成原始 slug，而同一个模型在目录可用的那家印成
 *   `DeepSeek-V4.1-Flash` —— 用户看到的还是两套名字。
 *
 * 目录拉不到是**常态**（网络抖动、密钥还没配、厂商端点 5xx），所以这条不能只靠「目录里
 * 已经有 name」来兜。宿主的模型选择器用 `resolveModel().name` 显示当前选中的模型。
 */
import { describe, expect, it } from "vitest";

import type { AccountPort, QuotaPort } from "../../src/core/adapter";
import { RotationEngine } from "../../src/core/rotation";
import { createCommandCodeAdapter } from "../../src/vendors/commandcode/adapter";
import { createOpencodeAdapter } from "../../src/vendors/opencode/adapter";
import { createOpenDesignAdapter } from "../../src/vendors/opendesign/adapter";

/** 本文件的账号端口：不参与这些用例。 */
function stubAccounts(): AccountPort {
  return {
    list: async () => [],
    add: async () => {
      throw new Error("not used in this test");
    },
    rename: async () => {},
    replaceKey: async () => {},
    remove: async () => {},
    select: async () => {},
  };
}

/** 本文件的额度端口：请求路径不读额度。 */
function stubQuota(): QuotaPort {
  return { snapshot: async () => ({ windows: [], failures: [] }) };
}

/** 永远失败的目录端点（模拟「目录拉不到」）。 */
const deadFetch = (async () => {
  throw new Error("ECONNREFUSED");
}) as unknown as typeof fetch;

/** 每个适配器共用的最小依赖。 */
function deps() {
  return {
    config: () => ({ apiBase: "https://api.example.test" }),
    rotation: new RotationEngine({ order: [], rules: [], pinned: null }),
    quota: stubQuota(),
    accounts: stubAccounts(),
    fetchImpl: deadFetch,
  };
}

describe("目录读不到时名字仍然是统一规则那一份（不是原始 slug）", () => {
  it("commandcode：带公司前缀的 id 也归一", async () => {
    const adapter = createCommandCodeAdapter(deps());
    const resolved = await adapter.resolveModel("commandcode", "deepseek/deepseek-v4.1-flash");
    expect(resolved.name).toBe("DeepSeek-V4.1-Flash");
    // id 原样不动：请求永远用 id。
    expect(resolved.id).toBe("deepseek/deepseek-v4.1-flash");
  });

  it("opencode：短 id 归一", async () => {
    const adapter = createOpencodeAdapter({
      ...deps(),
      // opencode 的目录是「清单 + models.dev 元数据」两跳；这里让两跳都失败。
      fetchImpl: deadFetch,
    });
    const resolved = await adapter.resolveModel("dsh-opencode-go", "deepseek-v4.1-flash");
    expect(resolved.name).toBe("DeepSeek-V4.1-Flash");
    expect(resolved.id).toBe("deepseek-v4.1-flash");
  });

  it("opendesign：短 id 归一", async () => {
    const adapter = createOpenDesignAdapter(deps());
    const resolved = await adapter.resolveModel("opendesign", "claude-sonnet-4-5-20250929");
    expect(resolved.name).toBe("Claude-Sonnet-4.5");
    expect(resolved.id).toBe("claude-sonnet-4-5-20250929");
  });

  it("三家对同一个模型给出同一个名字（这才是用户要的「一致」）", async () => {
    const commandCode = await createCommandCodeAdapter(deps()).resolveModel("commandcode", "deepseek/deepseek-v4.1-flash");
    const openDesign = await createOpenDesignAdapter(deps()).resolveModel("opendesign", "deepseek-v4.1-flash");
    expect(commandCode.name).toBe(openDesign.name);
  });
});
