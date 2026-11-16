import { describe, expect, it } from "vitest";
import { tools } from "../src/prompt.ts";

describe("search_products tool schema", () => {
  // Eval run 1 (Groq): the model guessed categories ("soga" → Accesorios, "auriculares" → Running) and the hard
  // filter excluded the right product in 7/35 cases. Category is semantics — the embedding already handles it.
  it("does not expose a category filter to the model", () => {
    const search = tools(["Running", "Outdoor"]).find((t) => t.name === "search_products")!;
    expect(Object.keys((search.inputSchema as { properties: object }).properties)).toEqual(["query", "max_price", "min_price", "in_stock"]);
  });
});
