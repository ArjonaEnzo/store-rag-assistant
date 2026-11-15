import { describe, expect, it } from "vitest";
import { normalizeWooProduct, WooCommerceJsonAdapter, type WooProduct } from "../src/adapters/woocommerce.ts";

const fixture: WooProduct = {
  id: 101,
  name: "Zapatillas Running Aero",
  slug: "zapatillas-running-aero",
  permalink: "https://demo-tienda.test/producto/zapatillas-running-aero",
  price: "79990",
  regular_price: "89990",
  sale_price: "79990",
  on_sale: true,
  stock_status: "instock",
  stock_quantity: 12,
  categories: [{ id: 1, name: "Running", slug: "running" }],
  attributes: [{ id: 0, name: "Talle", options: ["40", "41", "42"] }],
  short_description: "<p>Livianas &amp; rápidas.</p>",
  description: "<p>Ideal para <strong>10K</strong>.</p>",
};

describe("normalizeWooProduct", () => {
  it("maps WooCommerce REST fields into the common Product shape", () => {
    const p = normalizeWooProduct(fixture);
    expect(p).toEqual({
      id: "101",
      name: "Zapatillas Running Aero",
      price: 79990,
      regularPrice: 89990,
      onSale: true,
      inStock: true,
      stockQty: 12,
      categories: ["Running"],
      attributes: { Talle: ["40", "41", "42"] },
      description: "Livianas & rápidas. Ideal para 10K.",
      url: "https://demo-tienda.test/producto/zapatillas-running-aero",
    });
  });

  it("treats outofstock as not in stock", () => {
    const p = normalizeWooProduct({ ...fixture, stock_status: "outofstock", stock_quantity: 0 });
    expect(p.inStock).toBe(false);
  });
});

describe("WooCommerceJsonAdapter", () => {
  it("loads the demo seed with enough variety for evals", async () => {
    const products = await new WooCommerceJsonAdapter("data/woocommerce-products.json").listProducts();
    expect(products.length).toBeGreaterThanOrEqual(55);
    expect(products.filter((p) => !p.inStock).length).toBeGreaterThanOrEqual(5);
    expect(products.filter((p) => p.onSale).length).toBeGreaterThanOrEqual(5);
    expect(new Set(products.map((p) => p.id)).size).toBe(products.length);
  });
});
