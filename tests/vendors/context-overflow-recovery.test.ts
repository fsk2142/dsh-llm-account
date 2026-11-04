import { expect, it } from "vitest";
import { CONTEXT_WINDOW_EXCEEDED_CODE, LlmError } from "@deepseek-ai/dsh-llm";
import { createCommandCodeAdapter } from "../../src/vendors/commandcode/adapter";
import { createOpenDesignAdapter } from "../../src/vendors/opendesign/adapter";
import { RotationEngine } from "../../src/core/switching/rotation";

for (const vendor of ["commandcode", "opendesign"] as const) {
  const create = vendor === "commandcode" ? createCommandCodeAdapter : createOpenDesignAdapter;
  function adapter(response: () => Response) {
    return create({
      config: () => ({ apiKey: "fake-key", apiBase: "https://example.test/v1" }),
      rotation: new RotationEngine({ order: ["A"], pinned: "A", rules: [] }),
      accounts: { list: async () => [{ ref: "A" }] } as never,
      quota: { snapshot: async () => ({ windows: [], failures: [] }) },
      resolveStored: async () => "fake-key",
      fetchImpl: (async (url) => String(url).endsWith("/models")
        ? new Response(JSON.stringify({ data: [{ id: "m", name: "M", context_length: 128000, max_output_tokens: 8192 }] }))
        : response()) as typeof fetch,
    });
  }
  for (const status of [400, 413, 422]) {
    it(`${vendor}: HTTP ${status} context overflow reaches host compaction with its canonical code`, async () => {
      const route = adapter(() => new Response(JSON.stringify({ error: { code: "context_length_exceeded", message: "maximum context length exceeded" } }), { status }));
      let failure: unknown;
      try { for await (const _chunk of route.stream({ provider: vendor, model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } as never)) {} } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(LlmError);
      expect(failure).toMatchObject({ code: CONTEXT_WINDOW_EXCEEDED_CODE, status });
    });
  }
  it(`${vendor}: in-band context overflow is not reclassified as a network error`, async () => {
    const route = adapter(() => new Response('event: error\ndata: {"error":{"code":"context_length_exceeded","message":"maximum context length exceeded"}}\n\n', { headers: { "content-type": "text/event-stream" } }));
    let failure: unknown;
    try { for await (const _chunk of route.stream({ provider: vendor, model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } as never)) {} } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: CONTEXT_WINDOW_EXCEEDED_CODE });
  });
  it(`${vendor}: the routed model declares capacity for proactive pressure compaction`, async () => {
    expect(await adapter(() => new Response()).resolveModel(vendor, "m")).toMatchObject({ context: { contextWindow: 128000 } });
  });
}
