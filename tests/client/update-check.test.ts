/**
 * 插件自身的更新检查（2026-10-20 用户要求）。
 *
 * 用户原话：「我是通过 DSH 插件进行安装的……希望在那个地方加一个更新，这样有新版本的时候
 * 直接更新就可以，就不用每次卸载后重新更新了」，后续澄清「通过 git 链接安装的」。
 *
 * 实现要点（见 `src/client/update-check.ts`）：走宿主官方插件入口的公开更新 API
 * （`/dsh-market/api/v1/updates`）。它对四种安装类型的判定完全不同，本文件把那些判定
 * 逐条钉住 —— 尤其是**链接安装不能被显示成「已是最新」**：那会让用户等一个永不出现的按钮。
 */
import { describe, expect, it, vi } from "vitest";

import { checkForUpdate, pollUpdate, startUpdate, updateStateOf } from "../../src/client/update-check";

/** 造一个返回给定 JSON 的假 fetch。 */
function fakeFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const impl = (async (url: unknown) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("updateStateOf：四种安装类型的判定", () => {
  it("**github 安装且有新版** → available（这正是用户的情况）", () => {
    const state = updateStateOf({
      package: { source: "github", installedVersion: "0.1.0", latestVersion: "0.2.0", updateAvailable: true },
    });
    expect(state).toEqual({ kind: "available", installed: "0.1.0", latest: "0.2.0", source: "github" });
  });

  it("github 安装且**没有**新版 → current（已是最新）", () => {
    const state = updateStateOf({
      package: { source: "github", installedVersion: "0.1.0", latestVersion: "0.1.0", updateAvailable: false },
    });
    expect(state.kind).toBe("current");
  });

  it("**linked（本地链接安装）→ not-applicable，不是 current**", () => {
    // 这条是最容易写错的地方：链接安装跟着源码走，永远不会有「新版本」。
    // 把它说成「已是最新」会让用户以为「以后会有更新」，从而一直等。
    const state = updateStateOf({
      package: { source: "linked", installedVersion: "0.1.0", latestVersion: null, updateAvailable: false },
    });
    expect(state.kind).toBe("not-applicable");
    if (state.kind === "not-applicable") expect(state.source).toBe("linked");
  });

  it("file / workspace 等本地来源同样 not-applicable", () => {
    for (const source of ["file", "directory", "workspace"]) {
      expect(updateStateOf({ package: { source, installedVersion: "0.1.0", updateAvailable: false } }).kind, source).toBe(
        "not-applicable",
      );
    }
  });

  it("形状不认识（没有 package 字段）→ unknown，**不猜**", () => {
    expect(updateStateOf({}).kind).toBe("unknown");
    expect(updateStateOf(null).kind).toBe("unknown");
    expect(updateStateOf({ package: { source: "weird", updateAvailable: true } }).kind).toBe("unknown");
  });
});

describe("checkForUpdate：查不到不等于已是最新", () => {
  it("200 + 正常响应 → 采用接口结论", async () => {
    const { impl } = fakeFetch({
      package: { source: "github", installedVersion: "0.1.0", latestVersion: "0.2.0", updateAvailable: true },
    });
    const state = await checkForUpdate({ fetchImpl: impl });
    expect(state.kind).toBe("available");
  });

  it("请求 URL 命中官方更新接口且带 force=1（绕过短缓存）", async () => {
    const { impl, calls } = fakeFetch({ package: { source: "github", installedVersion: "1", updateAvailable: false } });
    await checkForUpdate({ fetchImpl: impl });
    expect(calls[0]).toContain("/dsh-market/api/v1/updates");
    expect(calls[0]).toContain("name=dsh-llm-account");
    expect(calls[0]).toContain("force=1");
  });

  it("404（宿主没有更新接口）→ unknown，而不是 current", async () => {
    const { impl } = fakeFetch({}, 404);
    const state = await checkForUpdate({ fetchImpl: impl });
    expect(state.kind).toBe("unknown");
    if (state.kind === "unknown") expect(state.reason).toContain("没有插件更新接口");
  });

  it("网络抛错 → unknown 并带原因", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const state = await checkForUpdate({ fetchImpl: impl });
    expect(state.kind).toBe("unknown");
    if (state.kind === "unknown") expect(state.reason).toContain("fetch failed");
  });

  it("没有 fetch 的环境 → unknown（不抛）", async () => {
    const previous = (globalThis as { fetch?: unknown }).fetch;
    delete (globalThis as { fetch?: unknown }).fetch;
    try {
      const state = await checkForUpdate();
      expect(state.kind).toBe("unknown");
    } finally {
      (globalThis as { fetch?: unknown }).fetch = previous;
    }
  });
});

describe("startUpdate / pollUpdate", () => {
  it("startUpdate 用 POST 带 packageName，并取回 operationId", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 202, json: async () => ({ operationId: "op-1" }) } as Response;
    }) as unknown as typeof fetch;
    const result = await startUpdate({ fetchImpl: impl });
    expect(result).toEqual({ ok: true, operationId: "op-1" });
    expect(calls[0]!.init?.method).toBe("POST");
    expect(String(calls[0]!.init?.body)).toContain("dsh-llm-account");
  });

  it("**宿主真实形状**：202 把 operationId 包在 operation 里 → 也要取到（2026-10-21 报障）", async () => {
    // 宿主 dshmarket 的真实回执（routes.ts POST /dsh-market/api/v1/updates）：
    //   { schema: "dsh-market/update-api/v1",
    //     operation: { operationId: "boot-update-1", state: "running", ... } }
    // 顶层**没有** operationId。旧代码只看顶层，于是把一次成功的请求判成
    // 「宿主接受了请求但没有给出 operationId」——用户看到更新永远点不动。
    const impl = (async () =>
      ({
        ok: true,
        status: 202,
        json: async () => ({
          schema: "dsh-market/update-api/v1",
          operation: { operationId: "boot-update-1", kind: "update", state: "running" },
        }),
      }) as Response) as unknown as typeof fetch;
    const result = await startUpdate({ fetchImpl: impl });
    expect(result).toEqual({ ok: true, operationId: "boot-update-1" });
  });

  it("**宿主真实形状**：202 只回 schema 没有 operation（真找不到 id）→ 明确失败，不静默", async () => {
    const impl = (async () =>
      ({
        ok: true,
        status: 202,
        json: async () => ({ schema: "dsh-market/update-api/v1" }),
      }) as Response) as unknown as typeof fetch;
    const result = await startUpdate({ fetchImpl: impl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("operationId");
  });

  it("startUpdate 被拒绝时给可读原因（不假装成功）", async () => {
    const impl = (async () => ({ ok: false, status: 403, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    const result = await startUpdate({ fetchImpl: impl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("403");
  });

  it("pollUpdate 解析终态与失败码", async () => {
    const impl = (async () =>
      ({ ok: true, status: 200, json: async () => ({ state: "failed", code: "RELEASE_TOO_FRESH", message: "too new" }) }) as Response) as unknown as typeof fetch;
    const op = await pollUpdate("op-1", { fetchImpl: impl });
    expect(op.state).toBe("failed");
    expect(op.code).toBe("RELEASE_TOO_FRESH");
  });

  it("pollUpdate 遇到不认识的 state → unknown", async () => {
    const impl = (async () => ({ ok: true, status: 200, json: async () => ({ state: "weird" }) }) as Response) as unknown as typeof fetch;
    expect((await pollUpdate("op-1", { fetchImpl: impl })).state).toBe("unknown");
  });
});

describe("界面：按钮只在真的可更新时出现", () => {
  /** 渲染设置页的更新区块。 */
  async function renderBlock(update: unknown, extra: Record<string, unknown> = {}): Promise<unknown> {
    const { PageShell } = await import("../../src/client/page");
    const { createPageState } = await import("../../src/client/page-state");
    const { VENDORS } = await import("../../src/client/shell");
    const { dictionaryOf } = await import("../../src/client/copy");
    return PageShell({
      state: createPageState(VENDORS, [{ ns: "llm-commandcode", row: "llm-commandcode", value: {}, revision: 1 }]),
      entries: VENDORS,
      t: dictionaryOf("zh"),
      onSelectTab: vi.fn(),
      onSetField: vi.fn(),
      onSave: vi.fn(),
      update,
      ...extra,
    } as never);
  }

  function elements(node: unknown): { props: Record<string, unknown> }[] {
    const out: { props: Record<string, unknown> }[] = [];
    const walk = (value: unknown): void => {
      if (value === null || value === undefined || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const child of value) walk(child);
        return;
      }
      const element = value as { props?: Record<string, unknown> };
      if (element.props === undefined) return;
      out.push({ props: element.props });
      walk(element.props.children);
    };
    walk(node);
    return out;
  }

  it("available → 显示「更新」按钮", async () => {
    const tree = await renderBlock({ kind: "available", installed: "0.1.0", latest: "0.2.0", source: "github" });
    expect(elements(tree).some((element) => element.props["data-update-start"] !== undefined)).toBe(true);
  });

  it("**not-applicable（链接安装）→ 没有「更新」按钮，只有「检查更新」**", async () => {
    const tree = await renderBlock({ kind: "not-applicable", installed: "0.1.0", source: "linked" });
    expect(elements(tree).some((element) => element.props["data-update-start"] !== undefined)).toBe(false);
    expect(elements(tree).some((element) => element.props["data-update-check"] !== undefined)).toBe(true);
  });

  it("current → 同样不给「更新」按钮（没什么可更新）", async () => {
    const tree = await renderBlock({ kind: "current", installed: "0.1.0", source: "github" });
    expect(elements(tree).some((element) => element.props["data-update-start"] !== undefined)).toBe(false);
  });

  it("容器没提供更新状态时整块不渲染", async () => {
    const tree = await renderBlock(undefined);
    expect(elements(tree).some((element) => element.props["data-update-block"] !== undefined)).toBe(false);
  });

  it("点「检查更新」调的是容器给的回调", async () => {
    const check = vi.fn();
    const tree = await renderBlock({ kind: "current", installed: "0.1.0", source: "github" }, { onCheckUpdate: check });
    const button = elements(tree).find((element) => element.props["data-update-check"] !== undefined)!;
    (button.props["onClick"] as () => void)();
    expect(check).toHaveBeenCalledTimes(1);
  });
});
