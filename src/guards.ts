import type { SearchHit } from "./retrieval/index.ts";

/**
 * Prices are only recognized with a currency marker ("$" before, or "pesos"/"ARS" after), so specs like
 * "2000 mm" or "250 kg" are not mistaken for prices. Accepts 79.990 / 79990 / 79.990,00.
 */
const PRICE_RE = /\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?|(\d{1,3}(?:\.\d{3})+|\d{4,})(?:,\d{1,2})?\s?(?:pesos|ars)\b/gi;

export function extractPrices(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(PRICE_RE)) {
    const digits = (m[1] ?? m[2] ?? "").replace(/\./g, "");
    const n = Number.parseInt(digits, 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export type AnswerUnderCheck = { text: string; citedIds: string[] };

/**
 * Deterministic grounding checks. Returns flags; empty array = passed.
 * - uncited_product:<id>   the answer cites a product that no search returned this turn
 * - price_not_in_results:<n> the answer states a price that is not a retrieved price, regular price,
 *   sale discount, or a number the customer gave (`allowedPrices`, e.g. their budget)
 */
export function checkAnswer(answer: AnswerUnderCheck, hits: SearchHit[], allowedPrices: number[] = []): string[] {
  const flags: string[] = [];
  const ids = new Set(hits.map((h) => h.product.id));
  for (const id of answer.citedIds) if (!ids.has(id)) flags.push(`uncited_product:${id}`);

  const allowed = new Set<number>(allowedPrices);
  for (const { product: p } of hits) {
    allowed.add(p.price);
    allowed.add(p.regularPrice);
    if (p.regularPrice > p.price) allowed.add(p.regularPrice - p.price);
  }
  for (const n of extractPrices(answer.text)) if (!allowed.has(n)) flags.push(`price_not_in_results:${n}`);
  return flags;
}
