import { describe, expect, it } from "vitest";
import { checkAnswer, extractPrices } from "../src/guards.ts";
import { costUsd } from "../src/cost.ts";
import type { SearchHit } from "../src/retrieval/index.ts";

const hit = (id: string, price: number, regularPrice = price): SearchHit => ({
  score: 0.9,
  product: { id, name: `P${id}`, price, regularPrice, onSale: price < regularPrice, inStock: true, stockQty: 1, categories: [], attributes: {}, description: "", url: "" },
});

describe("extractPrices", () => {
  it("parses Argentine price formats to the same integer", () => {
    expect(extractPrices("sale $79.990")).toEqual([79990]);
    expect(extractPrices("sale $ 79.990,00")).toEqual([79990]);
    expect(extractPrices("sale $79990")).toEqual([79990]);
    expect(extractPrices("sale 79990 pesos")).toEqual([79990]);
    expect(extractPrices("sale 79.990 ARS")).toEqual([79990]);
  });

  it("ignores numbers that are not prices (sizes, specs)", () => {
    expect(extractPrices("talle 42, drop 8 mm, columna de agua 2000 mm, soporta 250 kg")).toEqual([]);
  });
});

describe("checkAnswer", () => {
  const hits = [hit("101", 79990, 89990), hit("105", 52990)];

  it("returns no flags for a grounded answer", () => {
    expect(checkAnswer({ text: "La Aero 3 está a $79.990 (antes $89.990) y la Ruta a $52.990.", citedIds: ["101", "105"] }, hits)).toEqual([]);
  });

  it("flags cited ids that were not in the search results", () => {
    expect(checkAnswer({ text: "Te recomiendo la Kora.", citedIds: ["102"] }, hits)).toEqual(["uncited_product:102"]);
  });

  it("flags prices that do not match any retrieved product", () => {
    expect(checkAnswer({ text: "Sale $75.000.", citedIds: ["101"] }, hits)).toEqual(["price_not_in_results:75000"]);
  });

  it("allows prices the customer mentioned (budget) and the sale discount", () => {
    expect(checkAnswer({ text: "Por menos de $80.000 tenés la Aero 3, ahorrás $10.000.", citedIds: ["101"] }, hits, [80000])).toEqual([]);
  });
});

describe("costUsd", () => {
  it("prices Claude Haiku 5.5 at USD 0.10 / 0.50 per MTok", () => {
    expect(costUsd("claude-haiku-5-5", { inputTokens: 3000, outputTokens: 300 })).toBeCloseTo(0.00045, 8);
  });

  it("prices cache reads at USD 0.01 per MTok", () => {
    expect(costUsd("claude-haiku-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.01, 8);
  });

  it("is zero for local / unknown models", () => {
    expect(costUsd("qwen2.5:3b", { inputTokens: 5000, outputTokens: 500 })).toBe(0);
  });
});
