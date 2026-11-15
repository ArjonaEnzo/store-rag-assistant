import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Product } from "../types.ts";
import type { Embedder } from "./embedder.ts";

export type SearchFilters = { maxPrice?: number; minPrice?: number; category?: string; inStock?: boolean };
export type SearchHit = { product: Product; score: number };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Text that gets embedded for a product. Price/stock are left out on purpose: those are exact filters, not semantics. */
export function productText(p: Product): string {
  const attrs = Object.entries(p.attributes).map(([k, v]) => `${k}: ${v.join(", ")}`).join(". ");
  return `${p.name}. Categoría: ${p.categories.join(", ")}. ${attrs ? attrs + ". " : ""}${p.description}`;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function matches(p: Product, f: SearchFilters): boolean {
  if (f.maxPrice !== undefined && p.price > f.maxPrice) return false;
  if (f.minPrice !== undefined && p.price < f.minPrice) return false;
  if (f.inStock !== undefined && p.inStock !== f.inStock) return false;
  if (f.category && !p.categories.some((c) => fold(c) === fold(f.category!))) return false;
  return true;
}

type CacheFile = { model: string; vectors: Record<string, number[]> };

export class ProductIndex {
  private constructor(
    private readonly products: Product[],
    private readonly vectors: number[][],
    private readonly embedder: Embedder,
  ) {}

  get size(): number {
    return this.products.length;
  }

  get categories(): string[] {
    return [...new Set(this.products.flatMap((p) => p.categories))];
  }

  /** Embeds all products. With `cachePath`, vectors are reused across runs keyed by a hash of the embedded text. */
  static async build(products: Product[], embedder: Embedder, cachePath?: string): Promise<ProductIndex> {
    const texts = products.map(productText);
    const keys = texts.map((t) => createHash("sha1").update(t).digest("hex"));
    const model = embedder.id ?? "unknown";
    let cache: CacheFile = { model, vectors: {} };
    if (cachePath) {
      try {
        const loaded = JSON.parse(await readFile(cachePath, "utf8")) as CacheFile;
        if (loaded.model === model) cache = loaded;
      } catch {
        /* no cache yet */
      }
    }
    const missing = keys.map((k, i) => (cache.vectors[k] ? -1 : i)).filter((i) => i >= 0);
    if (missing.length) {
      const fresh = await embedder.embed(missing.map((i) => texts[i]!), "passage");
      missing.forEach((i, j) => (cache.vectors[keys[i]!] = fresh[j]!));
      if (cachePath) {
        await mkdir(dirname(cachePath), { recursive: true });
        await writeFile(cachePath, JSON.stringify(cache));
      }
    }
    return new ProductIndex(products, keys.map((k) => cache.vectors[k]!), embedder);
  }

  async search(query: string, filters: SearchFilters = {}, k = 5): Promise<SearchHit[]> {
    const [q] = await this.embedder.embed([query], "query");
    return this.products
      .map((product, i) => ({ product, score: dot(q!, this.vectors[i]!) }))
      .filter((h) => matches(h.product, filters))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
