import { describe, expect, it } from "vitest";
import { ask } from "../src/assistant.ts";
import type { ChatRequest, ChatResponse, LlmProvider } from "../src/llm/provider.ts";
import type { ProductIndex, SearchFilters, SearchHit } from "../src/retrieval/index.ts";

const product = (id: string, price: number) => ({
  id, name: `Zapatilla ${id}`, price, regularPrice: price, onSale: false, inStock: true, stockQty: 3,
  categories: ["Running"], attributes: {}, description: "Para correr.", url: "",
});

function fakeIndex(hits: SearchHit[]) {
  const calls: { query: string; filters: SearchFilters }[] = [];
  const index = {
    categories: ["Running", "Fútbol"],
    async search(query: string, filters: SearchFilters = {}) {
      calls.push({ query, filters });
      return hits;
    },
  } as unknown as ProductIndex;
  return { index, calls };
}

/** Replays scripted responses and records each request. */
function scripted(responses: Omit<ChatResponse, "raw">[]) {
  const requests: ChatRequest[] = [];
  const provider: LlmProvider = {
    model: "claude-haiku-5-5",
    async chat(req) {
      requests.push(structuredClone(req));
      const r = responses.shift();
      if (!r) throw new Error("no more scripted responses");
      return { ...r, raw: undefined };
    },
  };
  return { provider, requests };
}

const u = (i: number, o: number) => ({ inputTokens: i, outputTokens: o, cacheReadTokens: 0 });

describe("ask", () => {
  it("runs search tool, returns grounded answer with citations, summed usage and cost", async () => {
    const { index, calls } = fakeIndex([{ product: product("101", 79990), score: 0.9 }]);
    const { provider, requests } = scripted([
      { stopReason: "tool_use", usage: u(1000, 100), content: [{ type: "tool_use", id: "t1", name: "search_products", input: { query: "zapatillas running", max_price: 80000, in_stock: true } }] },
      { stopReason: "end_turn", usage: u(2000, 200), content: [{ type: "text", text: "Tenés la Zapatilla 101 a $79.990.\nCITED: 101" }] },
    ]);

    const r = await ask("¿zapatillas para correr por menos de $80.000?", { provider, index });

    expect(calls).toEqual([{ query: "zapatillas running", filters: { maxPrice: 80000, inStock: true } }]);
    expect(r.answer).toBe("Tenés la Zapatilla 101 a $79.990.");
    expect(r.citations).toEqual(["101"]);
    expect(r.escalated).toBe(false);
    expect(r.flags).toEqual([]);
    expect(r.usage).toEqual({ inputTokens: 3000, outputTokens: 300, cacheReadTokens: 0 });
    expect(r.costUsd).toBeCloseTo(0.00045, 8);
    expect(r.searches).toEqual([{ query: "zapatillas running", filters: { maxPrice: 80000, inStock: true }, hitIds: ["101"] }]);
    // Tool result is wrapped as data
    const toolMsg = requests[1]!.messages[2]!;
    expect(JSON.stringify(toolMsg)).toContain("<catalog_data>");
  });

  it("captures escalation to a human", async () => {
    const { index } = fakeIndex([]);
    const { provider } = scripted([
      { stopReason: "tool_use", usage: u(500, 50), content: [{ type: "tool_use", id: "t1", name: "escalate_to_human", input: { reason: "pregunta por garantía" } }] },
      { stopReason: "end_turn", usage: u(600, 40), content: [{ type: "text", text: "Te paso con una persona del equipo.\nCITED: none" }] },
    ]);
    const r = await ask("¿cómo hago una garantía?", { provider, index });
    expect(r.escalated).toBe(true);
    expect(r.escalationReason).toBe("pregunta por garantía");
    expect(r.citations).toEqual([]);
  });

  it("flags hallucinated prices and products", async () => {
    const { index } = fakeIndex([{ product: product("101", 79990), score: 0.9 }]);
    const { provider } = scripted([
      { stopReason: "tool_use", usage: u(1, 1), content: [{ type: "tool_use", id: "t1", name: "search_products", input: { query: "zapatillas" } }] },
      { stopReason: "end_turn", usage: u(1, 1), content: [{ type: "text", text: "La 999 sale $10.000.\nCITED: 999" }] },
    ]);
    const r = await ask("zapatillas", { provider, index });
    expect(r.flags).toEqual(["uncited_product:999", "price_not_in_results:10000"]);
  });

  it("escalates on refusal and on running out of turns", async () => {
    const { index } = fakeIndex([]);
    const refused = await ask("x", { provider: scripted([{ stopReason: "refusal", usage: u(1, 0), content: [] }]).provider, index });
    expect(refused.escalated).toBe(true);
    expect(refused.escalationReason).toBe("model_refusal");

    const loop = { stopReason: "tool_use", usage: u(1, 1), content: [{ type: "tool_use" as const, id: "t", name: "search_products", input: { query: "a" } }] };
    const looped = await ask("x", { provider: scripted([loop, loop, loop, loop]).provider, index });
    expect(looped.escalated).toBe(true);
    expect(looped.escalationReason).toBe("max_turns");
  });

  it("rejects invalid tool input with an error result instead of crashing", async () => {
    const { index, calls } = fakeIndex([]);
    const { provider, requests } = scripted([
      { stopReason: "tool_use", usage: u(1, 1), content: [{ type: "tool_use", id: "t1", name: "search_products", input: { max_price: "barato" } }] },
      { stopReason: "end_turn", usage: u(1, 1), content: [{ type: "text", text: "No encontré nada.\nCITED: none" }] },
    ]);
    await ask("x", { provider, index });
    expect(calls).toEqual([]);
    expect(JSON.stringify(requests[1]!.messages[2])).toContain('"isError":true');
  });
});
