import { readFile } from "node:fs/promises";
import type { Product, StoreAdapter } from "../types.ts";

/** Subset of the WooCommerce REST API v3 product (GET /wp-json/wc/v3/products). */
export type WooProduct = {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  stock_status: "instock" | "outofstock" | "onbackorder";
  stock_quantity: number | null;
  categories: { id: number; name: string; slug: string }[];
  attributes: { id: number; name: string; options: string[] }[];
  short_description: string;
  description: string;
};

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

export function stripHtml(html: string): string {
  return html
    .replace(/<\/?(p|br|div|li|ul|ol|h[1-6]|tr|td)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toInt(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeWooProduct(raw: WooProduct): Product {
  const price = toInt(raw.price);
  const regularPrice = toInt(raw.regular_price) || price;
  return {
    id: String(raw.id),
    name: raw.name,
    price,
    regularPrice,
    onSale: raw.on_sale,
    inStock: raw.stock_status === "instock",
    stockQty: raw.stock_quantity,
    categories: raw.categories.map((c) => c.name),
    attributes: Object.fromEntries(raw.attributes.map((a) => [a.name, a.options])),
    description: stripHtml(`${raw.short_description} ${raw.description}`),
    url: raw.permalink,
  };
}

/** Reads a JSON dump shaped like the WooCommerce REST products endpoint. A live REST adapter would share normalizeWooProduct. */
export class WooCommerceJsonAdapter implements StoreAdapter {
  constructor(private readonly path: string) {}

  async listProducts(): Promise<Product[]> {
    const raw = JSON.parse(await readFile(this.path, "utf8")) as WooProduct[];
    return raw.map(normalizeWooProduct);
  }
}
