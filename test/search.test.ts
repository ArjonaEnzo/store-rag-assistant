import { describe, expect, it } from "vitest";
import { ProductIndex } from "../src/retrieval/index.ts";
import type { Embedder } from "../src/retrieval/embedder.ts";
import type { Product } from "../src/types.ts";

/** Deterministic bag-of-words embedder over a tiny vocabulary — enough to test ranking and filters. */
const VOCAB = ["zapatilla", "running", "pelota", "futbol", "carpa", "mancuerna"];
const fakeEmbedder: Embedder = {
  async embed(texts) {
    return texts.map((t) => {
      const v = VOCAB.map((w) => (t.toLowerCase().includes(w) ? 1 : 0));
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  },
};

const mk = (id: string, name: string, price: number, inStock: boolean, category: string): Product => ({
  id, name, price, regularPrice: price, onSale: false, inStock, stockQty: inStock ? 5 : 0,
  categories: [category], attributes: {}, description: "", url: "",
});

const products = [
  mk("1", "Zapatilla running barata", 50000, true, "Running"),
  mk("2", "Zapatilla running cara", 120000, true, "Running"),
  mk("3", "Zapatilla running agotada", 60000, false, "Running"),
  mk("4", "Pelota futbol", 30000, true, "Fútbol"),
  mk("5", "Carpa", 180000, true, "Outdoor"),
];

describe("ProductIndex.search", () => {
  it("ranks semantically closest products first and respects k", async () => {
    const index = await ProductIndex.build(products, fakeEmbedder);
    const hits = await index.search("zapatilla running", {}, 2);
    expect(hits).toHaveLength(2);
    expect(["1", "2", "3"]).toContain(hits[0]!.product.id);
    expect(hits[0]!.score).toBeGreaterThan(0.9);
  });

  it("applies exact filters before ranking", async () => {
    const index = await ProductIndex.build(products, fakeEmbedder);
    const hits = await index.search("zapatilla running", { maxPrice: 80000, inStock: true }, 5);
    expect(hits.map((h) => h.product.id).filter((id) => ["1", "2", "3"].includes(id))).toEqual(["1"]);
  });

  it("filters by category case- and accent-insensitively", async () => {
    const index = await ProductIndex.build(products, fakeEmbedder);
    const hits = await index.search("pelota", { category: "futbol" }, 5);
    expect(hits.map((h) => h.product.id)).toEqual(["4"]);
  });

  it("applies minPrice", async () => {
    const index = await ProductIndex.build(products, fakeEmbedder);
    const hits = await index.search("carpa", { minPrice: 150000 }, 5);
    expect(hits.map((h) => h.product.id)).toEqual(["5"]);
  });
});
