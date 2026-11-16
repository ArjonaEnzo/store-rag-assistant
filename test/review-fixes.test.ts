import { describe, expect, it } from "vitest";
import { extractPrices } from "../src/guards.ts";

describe("extractPrices formats (review #3)", () => {
  it("handles comma thousands, mil/k suffix and ARS prefix", () => {
    expect(extractPrices("sale $79,990")).toEqual([79990]);
    expect(extractPrices("unos $80 mil")).toEqual([80000]);
    expect(extractPrices("unos $80k")).toEqual([80000]);
    expect(extractPrices("ARS 79.990")).toEqual([79990]);
    expect(extractPrices("$79.990,00")).toEqual([79990]);
  });
});
