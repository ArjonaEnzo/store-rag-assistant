import { describe, expect, it } from "vitest";
import { parseCitations } from "../src/assistant.ts";
import { extractPrices } from "../src/guards.ts";

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

describe("extractPrices formats (review #3)", () => {
  it("handles comma thousands, mil/k suffix and ARS prefix", () => {
    expect(extractPrices("sale $79,990")).toEqual([79990]);
    expect(extractPrices("unos $80 mil")).toEqual([80000]);
    expect(extractPrices("unos $80k")).toEqual([80000]);
    expect(extractPrices("ARS 79.990")).toEqual([79990]);
    expect(extractPrices("$79.990,00")).toEqual([79990]);
  });
});
