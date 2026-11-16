import { describe, expect, it } from "vitest";
import { tools } from "../src/prompt.ts";

describe("search_products tool schema", () => {
  // Eval run 1 (Groq): the model guessed categories ("soga" → Accesorios, "auriculares" → Running) and the hard
  // filter excluded the right product in 7/35 cases. Category is semantics — the embedding already handles it.
  it("does not expose a category filter to the model", () => {
    const search = tools(["Running", "Outdoor"]).find((t) => t.name === "search_products")!;
    expect(Object.keys((search.inputSchema as { properties: object }).properties)).toEqual(["query", "max_price", "min_price"]);
  });

  // Same run: the model set in_stock:true unasked, hiding out-of-stock products the customer asked about (3/35).
  // Stock is returned on every hit, so the model can say "sin stock" without filtering.
  // Eval run 2: gpt-oss on Groq sent max_price:null and Groq rejected the call server-side (HTTP 400).
  it("accepts null for optional price filters", () => {
    const props = (tools([]).find((t) => t.name === "search_products")!.inputSchema as { properties: Record<string, { type: unknown }> }).properties;
    expect(props.max_price!.type).toEqual(["integer", "null"]);
    expect(props.min_price!.type).toEqual(["integer", "null"]);
  });

  it("does not expose an in_stock filter either", () => {
    const search = tools([]).find((t) => t.name === "search_products")!;
    expect((search.inputSchema as { properties: object }).properties).not.toHaveProperty("in_stock");
  });
});
