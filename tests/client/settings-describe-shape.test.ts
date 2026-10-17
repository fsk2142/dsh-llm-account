/**
 * `remote.settings.describe()` 的返回形状，2026-10-17 在桌面端 0.2.1-rc.2 实测确认：
 *
 * ```js
 * // app.asar @21028751 — SettingsController.describe()
 * describe() {
 *   return {
 *     writable: settings.writable,
 *     hasDocument: true,
 *     namespaces: settings.describe({ redactSecrets: true }).map(namespaceView),
 *   };
 * }
 * // app.asar @21024548 — namespaceView()：身份字段是 ns
 * { ns, autoGenerate, schema, value, base?, user?, applies, secrets, revision }
 * ```
 *
 * 页面「发现厂商」完全依赖这个调用。把返回值当数组遍历时，一个元素都拿不到，
 * 页面就显示「没有可显示的厂商」——而宿主侧一切正常，没有任何报错。
 *
 * 这些用例钉住三件事：真机形状能发现厂商；命名空间身份认 `ns`（opencode 的条目 id
 * `opencode-go` 与核心命名空间 `llm-opencode-go` 不同，候选行名两个都要认）；
 * 形状不认识时降级为空而不是崩掉。
 */
import { describe as describeSuite, expect, it } from "vitest";

import { describeVendorSnapshots, type ClientSeamContext } from "../../src/client/seams";
import type { VendorEntry } from "../../src/client/registry";

/** The host's real `describe()` return, per the measurement above. */
function hostDescribe(namespaces: { ns?: string; value: Record<string, unknown>; revision?: number }[]): unknown {
  return {
    writable: true,
    hasDocument: true,
    namespaces: namespaces.map((entry, index) => ({
      ns: entry.ns ?? `ns-${index}`,
      autoGenerate: false,
      schema: {},
      value: entry.value,
      applies: true,
      secrets: [],
      revision: entry.revision ?? 1,
    })),
  };
}

function contextWith(described: unknown): ClientSeamContext {
  return {
    remote: {
      settings: { describe: async () => described, mutate: async () => undefined },
    },
  } as unknown as ClientSeamContext;
}

const ENTRIES: readonly VendorEntry[] = [
  {
    ns: "llm-commandcode",
    rowIds: ["llm-commandcode"],
    providerId: "commandcode",
    order: 0,
    labelKey: "commandcode",
    cards: [],
  },
  {
    // opencode: the profile row id differs from the core settings namespace.
    ns: "llm-opencode-go",
    rowIds: ["opencode-go", "llm-opencode-go"],
    providerId: "dsh-opencode-go",
    order: 1,
    labelKey: "opencode",
    cards: [],
  },
];

describeSuite("remote.settings.describe() shape", () => {
  it("discovers both vendors from the host's object shape", async () => {
    const described = hostDescribe([
      { ns: "llm-commandcode", value: { showSidebarQuota: true } },
      { ns: "llm-opencode-go", value: { showSidebarQuota: false } },
    ]);
    const snapshots = await describeVendorSnapshots(contextWith(described), ENTRIES);
    expect(snapshots.map((s) => s.ns)).toEqual(["llm-commandcode", "llm-opencode-go"]);
    expect(snapshots[0]?.value).toEqual({ showSidebarQuota: true });
    expect(snapshots[1]?.value).toEqual({ showSidebarQuota: false });
  });

  it("identifies a namespace by its profile row id when ns differs (opencode)", async () => {
    // The host may report either field; `opencode-go` is the row the settings
    // service addresses, `llm-opencode-go` the namespace. Both must resolve to
    // the same vendor identity, and `row` must carry the name writes need.
    const byRowId = hostDescribe([{ ns: "opencode-go", value: { showSidebarQuota: true } }]);
    const snapshots = await describeVendorSnapshots(contextWith(byRowId), ENTRIES);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.ns).toBe("llm-opencode-go");
    expect(snapshots[0]?.row).toBe("opencode-go");
  });

  it("still accepts a bare array (older hosts)", async () => {
    const snapshots = await describeVendorSnapshots(
      contextWith([{ ns: "llm-commandcode", value: { showSidebarQuota: true }, revision: 1 }]),
      ENTRIES,
    );
    expect(snapshots.map((s) => s.ns)).toEqual(["llm-commandcode"]);
  });

  it("degrades to empty on an unrecognised shape instead of throwing", async () => {
    expect(await describeVendorSnapshots(contextWith({ nope: true }), ENTRIES)).toEqual([]);
    expect(await describeVendorSnapshots(contextWith("nonsense"), ENTRIES)).toEqual([]);
    expect(await describeVendorSnapshots(contextWith(null), ENTRIES)).toEqual([]);
  });

  it("degrades to empty when the remote settings seam is absent", async () => {
    expect(await describeVendorSnapshots({} as ClientSeamContext, ENTRIES)).toEqual([]);
  });

  it("ignores namespaces this package does not own", async () => {
    const described = hostDescribe([{ ns: "llm-deepseek", value: { apiKeyEnv: "X" } }]);
    expect(await describeVendorSnapshots(contextWith(described), ENTRIES)).toEqual([]);
  });

  it("carries the revision through as the write fence", async () => {
    const described = {
      writable: true,
      hasDocument: true,
      namespaces: [{ ns: "llm-commandcode", value: { a: 1 }, revision: 42 }],
    };
    const snapshots = await describeVendorSnapshots(contextWith(described), ENTRIES);
    expect(snapshots[0]?.revision).toBe(42);
  });
});
