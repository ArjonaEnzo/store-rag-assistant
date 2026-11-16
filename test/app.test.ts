import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import type { LlmProvider } from "../src/llm/provider.ts";
import type { ProductIndex } from "../src/retrieval/index.ts";

const index = { size: 2, categories: [], search: async () => [] } as unknown as ProductIndex;
const provider: LlmProvider = {
  model: "fake",
  chat: async () => ({ content: [{ type: "text", text: "Hola.\nCITED: none" }], raw: undefined, usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn" }),
};

describe("HTTP app", () => {
  it("GET / serves the chat page", async () => {
    const res = await createApp({ provider, index }).request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Pampa Sports");
    expect(html).toContain('id="ask-form"');
  });

  it("GET /health reports products and model", async () => {
    const res = await createApp({ provider, index }).request("/health");
    expect(await res.json()).toEqual({ ok: true, products: 2, llm: "fake" });
  });

  it("POST /ask returns the assistant result", async () => {
    const res = await createApp({ provider, index }).request("/ask", { method: "POST", body: JSON.stringify({ question: "hola" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ answer: "Hola.", citations: [], escalated: false });
  });

  it("POST /ask rejects empty or too long questions", async () => {
    const app = createApp({ provider, index });
    expect((await app.request("/ask", { method: "POST", body: JSON.stringify({ question: " " }) })).status).toBe(400);
    expect((await app.request("/ask", { method: "POST", body: JSON.stringify({ question: "x".repeat(501) }) })).status).toBe(400);
  });

  it("POST /ask answers 503 with the reason when no provider is configured", async () => {
    const res = await createApp({ error: "No LLM configured.", index }).request("/ask", { method: "POST", body: JSON.stringify({ question: "hola" }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "No LLM configured." });
  });
});
