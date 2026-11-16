import type { SearchHit } from "./retrieval/index.ts";

/**
 * Prices are only recognized with a currency marker ("$"/"ARS" before, or "pesos"/"ARS" after), so specs like
 * "2000 mm" or "250 kg" are not mistaken for prices. Accepts 79.990 / 79,990 / 79990 / 79.990,00 / $80 mil / $80k.
 */
const NUM = String.raw`(\d{1,3}(?:[.,]\d{3})+|\d+)(?:,\d{1,2})?`;
const PRICE_RE = new RegExp(String.raw`(?:\$|\bARS\b)\s?${NUM}(?:\s?(mil|k)\b)?|${NUM}\s?(?:pesos|ARS)\b`, "gi");

function toNumber(digits: string, thousands = false): number {
  const n = Number.parseInt(digits.replace(/[.,]/g, ""), 10);
  return thousands ? n * 1000 : n;
}

export function extractPrices(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(PRICE_RE)) {
    const n = m[1] !== undefined ? toNumber(m[1], m[2] !== undefined) : toNumber(m[3] ?? "");
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Every number the customer wrote that could be a price (budget etc.), with or without a currency marker:
 * "80.000", "80000", "$80.000", "80 lucas", "80 mil". Used as the only extra prices an answer may state.
 */
export function customerNumbers(question: string): number[] {
  const out = new Set(extractPrices(question));
  for (const m of question.matchAll(/(\d{1,3}(?:\.\d{3})+|\d{4,})/g)) out.add(toNumber(m[1]!));
  for (const m of question.matchAll(/(\d+)\s?(?:lucas|mil|k)\b/gi)) out.add(toNumber(m[1]!, true));
  return [...out];
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
