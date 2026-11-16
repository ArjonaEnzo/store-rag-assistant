import { describe, expect, it } from "vitest";
import { ask, parseCitations } from "../src/assistant.ts";
import { extractPrices } from "../src/guards.ts";
import type { ChatResponse, LlmProvider } from "../src/llm/provider.ts";
import type { ProductIndex, SearchHit } from "../src/retrieval/index.ts";

const product = (id: string, price: number, extra: Partial<SearchHit["product"]> = {}) => ({
  id, name: `Producto ${id}`, price, regularPrice: price, onSale: false, inStock: true, stockQty: 3,
  categories: ["Running"], attributes: {}, description: "x", url: "", ...extra,
});
const index = (hits: SearchHit[]) => ({ categories: ["Running"], search: async () => hits }) as unknown as ProductIndex;
const scripted = (rs: Omit<ChatResponse, "raw">[]): LlmProvider => ({
  model: "claude-haiku-5-5",
  chat: async () => ({ ...rs.shift()!, raw: undefined }),
});
const u = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 };
const searchCall = (input: object): Omit<ChatResponse, "raw"> => ({
  stopReason: "tool_use", usage: u, content: [{ type: "tool_use", id: "t1", name: "search_products", input }],
});
const final = (text: string): Omit<ChatResponse, "raw"> => ({ stopReason: "end_turn", usage: u, content: [{ type: "text", text }] });

describe("parseCitations (review #1)", () => {
  it.each([
    ["Hola.\nCITED: 102, 103.", "Hola.", ["102", "103"]],
    ["Hola.\n**CITED:** 102", "Hola.", ["102"]],
    ["Hola.\nCITED: 103 (sin stock)", "Hola.", ["103"]],
    ["Hola.\n`CITED: 102`", "Hola.", ["102"]],
    ["Hola.\nCITED: 102\n¿Algo más?", "Hola.\n¿Algo más?", ["102"]],
    ["Hola.\nCITED: none", "Hola.", []],
  ])("%j", (text, answer, ids) => {
    expect(parseCitations(text)).toMatchObject({ answer, citedIds: ids });
  });

  it("distinguishes explicit none from a missing line", () => {
    expect(parseCitations("Hola.\nCITED: none").explicitNone).toBe(true);
    expect(parseCitations("Hola.").explicitNone).toBe(false);
  });
});

describe("missing citations (review #2)", () => {
  it("flags an answer that searched but cited nothing", async () => {
    const r = await ask("zapas", { provider: scripted([searchCall({ query: "zapas" }), final("Tenés la Producto 1.")]), index: index([{ product: product("1", 50000), score: 0.9 }]) });
    expect(r.flags).toContain("missing_citations");
  });

  it("does not flag an explicit CITED: none", async () => {
    const r = await ask("zapas", { provider: scripted([searchCall({ query: "zapas" }), final("No encontré nada.\nCITED: none")]), index: index([]) });
    expect(r.flags).toEqual([]);
  });
});

describe("extractPrices formats (review #3)", () => {
  it("handles comma thousands, mil/k suffix and ARS prefix", () => {
    expect(extractPrices("sale $79,990")).toEqual([79990]);
    expect(extractPrices("unos $80 mil")).toEqual([80000]);
    expect(extractPrices("unos $80k")).toEqual([80000]);
    expect(extractPrices("ARS 79.990")).toEqual([79990]);
    expect(extractPrices("$79.990,00")).toEqual([79990]);
  });
});

describe("truncation (review #6)", () => {
  it("escalates instead of executing a truncated turn", async () => {
    let searched = false;
    const idx = { categories: [], search: async () => ((searched = true), []) } as unknown as ProductIndex;
    const r = await ask("x", { provider: scripted([{ ...searchCall({ query: "a" }), stopReason: "max_tokens" }]), index: idx });
    expect(searched).toBe(false);
    expect(r.escalationReason).toBe("truncated");
  });
});
