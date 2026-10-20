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

import { describeVendorSnapshots, discoverVendors, saveSettings, type ClientSeamContext } from "../../src/client/seams";
import { createPageState, FEATURE_TAB_NS } from "../../src/client/page-state";
import { PageShell } from "../../src/client/page";
import type { VendorEntry } from "../../src/client/registry";

/**
 * The host's real `describe()` return, per the measurement above.
 *
 * Every unary remote call resolves to `RemoteResult<T>` — `{ ok: true, value }` or
 * `{ ok: false, error }` — and does **not** reject for host-side failures
 * (app.asar @17916049). Wrap the payload the way the host does.
 */
function hostDescribe(
  namespaces: { ns?: string; value: Record<string, unknown>; revision?: number }[],
  ok = true,
): unknown {
  const value = {
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
  return ok ? { ok: true, value } : { ok: false, error: { code: "gateway/internal", message: "settings service absent" } };
}

function contextWith(described: unknown): ClientSeamContext {
  return {
    remote: {
      settings: { describe: async () => described, mutate: async () => undefined },
    },
  } as unknown as ClientSeamContext;
}

/** A `describe()` that rejects, standing in for a gateway-side failure. */
function contextWithThrowing(error: Error): ClientSeamContext {
  return {
    remote: {
      settings: {
        describe: async () => {
          throw error;
        },
        mutate: async () => undefined,
      },
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

  it("reads through the { ok, value } remote envelope the host actually returns", async () => {
    // Measured 2026-10-17: `describe()` resolves to RemoteResult, not the payload.
    // Treating the envelope as the payload is what produced 「unknown-shape …
    // keys [ok, value]」 on the real desktop.
    const snapshots = await describeVendorSnapshots(
      contextWith(hostDescribe([{ ns: "llm-commandcode", value: { a: 1 } }])),
      ENTRIES,
    );
    expect(snapshots.map((s) => s.ns)).toEqual(["llm-commandcode"]);
  });

  it("reports a host-side refusal, which arrives as ok:false and never rejects", async () => {
    const refused = await discoverVendors(contextWith(hostDescribe([], false)), ENTRIES);
    expect(refused.problem).toEqual({
      kind: "describe-failed",
      detail: "gateway/internal: settings service absent",
    });
    expect(refused.snapshots).toEqual([]);
  });

  it("degrades to empty on an unrecognised shape instead of throwing", async () => {
    expect(await describeVendorSnapshots(contextWith({ nope: true }), ENTRIES)).toEqual([]);
    expect(await describeVendorSnapshots(contextWith("nonsense"), ENTRIES)).toEqual([]);
    expect(await describeVendorSnapshots(contextWith(null), ENTRIES)).toEqual([]);
  });

  it("reports WHY discovery failed, so the empty page can say so", async () => {
    // Four distinct causes behind one identical symptom; the page renders the
    // reason, so each must be distinguishable (and never silently succeed).
    const missing = await discoverVendors({} as ClientSeamContext, ENTRIES);
    expect(missing.problem?.kind).toBe("remote-absent");

    const threw = await discoverVendors(contextWithThrowing(new Error("gateway/boom")), ENTRIES);
    expect(threw.problem).toEqual({ kind: "describe-failed", detail: "gateway/boom" });

    const odd = await discoverVendors(contextWith({ namespaces: "not-an-array" }), ENTRIES);
    expect(odd.problem?.kind).toBe("unknown-shape");
    // The detail must name the keys, otherwise it cannot be acted on.
    expect(odd.problem?.detail).toContain("namespaces");

    const unmatched = await discoverVendors(
      contextWith(hostDescribe([{ ns: "someone-elses-plugin", value: {} }])),
      ENTRIES,
    );
    expect(unmatched.problem?.kind).toBe("no-match");
    expect(unmatched.problem?.detail).toContain("someone-elses-plugin");
    expect(unmatched.problem?.detail).toContain("llm-commandcode");

    const ok = await discoverVendors(contextWith(hostDescribe([{ ns: "llm-commandcode", value: {} }])), ENTRIES);
    expect(ok.problem).toBeUndefined();
    expect(ok.snapshots).toHaveLength(1);
  });

  it("renders the reason in the empty state", () => {
    const state = createPageState(ENTRIES, [], undefined, {
      kind: "no-match",
      detail: "host namespaces: (none) | this package looks for: llm-commandcode",
    });
    const shell = PageShell({
      state,
      entries: ENTRIES,
      t: (key) => key,
      onSelectTab: () => undefined,
      onSetField: () => undefined,
      onSave: () => undefined,
    });
    const diagnostic = flatten(shell).find((node) => node.props?.["data-discovery"] === "no-match");
    expect(diagnostic, "the empty state must show why discovery failed").toBeDefined();
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
      ok: true,
      value: { writable: true, hasDocument: true, namespaces: [{ ns: "llm-commandcode", value: { a: 1 }, revision: 42 }] },
    };
    const snapshots = await describeVendorSnapshots(contextWith(described), ENTRIES);
    expect(snapshots[0]?.revision).toBe(42);
  });

  it("does not report a refused save as a success", async () => {
    // The host resolves refusals as `{ ok: false, error }` instead of rejecting
    // (app.asar @17916049). Awaiting the call and assuming success reported a
    // rejected write as saved — the user saw "saved", the draft was never
    // committed, and the next refresh dropped it.
    const refused = await saveSettings(
      {
        remote: { settings: { describe: async () => ({}), mutate: async () => ({ ok: false, error: { code: "settings/conflict", message: "stale revision" } }) } },
      } as unknown as ClientSeamContext,
      "llm-commandcode",
      [{ key: "showSidebarQuota", value: true }],
      3,
    );
    expect(refused).toBe("settings/conflict: stale revision");

    const accepted = await saveSettings(
      {
        remote: { settings: { describe: async () => ({}), mutate: async () => ({ ok: true, value: undefined }) } },
      } as unknown as ClientSeamContext,
      "llm-commandcode",
      [{ key: "showSidebarQuota", value: true }],
      3,
    );
    expect(accepted).toBeUndefined();
  });

  it("yields one tab per discovered vendor, in declared order", async () => {
    // The tab row is derived from discovery: no vendors found means no tabs and
    // the page shows the empty notice. This is the user-visible symptom of the
    // shape regression, so pin the whole chain rather than just the snapshot.
    const described = hostDescribe([
      { ns: "llm-commandcode", value: { showSidebarQuota: true } },
      { ns: "llm-opencode-go", value: { showSidebarQuota: false } },
    ]);
    const snapshots = await describeVendorSnapshots(contextWith(described), ENTRIES);
    const state = createPageState(ENTRIES, snapshots);
    expect(state.tabs.map((tab) => tab.ns)).toEqual(["llm-commandcode", "llm-opencode-go", FEATURE_TAB_NS]);
    expect(state.activeNs).toBe("llm-commandcode");

    const shell = PageShell({ state, entries: ENTRIES, t: (key) => key, onSelectTab: () => undefined, onSetField: () => undefined, onSave: () => undefined });
    const rendered = flatten(shell);
    expect(rendered.some((node) => node.props?.["data-tab"] === "llm-commandcode")).toBe(true);
    expect(rendered.some((node) => node.props?.["data-tab"] === "llm-opencode-go")).toBe(true);
    expect(rendered.some((node) => node.props?.["data-empty"] === "vendor")).toBe(false);
  });
});

/** Depth-first walk over the element tree the React stub produces. */
function flatten(node: unknown): { props?: Record<string, unknown> }[] {
  const out: { props?: Record<string, unknown> }[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    out.push(value as { props?: Record<string, unknown> });
    const props = (value as { props?: Record<string, unknown> }).props;
    const children = props?.["children"];
    if (children !== undefined) visit(children);
  };
  visit(node);
  return out;
}
