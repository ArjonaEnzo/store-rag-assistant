import { addUsage, costUsd, type Usage } from "./cost.ts";
import { checkAnswer, customerNumbers } from "./guards.ts";
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
  // Some models send null for optional args (gpt-oss on Groq): treat null as absent.
  const i = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null)) as Record<string, unknown>;
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
  // `category` and `in_stock` are deliberately ignored even if a model sends them: model-chosen filters excluded the
  // right product in eval run 1. Stock status travels in every hit instead.
  return f;
}

export function catalogData(hits: SearchHit[]): string {
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
  // Escape < and > so catalog text (names, descriptions) can never close the <catalog_data> wrapper.
  const json = JSON.stringify(rows).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<catalog_data>\n${json}\n</catalog_data>${rows.length ? "" : "\nSin resultados."}`;
}

/**
 * Finds the last "CITED: ..." line anywhere in the model's final text (tolerating markdown like **CITED:** or
 * backticks), removes it from the answer, and keeps only numeric product ids.
 */
export function parseCitations(text: string): { answer: string; citedIds: string[]; explicitNone: boolean } {
  const lines = text.split("\n");
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[\s*_`>-]*CITED\b/i.test(lines[i]!)) {
      at = i;
      break;
    }
  }
  if (at === -1) return { answer: text.trim(), citedIds: [], explicitNone: false };
  const list = lines[at]!.replace(/^[\s*_`>-]*CITED[*_`]*\s*:?[*_`]*/i, "");
  lines.splice(at, 1);
  const citedIds = [...new Set(list.match(/\b\d+\b/g) ?? [])];
  return { answer: lines.join("\n").trim(), citedIds, explicitNone: citedIds.length === 0 && /\bnone\b/i.test(list) };
}

export async function ask(question: string, { provider, index }: AskDeps): Promise<AskResult> {
  const t0 = performance.now();
  const system = systemPrompt(index.categories);
  const toolDefs = tools(index.categories);
  const messages: ChatMsg[] = [{ role: "user", content: question }];
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const searches: AskResult["searches"] = [];
  const allHits: SearchHit[] = [];
  // Only numbers the customer wrote may appear as non-catalog prices. Filter values chosen by the model are not
  // trusted: a manipulated model could pass max_price: 1 and then "authorize" a $1 answer.
  const allowedPrices = customerNumbers(question);
  let escalationReason: string | undefined;
  let finalText: string | undefined;

  for (let turn = 0; turn < MAX_TURNS && finalText === undefined; turn++) {
    const res = await provider.chat({ system, messages, tools: toolDefs });
    usage = addUsage(usage, res.usage);
    messages.push({ role: "assistant", content: res.content, raw: res.raw });

    if (res.stopReason === "refusal" || res.stopReason === "max_tokens") {
      // A truncated turn may carry a half-written tool call or an answer without its CITED line: never act on it.
      escalationReason ??= res.stopReason === "refusal" ? "model_refusal" : "truncated";
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

  const { answer, citedIds, explicitNone } = parseCitations(finalText);
  const escalated = escalationReason !== undefined;
  const flags = checkAnswer({ text: answer, citedIds }, allHits, allowedPrices);
  if (!escalated && searches.length > 0 && citedIds.length === 0 && !explicitNone) flags.push("missing_citations");
  return {
    answer,
    citations: citedIds,
    escalated,
    ...(escalationReason !== undefined ? { escalationReason } : {}),
    flags,
    usage,
    costUsd: costUsd(provider.model, usage),
    latencyMs: Math.round(performance.now() - t0),
    model: provider.model,
    searches,
  };
}
