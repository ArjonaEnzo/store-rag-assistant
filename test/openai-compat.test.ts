import { describe, expect, it } from "vitest";
import { OpenAICompatProvider } from "../src/llm/openai-compat.ts";
import type { ChatRequest } from "../src/llm/provider.ts";

type Call = { url: string; body: any; headers: Record<string, string> };

function fakeFetch(responses: { status: number; body: unknown; headers?: Record<string, string> }[]) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers ?? {} });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const req: ChatRequest = {
  system: "SYS",
  tools: [{ name: "search_products", description: "d", inputSchema: { type: "object", properties: {} } }],
  messages: [
    { role: "user", content: "hola" },
    { role: "assistant", content: [{ type: "text", text: "busco" }, { type: "tool_use", id: "c1", name: "search_products", input: { query: "q" } }] },
    { role: "user", content: [{ toolUseId: "c1", content: "<catalog_data>[]</catalog_data>" }] },
  ],
};

describe("OpenAICompatProvider", () => {
  it("maps neutral messages to chat/completions and back", async () => {
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        body: {
          choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "search_products", arguments: '{"query":"zapas"}' } }] } }],
          usage: { prompt_tokens: 1200, completion_tokens: 80 },
        },
      },
    ]);
    const p = new OpenAICompatProvider({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m", fetch: fn });
    const res = await p.chat(req);

    expect(calls[0]!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(calls[0]!.headers.authorization).toBe("Bearer k");
    expect(calls[0]!.body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "hola" },
      { role: "assistant", content: "busco", tool_calls: [{ id: "c1", type: "function", function: { name: "search_products", arguments: '{"query":"q"}' } }] },
      { role: "tool", tool_call_id: "c1", content: "<catalog_data>[]</catalog_data>" },
    ]);
    expect(calls[0]!.body.tools[0]).toEqual({ type: "function", function: { name: "search_products", description: "d", parameters: { type: "object", properties: {} } } });
    expect(res.stopReason).toBe("tool_use");
    expect(res.content).toEqual([{ type: "tool_use", id: "c2", name: "search_products", input: { query: "zapas" } }]);
    expect(res.usage).toEqual({ inputTokens: 1200, outputTokens: 80, cacheReadTokens: 0 });
  });

  it("maps finish_reason length to max_tokens and keeps unparseable arguments as a string", async () => {
    const { fn } = fakeFetch([
      { status: 200, body: { choices: [{ finish_reason: "length", message: { content: "hola", tool_calls: [{ id: "x", type: "function", function: { name: "search_products", arguments: "{bad" } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } },
    ]);
    const res = await new OpenAICompatProvider({ baseUrl: "u", apiKey: "k", model: "m", fetch: fn }).chat(req);
    expect(res.stopReason).toBe("max_tokens");
    expect(res.content[1]).toEqual({ type: "tool_use", id: "x", name: "search_products", input: "{bad" });
  });

  it("retries on 429 honoring retry-after, then succeeds", async () => {
    const { fn, calls } = fakeFetch([
      { status: 429, body: { error: { message: "rate limit" } }, headers: { "retry-after": "0.01" } },
      { status: 200, body: { choices: [{ finish_reason: "stop", message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } },
    ]);
    const res = await new OpenAICompatProvider({ baseUrl: "u", apiKey: "k", model: "m", fetch: fn }).chat(req);
    expect(calls).toHaveLength(2);
    expect(res.content).toEqual([{ type: "text", text: "ok" }]);
    expect(res.stopReason).toBe("end_turn");
  });

  it("throws a clear error on non-retryable failures", async () => {
    const { fn } = fakeFetch([{ status: 401, body: { error: { message: "Invalid API Key" } } }]);
    await expect(new OpenAICompatProvider({ baseUrl: "u", apiKey: "k", model: "m", fetch: fn }).chat(req)).rejects.toThrow(/401.*Invalid API Key/);
  });
});
