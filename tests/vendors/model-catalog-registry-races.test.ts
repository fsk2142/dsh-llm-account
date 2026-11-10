import { afterEach, expect, it, vi } from "vitest";
import { createCommandCodeAdapter } from "../../src/vendors/commandcode/adapter";
import { cachedModelCandidates, delegateStream, invalidateCatalogCandidates, modelCandidates, noteCatalogModels, registerCatalogSource, resetCatalogSources } from "../../src/vendors/model-catalog-registry";

afterEach(resetCatalogSources);

it("loads uncovered gateways without reloading a freshly noted gateway", async () => {
  const commandcode = vi.fn(async () => [{ id: "wrong" }]);
  const opendesign = vi.fn(async () => [{ id: "shared" }]);
  registerCatalogSource({ provider: "commandcode", models: commandcode });
  registerCatalogSource({ provider: "opendesign", models: opendesign });
  noteCatalogModels("commandcode", [{ id: "shared" }], 1_000);

  expect(await modelCandidates(1_001)).toEqual([
    { provider: "commandcode", model: "shared" },
    { provider: "opendesign", model: "shared" },
  ]);
  expect(commandcode).not.toHaveBeenCalled();
  expect(opendesign).toHaveBeenCalledTimes(1);
});

it("an obsolete in-flight catalog cannot be returned or cached after invalidation", async () => {
  let resolveOld!: (rows: readonly { id: string }[]) => void;
  const old = new Promise<readonly { id: string }[]>((resolve) => { resolveOld = resolve; });
  const models = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce([{ id: "current" }]);
  registerCatalogSource({ provider: "opendesign", models });
  const staleRead = modelCandidates(1_000);
  invalidateCatalogCandidates();
  expect(await modelCandidates(1_001)).toEqual([{ provider: "opendesign", model: "current" }]);
  resolveOld([{ id: "unchecked" }]);

  expect(await staleRead).not.toContainEqual({ provider: "opendesign", model: "unchecked" });
  expect(cachedModelCandidates(1_002)).toEqual([{ provider: "opendesign", model: "current" }]);
});

it("rejects a retained candidate after its model is unchecked, even if its gateway remains enabled", async () => {
  let visible = true;
  const stream = vi.fn(async function* () { yield "served"; });
  const source = {
    provider: "opendesign",
    models: async () => [{ id: "model" }],
    available: () => true,
    allowsModel: () => visible,
    stream,
  };
  registerCatalogSource(source);
  const [target] = await modelCandidates(1_000);
  expect(target).toBeDefined();
  visible = false;
  invalidateCatalogCandidates();
  // An adapter's own listModels request can finish after invalidation, too.
  noteCatalogModels("opendesign", [{ id: "model" }], 1_001);

  expect(delegateStream(target!, {})).toBeUndefined();
  expect(stream).not.toHaveBeenCalled();
  expect(await modelCandidates(1_002)).toEqual([]);
});

it("a late picker result containing an unchecked model cannot replace a fresh visible catalog", async () => {
  let visible = true;
  const source = {
    provider: "opendesign",
    models: async () => [{ id: "kept" }],
    allowsModel: (model: string) => model !== "unchecked" || visible,
  };
  registerCatalogSource(source);
  visible = false;
  invalidateCatalogCandidates();
  const fresh = await modelCandidates(1_000);
  expect(fresh).toEqual([{ provider: "opendesign", model: "kept" }]);

  noteCatalogModels("opendesign", [{ id: "unchecked" }], 1_001);
  expect(cachedModelCandidates(1_002)).toEqual(fresh);
});

it("a picker opened before a model was enabled cannot replace the current candidates with an empty list", async () => {
  let finish!: (response: Response) => void;
  let started!: () => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  let visibleModels: string[] = [];
  const adapter = createCommandCodeAdapter({
    config: () => ({ apiBase: "https://api.commandcode.ai", visibleModels }),
    rotation: { current: () => ({}) },
    quota: {},
    accounts: { list: async () => [{ ref: "cc-1", label: "CC", configured: true, active: true }] },
    fetchImpl: async () => { started(); return pending; },
    resolveStored: async () => "test-key",
  } as never);
  const oldRead = adapter.listModels("commandcode");
  await requested;
  visibleModels = ["current"];
  invalidateCatalogCandidates();
  noteCatalogModels("commandcode", [{ id: "current" }]);
  finish(Response.json({ models: [{ id: "current" }] }));
  await oldRead;

  expect(cachedModelCandidates()).toEqual([{ provider: "commandcode", model: "current" }]);
});
