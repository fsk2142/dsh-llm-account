import { afterEach, expect, it } from "vitest";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import type { AccountPort } from "../../src/core/adapter";
import { RotationEngine } from "../../src/core/switching/rotation";
import { createCommandCodeAdapter } from "../../src/vendors/commandcode/adapter";
import { createOpencodeAdapter } from "../../src/vendors/opencode/adapter";
import { createOpenDesignAdapter } from "../../src/vendors/opendesign/adapter";
import { registerCatalogSource, resetCatalogSources } from "../../src/vendors/model-catalog-registry";

const factories = [
  ["commandcode", createCommandCodeAdapter],
  ["dsh-opencode-go", createOpencodeAdapter],
  ["opendesign", createOpenDesignAdapter],
] as const;
afterEach(resetCatalogSources);

it.each(factories)("%s delegates an identical model id to a different gateway after quota failure", async (provider, factory) => {
  const model = "shared-model";
  const targetProvider = provider === "commandcode" ? "opendesign" : "commandcode";
  const targetFactory = provider === "commandcode" ? createOpenDesignAdapter : createCommandCodeAdapter;
  const requests: { gateway: string; body: Record<string, unknown> }[] = [];
  const accounts = { list: async () => [{ ref: "test", configured: true }], select: async () => {} } as unknown as AccountPort;
  const deps = (gateway: string, exhausted: boolean) => ({
    config: () => ({ apiBase: "https://offline.invalid/v1", visibleModels: [model] }),
    accounts,
    quota: { snapshot: async () => ({ windows: [], failures: [] }) },
    rotation: new RotationEngine({ order: ["test"], rules: [], pinned: null }),
    resolveStored: async () => "offline-fake-key",
    fetchImpl: (async (_url: unknown, init?: RequestInit) => {
      if (init?.method !== "POST") return new Response(JSON.stringify({ data: [{ id: model }] }), { headers: { "content-type": "application/json" } });
      requests.push({ gateway, body: JSON.parse(String(init.body)) });
      if (exhausted) return new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429, headers: { "content-type": "application/json" } });
      return new Response('data: {"choices":[{"delta":{"content":"recovered"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch,
  });
  const target = targetFactory(deps(targetProvider, false));
  registerCatalogSource({ provider: targetProvider, models: async () => [{ id: model }], stream: (options) => target.stream(options as GenerateOptions) });
  const source = factory({ ...deps(provider, true), autoSwitchModel: () => true, fallbackCandidates: () => [{ provider: targetProvider, model }] });
  const chunks: StreamChunk[] = [];
  for await (const chunk of source.stream({ provider, model, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } as GenerateOptions)) chunks.push(chunk);
  expect(requests.map((request) => request.gateway)).toEqual([provider, targetProvider]);
  expect(requests.map((request) => request.body.model)).toEqual([model, model]);
  expect(chunks.some((chunk) => chunk.type === "text-delta" && chunk.text === "recovered")).toBe(true);
});
