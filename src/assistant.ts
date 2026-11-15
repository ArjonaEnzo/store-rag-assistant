import { addUsage, costUsd, type Usage } from "./cost.ts";
import { checkAnswer, extractPrices } from "./guards.ts";
import type { ChatMsg, LlmProvider, ToolResult, ToolUseBlock } from "./llm/provider.ts";
import { systemPrompt, tools } from "./prompt.ts";
import type { ProductIndex, SearchFilters, SearchHit } from "./retrieval/index.ts";

export type AskResult = {
  answer: string;
  citations: string[];
  escalated: boolean;
  escalationReason?: string;
  flags: string[];
  usage: Usage;
  costUsd: number;
  latencyMs: number;
  model: string;
  searches: { query: string; filters: SearchFilters; hitIds: string[] }[];
};

export type AskDeps = { provider: LlmProvider; index: ProductIndex };

const MAX_TURNS = 4;
const ESCALATION_TEXT = "Te paso con una persona del equipo para que te ayude con esto.";

type SearchInput = { query: string; max_price?: number; min_price?: number; category?: string; in_stock?: boolean };

function parseSearchInput(input: unknown): SearchInput | string {
  if (!input || typeof input !== "object") return "input must be an object";
  const i = input as Record<string, unknown>;
  if (typeof i.query !== "string" || !i.query.trim()) return "query (string) is required";
  for (const k of ["max_price", "min_price"] as const) if (i[k] !== undefined && typeof i[k] !== "number") return `${k} must be a number`;
  if (i.category !== undefined && typeof i.category !== "string") return "category must be a string";
  if (i.in_stock !== undefined && typeof i.in_stock !== "boolean") return "in_stock must be a boolean";
  return i as SearchInput;
}

function toFilters(i: SearchInput): SearchFilters {
  const f: SearchFilters = {};
  if (i.max_price !== undefined) f.maxPrice = i.max_price;
  if (i.min_price !== undefined) f.minPrice = i.min_price;
  if (i.category) f.category = i.category;
  if (i.in_stock !== undefined) f.inStock = i.in_stock;
  return f;
}

function catalogData(hits: SearchHit[]): string {
  const rows = hits.map(({ product: p, score }) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    regular_price: p.regularPrice,
    on_sale: p.onSale,
    in_stock: p.inStock,
    stock_qty: p.stockQty,
    category: p.categories.join(", "),
    attributes: p.attributes,
    description: p.description,
    relevance: Number(score.toFixed(3)),
  }));
  return `<catalog_data>\n${JSON.stringify(rows)}\n</catalog_data>${rows.length ? "" : "\nSin resultados."}`;
}

/** Splits the trailing "CITED: a,b" line off the model's final text. */
export function parseCitations(text: string): { answer: string; citedIds: string[] } {
  const m = text.match(/\n?\s*CITED:\s*(.*)\s*$/i);
  if (!m) return { answer: text.trim(), citedIds: [] };
  const list = (m[1] ?? "").trim();
  const citedIds = /^none$/i.test(list) || !list ? [] : list.split(/[,\s]+/).filter(Boolean);
  return { answer: text.slice(0, m.index).trim(), citedIds };
}

export async function ask(question: string, { provider, index }: AskDeps): Promise<AskResult> {
  const t0 = performance.now();
  const system = systemPrompt(index.categories);
  const toolDefs = tools(index.categories);
  const messages: ChatMsg[] = [{ role: "user", content: question }];
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const searches: AskResult["searches"] = [];
  const allHits: SearchHit[] = [];
  const allowedPrices = extractPrices(question);
  let escalationReason: string | undefined;
  let finalText: string | undefined;

  for (let turn = 0; turn < MAX_TURNS && finalText === undefined; turn++) {
    const res = await provider.chat({ system, messages, tools: toolDefs });
    usage = addUsage(usage, res.usage);
    messages.push({ role: "assistant", content: res.content, raw: res.raw });

    if (res.stopReason === "refusal") {
      escalationReason ??= "model_refusal";
      finalText = ESCALATION_TEXT;
      break;
    }

    const calls = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) {
      finalText = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      break;
    }

    const results: ToolResult[] = [];
    for (const call of calls) {
      if (call.name === "search_products") {
        const parsed = parseSearchInput(call.input);
        if (typeof parsed === "string") {
          results.push({ toolUseId: call.id, content: `Invalid input: ${parsed}`, isError: true });
          continue;
        }
        const filters = toFilters(parsed);
        const hits = await index.search(parsed.query, filters, 5);
        searches.push({ query: parsed.query, filters, hitIds: hits.map((h) => h.product.id) });
        allHits.push(...hits);
        for (const v of [filters.maxPrice, filters.minPrice]) if (v !== undefined) allowedPrices.push(v);
        results.push({ toolUseId: call.id, content: catalogData(hits) });
      } else if (call.name === "escalate_to_human") {
        const reason = (call.input as { reason?: unknown } | null)?.reason;
        escalationReason ??= typeof reason === "string" ? reason : "unspecified";
        results.push({ toolUseId: call.id, content: "Derivación registrada. Avisale al cliente que una persona del equipo lo va a contactar." });
      } else {
        results.push({ toolUseId: call.id, content: `Unknown tool: ${call.name}`, isError: true });
      }
    }
    messages.push({ role: "user", content: results });
  }

  if (finalText === undefined) {
    escalationReason ??= "max_turns";
    finalText = ESCALATION_TEXT;
  }

  const { answer, citedIds } = parseCitations(finalText);
  return {
    answer,
    citations: citedIds,
    escalated: escalationReason !== undefined,
    ...(escalationReason !== undefined ? { escalationReason } : {}),
    flags: checkAnswer({ text: answer, citedIds }, allHits, allowedPrices),
    usage,
    costUsd: costUsd(provider.model, usage),
    latencyMs: Math.round(performance.now() - t0),
    model: provider.model,
    searches,
  };
}
